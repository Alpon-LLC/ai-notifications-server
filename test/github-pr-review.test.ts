import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '../src/app';
import { GitHubPrReviewService, MemoryDeliveryStore, type GitHubClient } from '../src/services/github-pr-review.service';

const githubSecret = 'github-test-secret';
const internalSecret = 'internal-test-secret';
const sha = 'a'.repeat(40);
const payload = { action: 'opened', repository: { full_name: 'Alpon-LLC/example' }, sender: { login: 'alice' }, pull_request: { number: 7, title: 'Improve API', body: 'Context', html_url: 'https://github.com/Alpon-LLC/example/pull/7', head: { sha, ref: 'feature' }, base: { sha: 'b'.repeat(40), ref: 'main' } } };

function signature(body: string, secret = githubSecret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function fixture(t: test.TestContext) {
  const forwarded: { body: string; signature: string }[] = [];
  const githubClient: GitHubClient = { getPullRequestAtHead: async (_repo, _number, headSha) => ({ title: 'Canonical title', body: 'Canonical body', htmlUrl: 'https://github.com/Alpon-LLC/example/pull/7', headSha, baseSha: 'b'.repeat(40), baseRef: 'main', files: [{ filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }] }) };
  const service = new GitHubPrReviewService({ githubClient, deliveryStore: new MemoryDeliveryStore(), internalSecret, forwarder: async (body, headers) => { forwarded.push({ body, signature: headers['x-webhook-signature']! }); } });
  const app = createApp({ deployWebhookSecret: 'deploy-test-secret-'.repeat(3), githubPrReview: { webhookSecret: githubSecret, allowedRepositories: ['Alpon-LLC/example'], service } });
  const server = app.listen(0, '127.0.0.1'); t.after(() => server.close()); await once(server, 'listening');
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, forwarded };
}

async function post(baseUrl: string, body: string, overrides: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/github/webhooks/pull-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(body), 'x-github-event': 'pull_request', 'x-github-delivery': crypto.randomUUID(), ...overrides }, body });
}

async function waitForForward(baseUrl: string, delivery: string) {
  for (let i = 0; i < 30; i += 1) { const response = await fetch(`${baseUrl}/api/github/reviews/${delivery}`); const data = await response.json(); if (data.status !== 'queued' && data.status !== 'running') return data; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error('review did not finish');
}

test('accepts, fetches exact SHA, signs bounded internal forwarding, and exposes status', async (t) => {
  const { baseUrl, forwarded } = await fixture(t); const body = JSON.stringify(payload); const delivery = crypto.randomUUID();
  const response = await post(baseUrl, body, { 'x-github-delivery': delivery }); assert.equal(response.status, 202); assert.equal((await response.json()).delivery_id, delivery);
  assert.equal((await waitForForward(baseUrl, delivery)).status, 'forwarded'); assert.equal(forwarded.length, 1);
  const sent = forwarded[0]!; assert.equal(sent.signature, crypto.createHmac('sha256', internalSecret).update(sent.body).digest('hex'));
  const parsed = JSON.parse(sent.body); assert.equal(parsed.pull_request.head_sha, sha); assert.equal(parsed.pull_request.title, 'Canonical title'); assert.equal(parsed.files.length, 1);
});

test('rejects invalid signature', async (t) => { const { baseUrl } = await fixture(t); const response = await post(baseUrl, JSON.stringify(payload), { 'x-hub-signature-256': signature('{}') }); assert.equal(response.status, 401); });
test('rejects wrong event and unsupported action', async (t) => { const { baseUrl } = await fixture(t); const body = JSON.stringify(payload); assert.equal((await post(baseUrl, body, { 'x-github-event': 'push' })).status, 400); const unsupported = JSON.stringify({ ...payload, action: 'closed' }); assert.equal((await post(baseUrl, unsupported)).status, 422); });
test('rejects malformed schema', async (t) => { const { baseUrl } = await fixture(t); assert.equal((await post(baseUrl, JSON.stringify({ action: 'opened' }))).status, 422); });
test('rejects duplicate delivery deterministically', async (t) => { const { baseUrl } = await fixture(t); const body = JSON.stringify(payload); const delivery = crypto.randomUUID(); assert.equal((await post(baseUrl, body, { 'x-github-delivery': delivery })).status, 202); assert.equal((await post(baseUrl, body, { 'x-github-delivery': delivery })).status, 409); });
test('rejects repository outside allowlist', async (t) => { const { baseUrl } = await fixture(t); const body = JSON.stringify({ ...payload, repository: { full_name: 'evil/fork' } }); assert.equal((await post(baseUrl, body)).status, 403); });

test('sends review-started notification after successful forward on opened', async (t) => {
  const sent: { deliveryId: string; repository: string; number: number; action: string }[] = [];
  const forwarded: { body: string }[] = [];
  const githubClient: GitHubClient = { getPullRequestAtHead: async (_r, _n, headSha) => ({ title: 'Canonical title', body: '', htmlUrl: 'https://github.com/Alpon-LLC/example/pull/7', headSha, baseSha: 'b'.repeat(40), baseRef: 'main', files: [] }) };
  const slackCalls: unknown[] = [];
  const slackService = { sendReviewStartedNotification: async (p: { deliveryId: string; repository: string; number: number; action: string }) => { sent.push(p); slackCalls.push(p); return true; } };
  const service = new GitHubPrReviewService({ githubClient, deliveryStore: new MemoryDeliveryStore(), internalSecret, forwarder: async (body) => { forwarded.push({ body, signature: 'x' }); }, slackService });
  const app = createApp({ deployWebhookSecret: 'deploy-test-secret-'.repeat(3), githubPrReview: { webhookSecret: githubSecret, allowedRepositories: ['Alpon-LLC/example'], service } });
  const server = app.listen(0, '127.0.0.1'); t.after(() => server.close()); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const delivery = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/github/webhooks/pull-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(JSON.stringify(payload)), 'x-github-event': 'pull_request', 'x-github-delivery': delivery }, body: JSON.stringify(payload) });
  assert.equal(response.status, 202);
  assert.equal((await waitForForward(baseUrl, delivery)).status, 'forwarded');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.deliveryId, delivery);
  assert.equal(sent[0]!.repository, 'Alpon-LLC/example');
  assert.equal(sent[0]!.number, 7);
  assert.equal(sent[0]!.action, 'opened');
});

