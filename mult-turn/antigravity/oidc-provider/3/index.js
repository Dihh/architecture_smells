import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { initDb, db } from './db.js';
import { getKeys, getJwks } from './keys.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

let keys = null;

// Middleware to ensure all JSON responses have Content-Type: application/json
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    if (res.getHeader('Content-Type') === undefined) {
      res.setHeader('Content-Type', 'application/json');
    }
    return originalJson.call(this, body);
  };
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(200).json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth2/authorize`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    userinfo_endpoint: `${baseUrl}/userinfo`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256']
  });
});

app.get('/.well-known/jwks.json', (req, res) => {
  if (!keys) {
    return res.status(500).json({ error: 'Keys not initialized' });
  }
  const jwks = getJwks(keys.publicKey, keys.kid);
  res.status(200).json(jwks);
});

function renderLoginForm(res, params, error = null) {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = params;
  res.setHeader('Content-Type', 'text/html');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login - OIDC Provider</title>
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; }
        form { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 300px; }
        h2 { text-align: center; color: #1c1e21; }
        .error { color: #d32f2f; background: #ffebee; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 14px; text-align: center; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background: #1877f2; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
        button:hover { background: #166fe5; }
      </style>
    </head>
    <body>
      <form method="POST" action="/oauth2/authorize">
        <h2>Login</h2>
        ${error ? `<div class="error">${error}</div>` : ''}
        <input type="hidden" name="client_id" value="${client_id}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="state" value="${state || ''}">
        <input type="hidden" name="response_type" value="${response_type}">
        <input type="hidden" name="scope" value="${scope}">
        ${code_challenge ? `<input type="hidden" name="code_challenge" value="${code_challenge}">` : ''}
        ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${code_challenge_method}">` : ''}
        
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        
        <button type="submit">Authorize</button>
      </form>
    </body>
    </html>
  `);
}

app.get('/oauth2/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  if (!client_id || !redirect_uri || !response_type || !scope) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only code is supported' });
  }

  if (!scope.split(' ').includes('openid')) {
    return res.status(400).json({ error: 'invalid_scope', error_description: 'Missing openid scope' });
  }

  const client = await db.get('SELECT * FROM clients WHERE client_id = ?', client_id);
  if (!client) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Client not found' });
  }

  const allowedRedirectUris = JSON.parse(client.redirect_uris);
  if (!allowedRedirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Redirect URI not allowed' });
  }

  renderLoginForm(res, req.query);
});

app.post('/oauth2/authorize', async (req, res) => {
  const { 
    client_id, redirect_uri, response_type, scope, state, 
    username, password,
    code_challenge, code_challenge_method 
  } = req.body;

  const user = await db.get('SELECT * FROM users WHERE username = ?', username);

  if (!user || user.password !== password) {
    return renderLoginForm(res, req.body, 'Invalid username or password');
  }

  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  await db.run(`
    INSERT INTO auth_codes (
      code, client_id, user_id, redirect_uri, scope, 
      code_challenge, code_challenge_method, expires_at, used
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code, client_id, user.id, redirect_uri, scope,
    code_challenge || null, code_challenge_method || null,
    expiresAt, 0
  ]);

  let redirectUrl = `${redirect_uri}?code=${code}`;
  if (state) {
    redirectUrl += `&state=${encodeURIComponent(state)}`;
  }

  res.redirect(302, redirectUrl);
});

app.post('/oauth2/token', async (req, res) => {
  let { client_id, client_secret, grant_type, code, redirect_uri } = req.body;

  // Client authentication
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const encoded = authHeader.split(' ')[1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [headerId, ...secretParts] = decoded.split(':');
    client_id = headerId;
    client_secret = secretParts.join(':');
  }

  if (!client_id) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const client = await db.get('SELECT * FROM clients WHERE client_id = ?', client_id);
  if (!client || client.client_secret !== client_secret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Request validation
  if (!grant_type || !code || !redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // Code validation
  const authCode = await db.get('SELECT * FROM auth_codes WHERE code = ?', code);

  if (!authCode) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (authCode.used === 1 || authCode.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (authCode.redirect_uri !== redirect_uri || authCode.client_id !== client_id) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // PKCE verification
  if (authCode.code_challenge) {
    const { code_verifier } = req.body;
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const hash = crypto.createHash('sha256').update(code_verifier).digest();
    const challenge = hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    if (challenge !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }

  // Mark code as used
  await db.run('UPDATE auth_codes SET used = 1 WHERE id = ?', authCode.id);

  // Generate tokens
  const accessToken = crypto.randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600; // 1 hour

  await db.run(`
    INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `, [accessToken, client_id, authCode.user_id, authCode.scope, expiresAt]);

  // Sign ID Token
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const header = { alg: 'RS256', kid: keys.kid };
  const payload = {
    sub: authCode.user_id.toString(),
    iss: baseUrl,
    aud: client_id,
    exp: expiresAt,
    iat: now
  };

  const base64url = (obj) => {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signInput = `${headerB64}.${payloadB64}`;
  
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(keys.privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const idToken = `${signInput}.${signature}`;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    access_token: accessToken,
    id_token: idToken,
    token_type: 'Bearer',
    expires_in: 3600
  });
});

app.get('/userinfo', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Bearer token required' });
  }

  const accessToken = authHeader.split(' ')[1];
  const token = await db.get('SELECT * FROM tokens WHERE access_token = ?', accessToken);

  if (!token || token.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Token invalid or expired' });
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', token.user_id);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'User not found' });
  }

  const response = {
    sub: user.id.toString()
  };

  if (token.scope.split(' ').includes('email')) {
    response.email = user.email;
  }

  res.status(200).json(response);
});

app.post('/userinfo', (req, res) => {
  res.status(405).json({ error: 'method_not_allowed' });
});

async function startServer() {
  try {
    await initDb();
    console.log('Database initialized and seeded.');

    keys = await getKeys();
    
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
