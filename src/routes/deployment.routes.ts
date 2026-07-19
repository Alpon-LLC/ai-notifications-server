import { Router } from 'express';

import { createDeploymentController } from '../controllers/deployment.controller';
import { createDeployWebhookVerifier } from '../middleware/verify-deploy-webhook';
import type { DeploymentServiceLike } from '../services/deployment.service';

export interface DeploymentRoutesOptions {
  deploymentService: DeploymentServiceLike;
  deployWebhookSecret: string;
}

export function createDeploymentRoutes(options: DeploymentRoutesOptions) {
  const router = Router();
  const controller = createDeploymentController(options.deploymentService);
  const verifyWebhook = createDeployWebhookVerifier({
    secret: options.deployWebhookSecret,
  });

  router.post('/deploy', verifyWebhook, controller.start);
  router.get('/deploy/:jobId', controller.status);

  return router;
}