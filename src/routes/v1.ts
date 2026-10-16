import { Router } from 'express';
import { ok } from '../utils/response';

const router = Router();

router.get('/health', (_req, res) => {
  res.json(ok({ status: 'ok' }, { total: 0, limit: 0, offset: 0, hasMore: false }));
});

export default router;
