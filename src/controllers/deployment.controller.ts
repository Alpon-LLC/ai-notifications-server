import type { Request, Response } from 'express';

import {
  DeploymentAlreadyRunningError,
  type DeploymentServiceLike,
} from '../services/deployment.service';

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

      if (
        !requestId ||
        !repository ||
        !actor ||
        repository !== allowedRepository ||
        !/^[a-f0-9]{40}$/i.test(String(gitSha || '')) ||
        targetBranch !== 'main' ||
        typeof dryRun !== 'boolean'
      ) {
        return response.status(400).json({
          error:
            'Request must identify the allowed repository, a full Git SHA, an actor, target_branch=main, and an optional boolean dry_run',
        });
      }

      try {
        const job = deploymentService.start({
          requestId: String(requestId).slice(0, 200),
          repository: String(repository).slice(0, 200),
          gitSha: String(gitSha).slice(0, 64),
          actor: String(actor).slice(0, 100),
          targetBranch: String(targetBranch),
          dryRun,
        });

        return response.status(202).json({
          ...job,
          status_url: `/api/deployments/deploy/${job.job_id}`,
        });
      } catch (error) {
        if (error instanceof DeploymentAlreadyRunningError) {
          return response.status(409).json({
            error: error.message,
            active_job_id: error.jobId,
          });
        }

        throw error;
      }
    },

    status(request: Request<{ jobId: string }>, response: Response) {
      const job = deploymentService.getAuthorized(
        request.params.jobId,
        bearerToken(request),
      );

      if (!job) {
        return response.status(404).json({ error: 'Deployment job not found' });
      }

      return response.status(200).json(job);
    },
  };
}