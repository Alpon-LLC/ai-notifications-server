import { Router } from 'express';

import { receiveContactNotification } from '../controllers/contact.controller';

const router = Router();

router.post('/', receiveContactNotification);

export default router;
