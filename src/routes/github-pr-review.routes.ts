import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { GitHubPrReviewService } from '../services/github-pr-review.service';
import { SlackService } from '../services/slack.service';
import { log } from '../logger';

const ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);
export interface GitHubPrReviewRoutesOptions { webhookSecret: string; allowedRepositories: string[]; service: GitHubPrReviewService; slackService?: SlackService }
function text(value: unknown, max: number) { return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined; }

export function createGitHubPrReviewRoutes(options: GitHubPrReviewRoutesOptions) {
  const router = Router();
  router.post('/webhooks/pull-request', async (request: Request, response) => {
    const deliveryId = text(request.get('x-github-delivery'), 100) || 'unknown';

    log('debug', 'github_pr_webhook_received', 'GitHub pull_request webhook received', {
      request_id: request.requestId,
      delivery_id: deliveryId,
      event_type: request.get('x-github-event'),
      signature_present: !!request.get('x-hub-signature-256'),
    });

    const signature = request.get('x-hub-signature-256') || '';
    const expected = `sha256=${crypto.createHmac('sha256', options.webhookSecret).update(request.rawBody || Buffer.alloc(0)).digest('hex')}`;
    if (!/^sha256=[a-f0-9]{64}$/.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      log('warn', 'github_pr_signature_invalid', 'GitHub webhook signature validation failed', {
        request_id: request.requestId,
        delivery_id: deliveryId,
      });
      return response.status(401).json({ error: 'Invalid GitHub signature' });
    }
    log('debug', 'github_pr_signature_valid', 'GitHub webhook signature validated', {
      request_id: request.requestId,
      delivery_id: deliveryId,
    });

    if (request.get('x-github-event') !== 'pull_request') {
      log('warn', 'github_pr_unsupported_event', 'GitHub event is not pull_request', {
        request_id: request.requestId,
        delivery_id: deliveryId,
        event_type: request.get('x-github-event'),
      });
      return response.status(400).json({ error: 'Unsupported GitHub event' });
    }

    const body = request.body as any; const repository = text(body?.repository?.full_name, 200); const action = text(body?.action, 50); const actor = text(body?.sender?.login, 100); const headSha = text(body?.pull_request?.head?.sha, 40); const number = body?.pull_request?.number;
    if (!deliveryId || !repository || !action || !actor || !headSha || !/^[a-f0-9]{40}$/i.test(headSha) || !Number.isSafeInteger(number) || number < 1) {
      log('warn', 'github_pr_payload_malformed', 'GitHub pull request payload is malformed', {
        request_id: request.requestId,
        delivery_id: deliveryId,
        has_repository: !!repository,
        has_action: !!action,
        has_actor: !!actor,
        has_head_sha: !!headSha,
        has_number: Number.isSafeInteger(number),
      });
      return response.status(422).json({ error: 'Malformed pull request payload' });
    }

    log('debug', 'github_pr_payload_parsed', 'Pull request payload parsed successfully', {
      request_id: request.requestId,
      delivery_id: deliveryId,
      repository,
      action,
      actor,
      number,
      head_sha: headSha.slice(0, 8),
    });

    if (!ACTIONS.has(action)) {
      log('debug', 'github_pr_action_skipped', 'Pull request action is not in the allowed set', {
        request_id: request.requestId,
        delivery_id: deliveryId,
        action,
        allowed_actions: Array.from(ACTIONS),
      });
      return response.status(422).json({ error: 'Unsupported pull request action' });
    }

    if (!options.allowedRepositories.includes(repository)) {
      log('warn', 'github_pr_repo_not_allowed', 'Pull request repository is not in the allowed list', {
        request_id: request.requestId,
        delivery_id: deliveryId,
        repository,
        allowed_repositories: options.allowedRepositories,
      });
      return response.status(403).json({ error: 'Repository is not allowed' });
    }

    log('debug', 'github_pr_enqueueing', 'Enqueuing pull request for processing', {
      request_id: request.requestId,
      delivery_id: deliveryId,
      repository,
      action,
      number,
      actor,
    });

    if (!(await options.service.enqueue({ deliveryId, action, repository, number, actor, headSha }))) {
      log('debug', 'github_pr_duplicate_skipped', 'Duplicate delivery, skipping', {
        request_id: request.requestId,
        delivery_id: deliveryId,
      });
      return response.status(409).json({ error: 'Duplicate delivery', delivery_id: deliveryId });
    }

    log('info', 'github_pr_enqueued', 'Pull request enqueued for review processing', {
      request_id: request.requestId,
      delivery_id: deliveryId,
      repository,
      action,
      number,
      actor,
    });

    // DISABLED 2026-09-11: PR-opened Slack notifications are handled by
    // per-repo GitHub Actions workflows; this path double-notified. The
    // review-started notification (service-level, below) remains active.
    // if (action === 'opened' && options.slackService) {
    //   const title = text(body?.pull_request?.title, 500) || 'No title';
    //   const url = text(body?.pull_request?.html_url, 2000) || '';
    //   log('debug', 'github_pr_slack_triggering', 'Triggering Slack notification for new PR', {
    //     request_id: request.requestId,
    //     delivery_id: deliveryId,
    //     repository,
    //     number,
    //     actor,
    //   });
    //   await options.slackService.sendPrNotification({ deliveryId, repository, number, actor, action, title, url });
    // }

    return response.status(202).json({ delivery_id: deliveryId, status: 'queued', status_url: `/api/github/reviews/${deliveryId}` });
  });
  router.get('/reviews/:deliveryId', (request, response) => {
    const status = options.service.getStatus(request.params.deliveryId);
    if (!status) {
      log('debug', 'github_pr_status_not_found', 'Review status lookup returned no result', {
        request_id: request.requestId,
        delivery_id: request.params.deliveryId,
      });
      return response.status(404).json({ error: 'Review delivery not found' });
    }
    log('debug', 'github_pr_status_returned', 'Review status returned', {
      request_id: request.requestId,
      delivery_id: request.params.deliveryId,
      status: status.status,
    });
    return response.json(status);
  });
  return router;
}