test('does not send review-started notification for non-opened actions or forward failures', async (t) => {
  const sent: unknown[] = [];
  const slackService = { sendReviewStartedNotification: async () => { sent.push(1); return true; } };
  // synchronize action: notification must NOT fire (only 'opened' triggers it)
  const githubClient: GitHubClient = { getPullRequestAtHead: async (_r, _n, headSha) => ({ title: 'T', body: '', htmlUrl: 'https://x', headSha, baseSha: 'b'.repeat(40), baseRef: 'main', files: [] }) };
  const service = new GitHubPrReviewService({ githubClient, deliveryStore: new MemoryDeliveryStore(), internalSecret, forwarder: async () => {}, slackService });
  const app = createApp({ deployWebhookSecret: 'deploy-test-secret-'.repeat(3), githubPrReview: { webhookSecret: githubSecret, allowedRepositories: ['Alpon-LLC/example'], service } });
  const server = app.listen(0, '127.0.0.1'); t.after(() => server.close()); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const syncPayload = JSON.stringify({ ...payload, action: 'synchronize' });
  const r1 = await fetch(`${baseUrl}/api/github/webhooks/pull-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(syncPayload), 'x-github-event': 'pull_request', 'x-github-delivery': crypto.randomUUID() }, body: syncPayload });
  assert.equal(r1.status, 202);
  // failed forward: forwarder throws -> no notification
  const failClient: GitHubClient = { getPullRequestAtHead: async () => { throw new Error('boom'); } };
  const failService = new GitHubPrReviewService({ githubClient: failClient, deliveryStore: new MemoryDeliveryStore(), internalSecret, forwarder: async () => {}, slackService });
  const app2 = createApp({ deployWebhookSecret: 'deploy-test-secret-'.repeat(3), githubPrReview: { webhookSecret: githubSecret, allowedRepositories: ['Alpon-LLC/example'], service: failService } });
  const server2 = app2.listen(0, '127.0.0.1'); t.after(() => server2.close()); await once(server2, 'listening');
  const base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  const delivery = crypto.randomUUID();
  const r2 = await fetch(`${base2}/api/github/webhooks/pull-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(JSON.stringify(payload)), 'x-github-event': 'pull_request', 'x-github-delivery': delivery }, body: JSON.stringify(payload) });
  assert.equal(r2.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 0);
});
