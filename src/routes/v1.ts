import { Router } from 'express';
import { okItem } from '../utils/response';
import categories from './categories';
import products from './products';
import customers from './customers';
import orders from './orders';

const router = Router();

router.get('/health', (_req, res) => {
  res.json(okItem({ status: 'ok' }));
});

// One file per resource group, as specified for Stage 5.
router.use('/categories', categories);
router.use('/products', products);
router.use('/customers', customers);
router.use('/orders', orders);

export default router;
