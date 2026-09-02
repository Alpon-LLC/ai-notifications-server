import express from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import createApiRouter from './routes';
import { log } from './logger';
import { DeploymentService } from './services/deployment.service';
import type { GitHubPrReviewRoutesOptions } from './routes/github-pr-review.routes';

export interface CreateAppOptions {
  deployWebhookSecret: string;
  deploymentService?: InstanceType<typeof DeploymentService>;
  githubPrReview?: GitHubPrReviewRoutesOptions;
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
  app.use((request, response, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = process.hrtime.bigint();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    response.once('finish', () => {
      const path = request.originalUrl.split('?', 1)[0] ?? request.path;
      if (
        response.statusCode >= 400 ||
        path.startsWith('/api/deployments/')
      ) {
        const durationMs =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        log(
          response.statusCode >= 500
            ? 'error'
            : response.statusCode >= 400
              ? 'warn'
              : 'info',
          'http_request_completed',
          'HTTP request completed',
          {
            request_id: requestId,
            method: request.method,
            path,
            status_code: response.statusCode,
            duration_ms: Math.round(durationMs),
          },
        );
      }
    });

    next();
  });
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
      githubPrReview: options.githubPrReview,
    }),
  );

  app.use((request, response) => {
    log('warn', 'route_not_found', 'No route matched the request', {
      request_id: request.requestId,
      method: request.method,
      path: request.originalUrl.split('?', 1)[0],
    });
    response.status(404).json({ error: 'Route not found' });
  });

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    const syntaxError = error as SyntaxError & { body?: unknown; status?: number };

    if (error instanceof SyntaxError && syntaxError.status === 400 && 'body' in syntaxError) {
      log('warn', 'invalid_json', 'Request body contains invalid JSON', {
        request_id: request.requestId,
        method: request.method,
        path: request.originalUrl.split('?', 1)[0],
      });
      return response.status(400).json({ error: 'Invalid JSON payload' });
    }

    log(
      'error',
      'unhandled_request_error',
      'Unhandled error while processing HTTP request',
      {
        request_id: request.requestId,
        method: request.method,
        path: request.originalUrl.split('?', 1)[0],
      },
      error,
    );
    return response.status(500).json({ error: 'Internal server error' });
  };

  app.use(errorHandler);

  return app;
}
