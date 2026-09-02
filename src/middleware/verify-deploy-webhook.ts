import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { log } from '../logger';

const DEFAULT_MAX_SKEW_SECONDS = 300;

export interface VerifyDeployWebhookOptions {
  secret: string;
  maxSkewSeconds?: number;
  now?: () => number;
  replayCache?: Map<string, number>;
}

export function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(left.toLowerCase(), 'hex'),
    Buffer.from(right.toLowerCase(), 'hex'),
  );
}

export function createDeployWebhookVerifier(options: VerifyDeployWebhookOptions) {
  const {
    secret,
    maxSkewSeconds = DEFAULT_MAX_SKEW_SECONDS,
    now = () => Date.now(),
    replayCache = new Map<string, number>(),
  } = options;

  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('A deployment webhook secret of at least 32 bytes is required');
  }

  return function verifyDeployWebhook(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    const timestampHeader = request.get('x-webhook-timestamp');
    const signatureHeader = request.get('x-webhook-signature');

    if (!/^\d{10}$/.test(timestampHeader || '')) {
      log('warn', 'webhook_auth_rejected', 'Webhook timestamp header is missing or malformed', {
        request_id: request.requestId,
        reason: 'invalid_timestamp_format',
      });
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    const timestamp = Number.parseInt(timestampHeader || '', 10);
    const nowSeconds = Math.floor(now() / 1000);

    if (Math.abs(nowSeconds - timestamp) > maxSkewSeconds) {
      log('warn', 'webhook_auth_rejected', 'Webhook timestamp is outside the allowed clock skew', {
        request_id: request.requestId,
        reason: 'timestamp_outside_allowed_skew',
        skew_seconds: Math.abs(nowSeconds - timestamp),
        max_skew_seconds: maxSkewSeconds,
      });
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    const suppliedSignature = /^sha256=([a-f0-9]{64})$/i.exec(
      signatureHeader || '',
    )?.[1];

    if (!suppliedSignature || !Buffer.isBuffer(request.rawBody)) {
      log('warn', 'webhook_auth_rejected', 'Webhook signature or raw request body is unavailable', {
        request_id: request.requestId,
        reason: suppliedSignature ? 'raw_body_unavailable' : 'invalid_signature_format',
      });
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestampHeader}.`, 'utf8')
      .update(request.rawBody)
      .digest('hex');

    if (!safeEqualHex(suppliedSignature, expectedSignature)) {
      log('warn', 'webhook_auth_rejected', 'Webhook signature validation failed', {
        request_id: request.requestId,
        reason: 'signature_mismatch',
      });
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    for (const [signature, expiresAt] of replayCache) {
      if (expiresAt <= nowSeconds) {
        replayCache.delete(signature);
      }
    }

    if (replayCache.has(suppliedSignature)) {
      log('warn', 'webhook_replay_rejected', 'Webhook signature was already accepted recently', {
        request_id: request.requestId,
        reason: 'replayed_signature',
      });
      return response.status(409).json({ error: 'Webhook request already received' });
    }

    replayCache.set(suppliedSignature, nowSeconds + maxSkewSeconds);
    log('info', 'webhook_auth_accepted', 'Webhook authentication succeeded', {
      request_id: request.requestId,
    });
    return next();
  };
}
