import { findTokenByAccessToken, findUserById } from './database.js';

export async function handleUserInfoGet(req, res, db) {
  const accessToken = getBearerToken(req.get('authorization'));

  if (!accessToken) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const token = await findTokenByAccessToken(db, accessToken);
  const now = Math.floor(Date.now() / 1000);

  if (!token || token.expires_at < now) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const user = await findUserById(db, token.user_id);
  if (!user) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  res.status(200).json({
    sub: String(user.id),
    email: user.email,
  });
}

function getBearerToken(authorizationHeader) {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(/\s+/, 2);
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}
