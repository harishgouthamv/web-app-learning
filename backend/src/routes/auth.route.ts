import { Router } from 'express';
import { login, register } from '../services/auth.service';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const result = await register(req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const result = await login(req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
