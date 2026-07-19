import { Router } from 'express';

import contactRoutes from './contact.routes';
import {
  createDeploymentRoutes,
  type DeploymentRoutesOptions,
} from './deployment.routes';

export default function createApiRouter(options: DeploymentRoutesOptions) {
  const router = Router();

  router.use('/notifications/contact', contactRoutes);
  router.use('/deployments', createDeploymentRoutes(options));

  return router;
}
