import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { log } from '../logger';

const DEFAULT_STOP_SCRIPT = '/home/Work/.hermes/scripts/hermes-stop.sh';
const DEFAULT_DEPLOY_SCRIPT =
  '/home/Work/.hermes/scripts/deploy-hermes-from-github.sh';

export type DeploymentStatus =
  | 'queued'
  | 'running'
  | 'deployed_and_awake'
  | 'capture_pr_created'
  | 'capture_pr_exists'
  | 'dry_run_completed'
  | 'failed';

export type DeploymentFailureStage = 'stop' | 'deploy' | 'launch' | null;

export interface DeploymentMetadata {
  requestId: string;
  repository: string;
  gitSha: string;
  actor: string;
  targetBranch: string;
  dryRun: boolean;
}

export interface DeploymentPublicJob {
  job_id: string;
  status: DeploymentStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  failure_stage: DeploymentFailureStage;
  output?: string;
}

export interface DeploymentServiceLike {
  start(metadata: DeploymentMetadata): DeploymentPublicJob & { status_token: string };
  getAuthorized(jobId: string, token: string): DeploymentPublicJob | null;
}

export interface CommandRunnerResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

export interface CommandRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maximumBytes?: number;
}

export interface DeploymentServiceOptions {
  stopScript?: string;
  deployScript?: string;
  commandRunner?: (command: string, options?: CommandRunnerOptions) => Promise<CommandRunnerResult>;
  sleep?: (milliseconds: number) => Promise<void>;
  dryRunDelayMs?: number;
}

const TERMINAL_STATUSES = new Set<DeploymentStatus>([
  'deployed_and_awake',
  'capture_pr_created',
  'capture_pr_exists',
  'dry_run_completed',
  'failed',
]);

export class DeploymentAlreadyRunningError extends Error {
  jobId: string;

  constructor(jobId: string) {
    super('A Hermes deployment is already running');
    this.name = 'DeploymentAlreadyRunningError';
    this.jobId = jobId;
  }
}

interface DeploymentJob {
  id: string;
  token: string;
  status: DeploymentStatus;
  metadata: DeploymentMetadata;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  failureStage: DeploymentFailureStage;
  output: string;
}

function appendLimited(existing: string, chunk: Buffer, maximumBytes: number) {
  const combined = `${existing}${chunk.toString('utf8')}`;
  return Buffer.byteLength(combined, 'utf8') <= maximumBytes
    ? combined
    : combined.slice(-maximumBytes);
}

export function runCommand(
  command: string,
  options: CommandRunnerOptions = {},
): Promise<CommandRunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      cwd: options.cwd || '/home/Work',
      env: options.env || process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const maximumBytes = options.maximumBytes || 256 * 1024;

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      output = appendLimited(output, chunk, maximumBytes);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      output = appendLimited(output, chunk, maximumBytes);
    });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      resolve({ exitCode, signal, output });
    });
  });
}

function publicJob(job: DeploymentJob): DeploymentPublicJob {
  return {
    job_id: job.id,
    status: job.status,
    created_at: job.createdAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    exit_code: job.exitCode,
    failure_stage: job.failureStage,
    output: TERMINAL_STATUSES.has(job.status) ? job.output : undefined,
  };
}

export class DeploymentService implements DeploymentServiceLike {
  private stopScript: string;

  private deployScript: string;

  private commandRunner: (command: string, options?: CommandRunnerOptions) => Promise<CommandRunnerResult>;

  private sleep: (milliseconds: number) => Promise<void>;

  private dryRunDelayMs: number;

  private jobs = new Map<string, DeploymentJob>();

  private activeJobId: string | null = null;

  constructor(options: DeploymentServiceOptions = {}) {
    this.stopScript = options.stopScript || DEFAULT_STOP_SCRIPT;
    this.deployScript = options.deployScript || DEFAULT_DEPLOY_SCRIPT;
    this.commandRunner = options.commandRunner || runCommand;
    this.sleep =
      options.sleep ||
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.dryRunDelayMs = options.dryRunDelayMs ?? 10_000;
  }

  start(metadata: DeploymentMetadata) {
    if (this.activeJobId) {
      log('warn', 'deployment_job_rejected', 'A deployment job is already active', {
        active_job_id: this.activeJobId,
        webhook_request_id: metadata.requestId,
      });
      throw new DeploymentAlreadyRunningError(this.activeJobId);
    }

    const job: DeploymentJob = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(32).toString('hex'),
      status: 'queued',
      metadata,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      failureStage: null,
      output: '',
    };

