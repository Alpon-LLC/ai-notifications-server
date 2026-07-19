import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';

import { createApp } from '../src/app';
import { DeploymentService } from '../src/services/deployment.service';

const secret = 'test-secret-'.repeat(6);

function signedHeaders(timestamp: string, body: string) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(body)
    .digest('hex');

  return {
    'content-type': 'application/json',
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': `sha256=${signature}`,
  };
}

async function waitForTerminalStatus(baseUrl: string, jobId: string, statusToken: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(
      `${baseUrl}/api/deployments/deploy/${jobId}`,
      { headers: { authorization: `Bearer ${statusToken}` } },
    );
    const result = await response.json();

    if (!['queued', 'running'].includes(result.status)) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Deployment job did not finish during test');
}

test('accepts a signed deployment, polls it, and rejects a replay', async (t) => {
  const commands: string[] = [];
  const deploymentService = new DeploymentService({
    commandRunner: async (command) => {
      commands.push(command);
      return command.includes('hermes-stop')
        ? { exitCode: 0, signal: null, output: 'stopped\n' }
        : { exitCode: 20, signal: null, output: 'capture created\n' };
    },
  });
  const app = createApp({ deployWebhookSecret: secret, deploymentService });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    request_id: '1234-1',
    repository: 'Alpon-LLC/hermes-agent-config',
    git_sha: 'a'.repeat(40),
    actor: 'octocat',
    target_branch: 'main',
  });
  const headers = signedHeaders(timestamp, body);

  const acceptedResponse = await fetch(
    `${baseUrl}/api/deployments/deploy`,
    { method: 'POST', headers, body },
  );
  assert.equal(acceptedResponse.status, 202);
  const accepted = await acceptedResponse.json();
  assert.ok(accepted.job_id);
  assert.equal(accepted.status_token.length, 64);

  const completed = await waitForTerminalStatus(
    baseUrl,
    accepted.job_id,
    accepted.status_token,
  );
  assert.equal(completed.status, 'capture_pr_created');
  assert.equal(completed.exit_code, 20);
  assert.equal(commands.length, 2);

  const replayResponse = await fetch(
    `${baseUrl}/api/deployments/deploy`,
    { method: 'POST', headers, body },
  );
  assert.equal(replayResponse.status, 409);
});

test('completes a dry run without invoking stop or deployment commands', async (t) => {
  const commands: string[] = [];
  const deploymentService = new DeploymentService({
    commandRunner: async (command) => {
      commands.push(command);
      throw new Error('Dry run must not invoke commands');
    },
    dryRunDelayMs: 1,
  });
  const app = createApp({ deployWebhookSecret: secret, deploymentService });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    request_id: 'dry-run-1',
    repository: 'Alpon-LLC/hermes-agent-config',
    git_sha: 'c'.repeat(40),
    actor: 'octocat',
    target_branch: 'main',
    dry_run: true,
  });

  const acceptedResponse = await fetch(
    `${baseUrl}/api/deployments/deploy`,
    { method: 'POST', headers: signedHeaders(timestamp, body), body },
  );
  assert.equal(acceptedResponse.status, 202);
  const accepted = await acceptedResponse.json();
  const completed = await waitForTerminalStatus(
    baseUrl,
    accepted.job_id,
    accepted.status_token,
  );

  assert.equal(completed.status, 'dry_run_completed');
  assert.equal(completed.exit_code, 0);
  assert.match(completed.output, /gateways.*not touched/i);
  assert.deepEqual(commands, []);
});

test('rejects an invalid deployment signature', async (t) => {
  const app = createApp({ deployWebhookSecret: secret });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/deployments/deploy`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': Math.floor(Date.now() / 1000).toString(),
        'x-webhook-signature': `sha256=${'0'.repeat(64)}`,
      },
      body: '{}',
    },
  );

  assert.equal(response.status, 401);
});

test('rejects the retired Hermes-specific authentication headers', async (t) => {
  const app = createApp({ deployWebhookSecret: secret });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    request_id: '1234-2',
    repository: 'Alpon-LLC/hermes-agent-config',
    git_sha: 'b'.repeat(40),
    actor: 'octocat',
    target_branch: 'main',
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(body)
    .digest('hex');

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/deployments/deploy`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hermes-timestamp': timestamp,
        'x-hermes-signature': `sha256=${signature}`,
      },
      body,
    },
  );

  assert.equal(response.status, 401);
});

test('rejects stale timestamps and malformed generic headers', async (t) => {
  const app = createApp({ deployWebhookSecret: secret });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const body = '{}';
  const staleTimestamp = (Math.floor(Date.now() / 1000) - 301).toString();

  const staleResponse = await fetch(
    `${baseUrl}/api/deployments/deploy`,
    {
      method: 'POST',
      headers: signedHeaders(staleTimestamp, body),
      body,
    },
  );
  assert.equal(staleResponse.status, 401);

  const malformedResponse = await fetch(
    `${baseUrl}/api/deployments/deploy`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': 'not-a-timestamp',
        'x-webhook-signature': 'not-a-signature',
      },
      body,
    },
  );
  assert.equal(malformedResponse.status, 401);
});