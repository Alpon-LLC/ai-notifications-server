import { PrismaClient } from '@prisma/client';
import { log } from '../logger';

export interface SlackNotificationPayload {
  deliveryId: string;
  repository: string;
  number: number;
  actor: string;
  action: string;
  title: string;
  url: string;
}

export interface SlackServiceOptions {
  botToken: string;
  prisma: PrismaClient;
}

export class SlackService {
  private readonly botToken: string;
  private readonly prisma: PrismaClient;

  constructor(options: SlackServiceOptions) {
    this.botToken = options.botToken;
    this.prisma = options.prisma;
  }

  async sendPrNotification(payload: SlackNotificationPayload): Promise<boolean> {
    if (!this.botToken) {
      log('warn', 'slack_token_missing', 'SLACK_BOT_TOKEN is not configured', {
        delivery_id: payload.deliveryId,
      });
      return false;
    }

    const channelId = process.env.PR_SLACK_CHANNEL_ID;
    if (!channelId) {
      log('warn', 'slack_channel_missing', 'PR_SLACK_CHANNEL_ID is not configured', {
        delivery_id: payload.deliveryId,
      });
      return false;
    }

    const existingEvent = await this.prisma.prNotificationEvent.findUnique({
      where: { payloadId: payload.deliveryId },
    });

    if (existingEvent) {
      log('info', 'slack_notification_skipped', 'PR notification already processed', {
        delivery_id: payload.deliveryId,
      });
      return false;
    }

    try {
      const message = this.formatPrMessage(payload, channelId);
      log('debug', 'slack_api_calling', 'Sending message to Slack API', {
        delivery_id: payload.deliveryId,
        channel: channelId,
        method: 'chat.postMessage',
      });
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${this.botToken}`,
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log('error', 'slack_send_failed', `Slack API returned ${response.status}`, {
          delivery_id: payload.deliveryId,
          status: response.status,
          error: errorText,
        });
        return false;
      }

      log('debug', 'slack_api_response_ok', 'Slack API responded successfully', {
        delivery_id: payload.deliveryId,
        status: response.status,
      });

      await this.prisma.prNotificationEvent.create({
        data: {
          eventType: 'pr_open',
          payloadId: payload.deliveryId,
          payload: JSON.stringify(payload),
        },
      });

      log('info', 'slack_notification_sent', 'PR notification sent to Slack', {
        delivery_id: payload.deliveryId,
        repository: payload.repository,
        number: payload.number,
        channel: channelId,
      });

      return true;
    } catch (error) {
      log('error', 'slack_send_error', 'Failed to send Slack notification', {
        delivery_id: payload.deliveryId,
      }, error);
      return false;
    }
  }

  private formatPrMessage(payload: SlackNotificationPayload, channelId: string) {
    return {
      channel: channelId,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚀 New Pull Request: ${payload.repository}#${payload.number}`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Repository:*\n${payload.repository}`,
            },
            {
              type: 'mrkdwn',
              text: `*PR #${payload.number}:*\n<${payload.url}|View PR>`,
            },
            {
              type: 'mrkdwn',
              text: `*Author:*\n${payload.actor}`,
            },
            {
              type: 'mrkdwn',
              text: `*Action:*\n${payload.action}`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Delivery ID: ${payload.deliveryId}`,
            },
          ],
        },
      ],
    };
  }
}
