import { createApp } from './app';
import { loadDeployWebhookSecret } from './config/deploy-secret';

async function main() {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const deployWebhookSecret = await loadDeployWebhookSecret();
  const app = createApp({ deployWebhookSecret });

  const server = app.listen(port, host, () => {
    console.log(`Hermes notification server listening at http://${host}:${port}`);
  });

  function shutdown(signal: NodeJS.Signals) {
    console.log(`${signal} received; stopping notification server`);
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Notification server failed during startup', error);
  process.exitCode = 1;
});
