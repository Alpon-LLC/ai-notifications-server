import type { Request, Response } from 'express';

export function receiveContactNotification(request: Request, response: Response) {
  const notification = request.body;

  if (!notification || Object.keys(notification).length === 0) {
    return response.status(400).json({ error: 'Request body is required' });
  }

  console.log('Contact notification received', notification);

  return response.status(202).json({
    message: 'Contact notification received',
  });
}
