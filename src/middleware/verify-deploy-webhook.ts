import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

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
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    const timestamp = Number.parseInt(timestampHeader || '', 10);
    const nowSeconds = Math.floor(now() / 1000);

    if (Math.abs(nowSeconds - timestamp) > maxSkewSeconds) {
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    const suppliedSignature = /^sha256=([a-f0-9]{64})$/i.exec(
      signatureHeader || '',
    )?.[1];

    if (!suppliedSignature || !Buffer.isBuffer(request.rawBody)) {
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestampHeader}.`, 'utf8')
      .update(request.rawBody)
      .digest('hex');

    if (!safeEqualHex(suppliedSignature, expectedSignature)) {
      return response.status(401).json({ error: 'Invalid webhook authentication' });
    }

    for (const [signature, expiresAt] of replayCache) {
      if (expiresAt <= nowSeconds) {
        replayCache.delete(signature);
      }
    }

    if (replayCache.has(suppliedSignature)) {
      return response.status(409).json({ error: 'Webhook request already received' });
    }

    replayCache.set(suppliedSignature, nowSeconds + maxSkewSeconds);
    return next();
  };
}