    this.jobs.set(job.id, job);
    this.activeJobId = job.id;
    log('info', 'deployment_job_queued', 'Deployment job queued', {
      job_id: job.id,
      webhook_request_id: metadata.requestId,
      repository: metadata.repository,
      git_sha: metadata.gitSha.slice(0, 12),
      actor: metadata.actor,
      dry_run: metadata.dryRun,
    });
    setImmediate(() => void this.run(job));

    return {
      ...publicJob(job),
      status_token: job.token,
    };
  }

  getAuthorized(jobId: string, token: string) {
    const job = this.jobs.get(jobId);
    if (!job || !token) {
      return null;
    }

    const supplied = Buffer.from(token, 'utf8');
    const expected = Buffer.from(job.token, 'utf8');
    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    return publicJob(job);
  }

  private async run(job: DeploymentJob) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const startedAt = Date.now();
    log('info', 'deployment_job_started', 'Deployment job started', {
      job_id: job.id,
      webhook_request_id: job.metadata.requestId,
      dry_run: job.metadata.dryRun,
    });

    try {
      if (job.metadata.dryRun) {
        log('info', 'deployment_dry_run_waiting', 'Dry-run job is simulating asynchronous work', {
          job_id: job.id,
          delay_ms: this.dryRunDelayMs,
        });
        await this.sleep(this.dryRunDelayMs);
        job.status = 'dry_run_completed';
        job.exitCode = 0;
        job.output =
          'Dry run completed; Hermes gateways and deployment scripts were not touched.\n';
        log('info', 'deployment_dry_run_completed', 'Dry-run job completed without invoking scripts', {
          job_id: job.id,
          duration_ms: Date.now() - startedAt,
        });
        return;
      }

      log('info', 'deployment_stage_started', 'Starting Hermes shutdown stage', {
        job_id: job.id,
        stage: 'stop',
        command: this.stopScript,
      });
      const stopResult = await this.commandRunner(this.stopScript);
      job.output = stopResult.output || '';
      if (stopResult.exitCode !== 0) {
        job.status = 'failed';
        job.exitCode = stopResult.exitCode;
        job.failureStage = 'stop';
        log('error', 'deployment_stage_failed', 'Hermes shutdown stage failed', {
          job_id: job.id,
          stage: 'stop',
          exit_code: stopResult.exitCode,
          signal: stopResult.signal,
          output_bytes: Buffer.byteLength(stopResult.output || '', 'utf8'),
        });
        return;
      }

      log('info', 'deployment_stage_completed', 'Hermes shutdown stage completed', {
        job_id: job.id,
        stage: 'stop',
      });
      log('info', 'deployment_stage_started', 'Starting repository deployment stage', {
        job_id: job.id,
        stage: 'deploy',
        command: this.deployScript,
      });
      const deployResult = await this.commandRunner(this.deployScript, {
        env: { ...process.env, BASE_BRANCH: 'main' },
      });
      job.output = appendLimited(job.output, Buffer.from(deployResult.output || '', 'utf8'), 256 * 1024);
      job.exitCode = deployResult.exitCode;

      if (deployResult.exitCode === 0) {
        job.status = 'deployed_and_awake';
      } else if (deployResult.exitCode === 20) {
        job.status = 'capture_pr_created';
      } else if (deployResult.exitCode === 21) {
        job.status = 'capture_pr_exists';
      } else {
        job.status = 'failed';
        job.failureStage = 'deploy';
      }
      log(
        job.status === 'failed' ? 'error' : 'info',
        job.status === 'failed' ? 'deployment_stage_failed' : 'deployment_stage_completed',
        job.status === 'failed'
          ? 'Repository deployment stage failed'
          : 'Repository deployment stage completed',
        {
          job_id: job.id,
          stage: 'deploy',
          status: job.status,
          exit_code: deployResult.exitCode,
          signal: deployResult.signal,
          output_bytes: Buffer.byteLength(deployResult.output || '', 'utf8'),
        },
      );
    } catch (error) {
      job.status = 'failed';
      job.failureStage = job.failureStage || 'launch';
      const message = error instanceof Error ? error.stack || error.message : String(error);
      job.output = appendLimited(job.output, Buffer.from(`${message}\n`, 'utf8'), 256 * 1024);
      log(
        'error',
        'deployment_job_exception',
        'Deployment job threw an exception',
        {
          job_id: job.id,
          failure_stage: job.failureStage,
          duration_ms: Date.now() - startedAt,
        },
        error,
      );
    } finally {
      job.finishedAt = new Date().toISOString();
      this.activeJobId = null;
      log(
        job.status === 'failed' ? 'error' : 'info',
        'deployment_job_finished',
        'Deployment job reached a terminal state',
        {
          job_id: job.id,
          status: job.status,
          failure_stage: job.failureStage,
          exit_code: job.exitCode,
          duration_ms: Date.now() - startedAt,
        },
      );
    }
  }
}

export { TERMINAL_STATUSES };
