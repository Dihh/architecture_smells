import { createHash, createSign, randomBytes } from 'crypto';
import { Router } from 'express';
import { get, run } from '../db.js';
import { getPrivateKey, getJwks } from '../keys.js';

const router = Router();

function extractClient(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep !== -1) {
      return { client_id: decoded.slice(0, sep), client_secret: decoded.slice(sep + 1) };
    }
  }
  const { client_id, client_secret } = req.body;
  if (client_id) {
    return { client_id, client_secret };
  }
  return null;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

router.post('/oauth2/token', async (req, res) => {
  const { grant_type, code, redirect_uri, code_verifier } = req.body;

  // Client authentication
  const creds = extractClient(req);
  if (!creds || !creds.client_id) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const client = await get('SELECT * FROM clients WHERE client_id = ?', [creds.client_id]);
  if (!client) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  if (client.client_secret !== creds.client_secret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Parameter validation
  if (!grant_type) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  if (!code) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // Authorization code validation
  const authCode = await get('SELECT * FROM auth_codes WHERE code = ?', [code]);
  const now = Math.floor(Date.now() / 1000);

  if (!authCode) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  if (authCode.used === 1) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  if (authCode.expires_at < now) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  if (authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  if (authCode.client_id !== creds.client_id) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // PKCE verification
  if (authCode.code_challenge) {
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const digest = base64url(createHash('sha256').update(code_verifier).digest());
    if (digest !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }

  // Mark code as used (replay prevention)
  await run('UPDATE auth_codes SET used = 1 WHERE id = ?', [authCode.id]);

  // Issue access token
  const accessToken = randomBytes(32).toString('hex');
  const expiresAt = now + 3600;

  await run(
    'INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
    [accessToken, authCode.client_id, authCode.user_id, authCode.scope, expiresAt]
  );

  // Build and sign id_token JWT
  const jwks = getJwks();
  const kid = jwks.keys[0].kid;
  const issuer = `${req.protocol}://${req.get('host')}`;

  const jwtHeader = { alg: 'RS256', kid };
  const jwtPayload = {
    sub: String(authCode.user_id),
    iss: issuer,
    aud: authCode.client_id,
    exp: expiresAt,
    iat: now,
  };

  const headerB64 = base64url(Buffer.from(JSON.stringify(jwtHeader)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(jwtPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(getPrivateKey(), 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const idToken = `${signingInput}.${signature}`;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    access_token: accessToken,
    id_token: idToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
});

export default router;
