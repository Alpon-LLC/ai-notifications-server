import crypto from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { log } from '../logger';

export interface PullRequestSnapshot { title: string; body: string; htmlUrl: string; headSha: string; baseSha: string; baseRef: string; files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }> }
export interface GitHubClient { getPullRequestAtHead(repository: string, number: number, headSha: string): Promise<PullRequestSnapshot> }
export interface DeliveryStore { claim(deliveryId: string): Promise<boolean> }
export type ReviewStatus = { delivery_id: string; status: 'queued' | 'running' | 'forwarded' | 'failed'; error?: string };

export class MemoryDeliveryStore implements DeliveryStore {
  private readonly deliveries = new Set<string>();
  async claim(id: string) { if (this.deliveries.has(id)) return false; this.deliveries.add(id); return true; }
}

export class FileDeliveryStore implements DeliveryStore {
  constructor(private readonly directory: string) {}
  async claim(id: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { const handle = await open(join(this.directory, id), 'wx', 0o600); await handle.close(); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  }
}

export class RestGitHubClient implements GitHubClient {
  constructor(private readonly token: string) {}
  private async request(path: string) {
    log('debug', 'github_api_request', 'Fetching from GitHub API', { path });
    const response = await fetch(`https://api.github.com${path}`, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'user-agent': 'hermes-notification-server', 'x-github-api-version': '2022-11-28' } });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return response.json() as Promise<any>;
  }
  async getPullRequestAtHead(repository: string, number: number, headSha: string) {
    log('debug', 'github_pr_snapshot_start', 'Fetching pull request snapshot from GitHub', {
      repository,
      number,
      head_sha: headSha.slice(0, 8),
    });
    const [pr, files] = await Promise.all([this.request(`/repos/${repository}/pulls/${number}`), this.request(`/repos/${repository}/pulls/${number}/files?per_page=100`)]);
    if (pr.head?.sha !== headSha) throw new Error('Pull request head changed before review snapshot');
    log('debug', 'github_pr_snapshot_complete', 'Pull request snapshot fetched', {
      repository,
      number,
      file_count: files.length,
      title: pr.title?.slice(0, 100),
    });
    return { title: pr.title, body: pr.body || '', htmlUrl: pr.html_url, headSha, baseSha: pr.base.sha, baseRef: pr.base.ref, files: files.map((file: any) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch })) };
  }
}

export interface ReviewRequest { deliveryId: string; action: string; repository: string; number: number; actor: string; headSha: string }
export class GitHubPrReviewService {
  private readonly statuses = new Map<string, ReviewStatus>();
  constructor(private readonly options: { githubClient: GitHubClient; deliveryStore: DeliveryStore; internalSecret: string; johnUrl?: string; forwarder?: (body: string, headers: Record<string, string>) => Promise<void> }) {}
  async enqueue(request: ReviewRequest) {
    if (!(await this.options.deliveryStore.claim(request.deliveryId))) return false;
    this.statuses.set(request.deliveryId, { delivery_id: request.deliveryId, status: 'queued' });
    setImmediate(() => void this.process(request));
    return true;
  }
  getStatus(id: string) { return this.statuses.get(id); }
  private async process(request: ReviewRequest) {
    log('debug', 'github_pr_process_start', 'Starting pull request review processing', {
      delivery_id: request.deliveryId,
      repository: request.repository,
      number: request.number,
      action: request.action,
      actor: request.actor,
      head_sha: request.headSha.slice(0, 8),
    });
    this.statuses.set(request.deliveryId, { delivery_id: request.deliveryId, status: 'running' });
    try {
      const snapshot = await this.options.githubClient.getPullRequestAtHead(request.repository, request.number, request.headSha);
      const bounded = { schema_version: 1, delivery_id: request.deliveryId, action: request.action, repository: request.repository.slice(0, 200), actor: request.actor.slice(0, 100), pull_request: { number: request.number, title: snapshot.title.slice(0, 500), body: snapshot.body.slice(0, 20_000), url: snapshot.htmlUrl.slice(0, 1000), head_sha: snapshot.headSha, base_sha: snapshot.baseSha, base_ref: snapshot.baseRef.slice(0, 255) }, files: snapshot.files.slice(0, 100).map((file) => ({ ...file, filename: file.filename.slice(0, 1000), patch: file.patch?.slice(0, 20_000) })) };
      const body = JSON.stringify(bounded);
      const headers = { 'content-type': 'application/json', 'x-webhook-signature': crypto.createHmac('sha256', this.options.internalSecret).update(body).digest('hex'), 'x-github-delivery': request.deliveryId };
      log('debug', 'github_pr_forwarding', 'Forwarding review payload', {
        delivery_id: request.deliveryId,
        repository: request.repository,
        number: request.number,
        payload_bytes: Buffer.byteLength(body),
        target: this.options.forwarder ? 'custom_forwarder' : (this.options.johnUrl ?? 'http://127.0.0.1:8642/webhooks/github-pr-review'),
      });
      if (this.options.forwarder) await this.options.forwarder(body, headers);
      else { const response = await fetch(this.options.johnUrl ?? 'http://127.0.0.1:8642/webhooks/github-pr-review', { method: 'POST', headers, body }); if (!response.ok) throw new Error(`John webhook returned ${response.status}`); }
      this.statuses.set(request.deliveryId, { delivery_id: request.deliveryId, status: 'forwarded' });
      log('info', 'github_pr_process_complete', 'Pull request review forwarded successfully', {
        delivery_id: request.deliveryId,
        repository: request.repository,
        number: request.number,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown failure';
      log('error', 'github_pr_process_failed', 'Pull request review processing failed', {
        delivery_id: request.deliveryId,
        repository: request.repository,
        number: request.number,
      }, error);
      this.statuses.set(request.deliveryId, { delivery_id: request.deliveryId, status: 'failed', error: errorMessage });
    }
  }
}

export function defaultDeliveryDirectory() { return process.env.GITHUB_DELIVERY_STORE_DIR || join(dirname(process.cwd()), '.github-webhook-deliveries'); }
