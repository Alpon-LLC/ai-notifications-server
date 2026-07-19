import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadDeployWebhookSecret,
  secretVersionResource,
} from '../src/config/deploy-secret';

test('builds short and fully qualified Secret Manager resource names', () => {
  assert.equal(
    secretVersionResource('example-project', 'deploy-secret', 'latest'),
    'projects/example-project/secrets/deploy-secret/versions/latest',
  );
  assert.equal(
    secretVersionResource(
      'ignored',
      'projects/example-project/secrets/deploy-secret',
      '7',
    ),
    'projects/example-project/secrets/deploy-secret/versions/7',
  );
});

test('loads and validates the secret at boot through the injected client', async () => {
  const calls: Array<{ name: string }> = [];
  const client = {
    async getProjectId() {
      return 'metadata-project';
    },
    async accessSecretVersion(
      request: { name: string },
    ): Promise<[{ payload: { data: Buffer } }, ...unknown[]]> {
      calls.push(request);
      return [
        {
          payload: {
            data: Buffer.from(`${'x'.repeat(40)}\n`),
          },
        },
      ];
    },
  };

  const secret = await loadDeployWebhookSecret({ env: {}, client });
  assert.equal(secret, 'x'.repeat(40));
  assert.deepEqual(calls, [
    {
      name: 'projects/metadata-project/secrets/hermes-deploy-webhook-secret/versions/latest',
    },
  ]);
});

test('allows a local secret only behind the explicit development guard', async () => {
  const localSecret = 'l'.repeat(40);
  const secret = await loadDeployWebhookSecret({
    env: {
      ALLOW_LOCAL_DEPLOY_SECRET: 'true',
      HERMES_DEPLOY_WEBHOOK_SECRET: localSecret,
      NODE_ENV: 'development',
    },
  });

  assert.equal(secret, localSecret);

  await assert.rejects(
    loadDeployWebhookSecret({
      env: {
        HERMES_DEPLOY_WEBHOOK_SECRET: localSecret,
        NODE_ENV: 'production',
      },
    }),
    /Refusing HERMES_DEPLOY_WEBHOOK_SECRET/,
  );
});