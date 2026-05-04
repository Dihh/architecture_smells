import { Router } from 'express';
import { get } from '../db.js';

const router = Router();

async function handleUserinfo(req, res) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const accessToken = authHeader.slice(7);
  const now = Math.floor(Date.now() / 1000);

  const token = await get('SELECT * FROM tokens WHERE access_token = ?', [accessToken]);

  if (!token) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  if (token.expires_at < now) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [token.user_id]);

  const response = { sub: String(token.user_id) };

  if (token.scope.split(' ').includes('email')) {
    response.email = user.email;
  }

  res.status(200).json(response);
}

router.get('/userinfo', handleUserinfo);
router.post('/userinfo', (req, res) => res.status(405).json({ error: 'method_not_allowed' }));

export default router;
