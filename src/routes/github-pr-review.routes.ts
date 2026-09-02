import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { GitHubPrReviewService } from '../services/github-pr-review.service';
import { SlackService } from '../services/slack.service';

const ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);
export interface GitHubPrReviewRoutesOptions { webhookSecret: string; allowedRepositories: string[]; service: GitHubPrReviewService; slackService?: SlackService }
function text(value: unknown, max: number) { return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined; }

export function createGitHubPrReviewRoutes(options: GitHubPrReviewRoutesOptions) {
  const router = Router();
  router.post('/webhooks/pull-request', async (request: Request, response) => {
    const signature = request.get('x-hub-signature-256') || '';
    const expected = `sha256=${crypto.createHmac('sha256', options.webhookSecret).update(request.rawBody || Buffer.alloc(0)).digest('hex')}`;
    if (!/^sha256=[a-f0-9]{64}$/.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return response.status(401).json({ error: 'Invalid GitHub signature' });
    if (request.get('x-github-event') !== 'pull_request') return response.status(400).json({ error: 'Unsupported GitHub event' });
    const deliveryId = text(request.get('x-github-delivery'), 100);
    const body = request.body as any; const repository = text(body?.repository?.full_name, 200); const action = text(body?.action, 50); const actor = text(body?.sender?.login, 100); const headSha = text(body?.pull_request?.head?.sha, 40); const number = body?.pull_request?.number;
    if (!deliveryId || !repository || !action || !actor || !headSha || !/^[a-f0-9]{40}$/i.test(headSha) || !Number.isSafeInteger(number) || number < 1) return response.status(422).json({ error: 'Malformed pull request payload' });
    if (!ACTIONS.has(action)) return response.status(422).json({ error: 'Unsupported pull request action' });
    if (!options.allowedRepositories.includes(repository)) return response.status(403).json({ error: 'Repository is not allowed' });
    if (!(await options.service.enqueue({ deliveryId, action, repository, number, actor, headSha }))) return response.status(409).json({ error: 'Duplicate delivery', delivery_id: deliveryId });

    if (action === 'opened' && options.slackService) {
      const title = text(body?.pull_request?.title, 500) || 'No title';
      const url = text(body?.pull_request?.html_url, 2000) || '';
      await options.slackService.sendPrNotification({ deliveryId, repository, number, actor, action, title, url });
    }

    return response.status(202).json({ delivery_id: deliveryId, status: 'queued', status_url: `/api/github/reviews/${deliveryId}` });
  });
  router.get('/reviews/:deliveryId', (request, response) => { const status = options.service.getStatus(request.params.deliveryId); return status ? response.json(status) : response.status(404).json({ error: 'Review delivery not found' }); });
  return router;
}
