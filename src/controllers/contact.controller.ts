import type { Request, Response } from 'express';
import { log } from '../logger';

export function receiveContactNotification(request: Request, response: Response) {
  const notification = request.body;

  if (!notification || Object.keys(notification).length === 0) {
    log('warn', 'contact_notification_rejected', 'Contact notification body is empty', {
      request_id: request.requestId,
    });
    return response.status(400).json({ error: 'Request body is required' });
  }

  log('info', 'contact_notification_received', 'Contact notification accepted', {
    request_id: request.requestId,
    fields: Object.keys(notification).sort(),
  });

  return response.status(202).json({
    message: 'Contact notification received',
  });
}
