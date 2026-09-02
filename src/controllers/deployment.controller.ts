import type { Request, Response } from 'express';

import {
  DeploymentAlreadyRunningError,
  type DeploymentServiceLike,
} from '../services/deployment.service';
import { log } from '../logger';

export const DEFAULT_ALLOWED_REPOSITORY = 'Alpon-LLC/hermes-agent-config';

export function bearerToken(request: Request) {
  const authorization = request.get('authorization') || '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
}

interface DeploymentStartBody {
  request_id?: unknown;
  repository?: unknown;
  git_sha?: unknown;
  actor?: unknown;
  target_branch?: unknown;
  dry_run?: unknown;
}

export function createDeploymentController(
  deploymentService: DeploymentServiceLike,
) {
  const allowedRepository =
    process.env.HERMES_DEPLOY_ALLOWED_REPOSITORY ||
    DEFAULT_ALLOWED_REPOSITORY;

  return {
    start(request: Request<unknown, unknown, DeploymentStartBody>, response: Response) {
      const {
        request_id: requestId,
        repository,
        git_sha: gitSha,
        actor,
        target_branch: targetBranch,
        dry_run: dryRun = false,
      } = request.body || {};
      const invalidFields = [
        !requestId && 'request_id',
        !repository && 'repository',
        !actor && 'actor',
        repository !== allowedRepository && 'repository_not_allowed',
        !/^[a-f0-9]{40}$/i.test(String(gitSha || '')) && 'git_sha',
        targetBranch !== 'main' && 'target_branch',
        typeof dryRun !== 'boolean' && 'dry_run',
      ].filter(Boolean);

      if (invalidFields.length > 0) {
        log('warn', 'deployment_request_rejected', 'Deployment request validation failed', {
          request_id: request.requestId,
          webhook_request_id:
            typeof requestId === 'string' ? requestId.slice(0, 200) : null,
          invalid_fields: invalidFields,
        });
        return response.status(400).json({
          error:
            'Request must identify the allowed repository, a full Git SHA, an actor, target_branch=main, and an optional boolean dry_run',
        });
      }

      const validatedDryRun = dryRun as boolean;

      try {
        const job = deploymentService.start({
          requestId: String(requestId).slice(0, 200),
          repository: String(repository).slice(0, 200),
          gitSha: String(gitSha).slice(0, 64),
          actor: String(actor).slice(0, 100),
          targetBranch: String(targetBranch),
          dryRun: validatedDryRun,
        });
        log('info', 'deployment_request_accepted', 'Deployment job accepted', {
          request_id: request.requestId,
          webhook_request_id: String(requestId).slice(0, 200),
          job_id: job.job_id,
          repository: String(repository).slice(0, 200),
          git_sha: String(gitSha).slice(0, 12),
          actor: String(actor).slice(0, 100),
          dry_run: validatedDryRun,
        });

        return response.status(202).json({
          ...job,
          status_url: `/api/deployments/deploy/${job.job_id}`,
        });
      } catch (error) {
        if (error instanceof DeploymentAlreadyRunningError) {
          log('warn', 'deployment_request_conflict', 'Deployment request rejected because another job is active', {
            request_id: request.requestId,
            active_job_id: error.jobId,
          });
          return response.status(409).json({
            error: error.message,
            active_job_id: error.jobId,
          });
        }

        throw error;
      }
    },

    status(request: Request<{ jobId: string }>, response: Response) {
      const token = bearerToken(request);
      const job = deploymentService.getAuthorized(
        request.params.jobId,
        token,
      );

      if (!job) {
        log('warn', 'deployment_status_not_found', 'Deployment status lookup was not authorized or the job does not exist', {
          request_id: request.requestId,
          job_id: request.params.jobId,
          bearer_token_present: token.length > 0,
        });
        return response.status(404).json({ error: 'Deployment job not found' });
      }

      log('info', 'deployment_status_returned', 'Deployment status returned', {
        request_id: request.requestId,
        job_id: request.params.jobId,
        status: job.status,
      });
      return response.status(200).json(job);
    },
  };
}
