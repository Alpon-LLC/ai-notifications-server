import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { loadDeployWebhookSecret } from './config/deploy-secret';
import { log } from './logger';
import { FileDeliveryStore, GitHubPrReviewService, RestGitHubClient, defaultDeliveryDirectory } from './services/github-pr-review.service';
import { SlackService } from './services/slack.service';

async function main() {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  log('info', 'server_starting', 'Notification server startup initiated', {
    host,
    port,
    node_env: process.env.NODE_ENV || 'unset',
  });
  const deployWebhookSecret = await loadDeployWebhookSecret();
  const githubWebhookSecret = process.env.GITHUB_PR_WEBHOOK_SECRET;
  const internalSecret = process.env.JOHN_PR_REVIEW_HMAC_SECRET;
  const githubToken = process.env.GITHUB_TOKEN;
  const allowedRepositories = (process.env.GITHUB_PR_ALLOWED_REPOSITORIES || '').split(',').map((value) => value.trim()).filter(Boolean);
  const prisma = new PrismaClient();
  const slackBotToken = process.env.SLACK_BOT_TOKEN || '';
  const slackService = slackBotToken ? new SlackService({ botToken: slackBotToken, prisma }) : undefined;
  const githubPrReview = githubWebhookSecret && internalSecret && githubToken && allowedRepositories.length > 0 ? {
    webhookSecret: githubWebhookSecret,
    allowedRepositories,
    service: new GitHubPrReviewService({ githubClient: new RestGitHubClient(githubToken), deliveryStore: new FileDeliveryStore(defaultDeliveryDirectory()), internalSecret, johnUrl: process.env.JOHN_PR_REVIEW_WEBHOOK_URL, slackService }),
    slackService,
  } : undefined;
  const app = createApp({ deployWebhookSecret, githubPrReview });

  const server = app.listen(port, host, () => {
    log('info', 'server_listening', 'Notification server is accepting connections', {
      host,
      port,
    });
  });
  server.on('error', (error) => {
    log('error', 'server_listener_error', 'HTTP server emitted an error', { host, port }, error);
  });

  function shutdown(signal: NodeJS.Signals) {
    log('info', 'server_shutdown_started', 'Shutdown signal received', { signal });
    server.close((error) => {
      if (error) {
        log('error', 'server_shutdown_failed', 'HTTP server failed to close cleanly', { signal }, error);
        process.exitCode = 1;
        return;
      }
      prisma.$disconnect().catch(() => {});
      log('info', 'server_shutdown_completed', 'HTTP server closed cleanly', { signal });
    });
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  log('error', 'server_startup_failed', 'Notification server failed during startup', {}, error);
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  log('error', 'unhandled_rejection', 'Unhandled promise rejection', {}, reason);
});

process.on('uncaughtException', (error) => {
  log('error', 'uncaught_exception', 'Uncaught exception', {}, error);
  process.exit(1);
});
