import { Router } from 'express';

import contactRoutes from './contact.routes';
import {
  createDeploymentRoutes,
  type DeploymentRoutesOptions,
} from './deployment.routes';
import { createGitHubPrReviewRoutes, type GitHubPrReviewRoutesOptions } from './github-pr-review.routes';

export default function createApiRouter(options: DeploymentRoutesOptions & { githubPrReview?: GitHubPrReviewRoutesOptions }) {
  const router = Router();

  router.use('/notifications/contact', contactRoutes);
  router.use('/deployments', createDeploymentRoutes(options));
  if (options.githubPrReview) router.use('/github', createGitHubPrReviewRoutes(options.githubPrReview));

  return router;
}
