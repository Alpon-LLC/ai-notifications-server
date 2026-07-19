import express from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import createApiRouter from './routes';
import { DeploymentService } from './services/deployment.service';

export interface CreateAppOptions {
  deployWebhookSecret: string;
  deploymentService?: InstanceType<typeof DeploymentService>;
}

export function createApp(options: CreateAppOptions) {
  if (!options?.deployWebhookSecret) {
    throw new Error('deployWebhookSecret is required');
  }

  const app = express();
  const deploymentService =
    options.deploymentService || new DeploymentService();
  const packageVersion = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ).version as string;

  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '100kb',
      verify(request, _response, buffer) {
        (request as Request).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', version: packageVersion });
  });

  app.use(
    '/api',
    createApiRouter({
      deploymentService,
      deployWebhookSecret: options.deployWebhookSecret,
    }),
  );

  app.use((_request, response) => {
    response.status(404).json({ error: 'Route not found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const syntaxError = error as SyntaxError & { body?: unknown; status?: number };

    if (error instanceof SyntaxError && syntaxError.status === 400 && 'body' in syntaxError) {
      return response.status(400).json({ error: 'Invalid JSON payload' });
    }

    console.error(error);
    return response.status(500).json({ error: 'Internal server error' });
  };

  app.use(errorHandler);

  return app;
}
