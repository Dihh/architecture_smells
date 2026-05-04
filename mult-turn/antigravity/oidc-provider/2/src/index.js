import 'dotenv/config';
import express from 'express';
import { initDb } from './db.js';
import { initKeys, getJwks } from './keys.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to ensure Content-Type: application/json for all JSON responses
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    res.setHeader('Content-Type', 'application/json');
    return originalJson.call(this, body);
  };
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/.well-known/jwks.json', (req, res) => {
  res.status(200).json(getJwks());
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
    id_token_signing_alg_values_supported: ['RS256'],
  });
});

const renderLoginForm = (res, params, error = null) => {
  const { client_id, redirect_uri, state, response_type, scope, code_challenge, code_challenge_method } = params;
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login - OIDC Provider</title>
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
        form { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
        h1 { margin-top: 0; text-align: center; color: #1c1e21; }
        .error { color: #d93025; background: #fce8e6; padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; border: 1px solid #f5c2c7; text-align: center; }
        .field { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
        input[type="text"], input[type="password"] { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 0.75rem; background-color: #1877f2; border: none; color: white; border-radius: 4px; font-weight: bold; cursor: pointer; }
        button:hover { background-color: #166fe5; }
      </style>
    </head>
    <body>
      <form method="POST" action="/oauth2/authorize">
        <h1>Login</h1>
        ${error ? `<div class="error">${error}</div>` : ''}
        <input type="hidden" name="client_id" value="${client_id}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="state" value="${state || ''}">
        <input type="hidden" name="response_type" value="${response_type}">
        <input type="hidden" name="scope" value="${scope}">
        ${code_challenge ? `<input type="hidden" name="code_challenge" value="${code_challenge}">` : ''}
        ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${code_challenge_method}">` : ''}
        
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required>
        </div>
        
        <button type="submit">Log In</button>
      </form>
    </body>
    </html>
  `);
};

app.get('/oauth2/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  // Validation
  if (!client_id || !redirect_uri || !response_type || !scope) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only "code" is supported' });
  }

  if (!scope.split(' ').includes('openid')) {
    return res.status(400).json({ error: 'invalid_scope', error_description: 'Scope must include "openid"' });
  }

  const { get } = await import('./db.js');
  const client = await get('SELECT * FROM clients WHERE client_id = ?', [client_id]);

  if (!client) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Client not found' });
  }

  const allowedRedirectUris = JSON.parse(client.redirect_uris);
  if (!allowedRedirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Redirect URI not authorized' });
  }

  renderLoginForm(res, { client_id, redirect_uri, state, response_type, scope, code_challenge, code_challenge_method });
});

app.post('/oauth2/authorize', async (req, res) => {
  const { 
    client_id, redirect_uri, response_type, scope, state, 
    username, password, 
    code_challenge, code_challenge_method 
  } = req.body;

  const { get, run } = await import('./db.js');
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);

  if (!user || user.password !== password) {
    return renderLoginForm(res, { 
      client_id, redirect_uri, state, response_type, scope, 
      code_challenge, code_challenge_method 
    }, 'Invalid username or password');
  }

  // Generate auth code
  const crypto = await import('crypto');
  const code = crypto.randomBytes(16).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  await run(`
    INSERT INTO auth_codes (
      code, client_id, user_id, redirect_uri, scope, 
      code_challenge, code_challenge_method, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code, client_id, user.id, redirect_uri, scope, 
    code_challenge || null, code_challenge_method || null, expiresAt
  ]);

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }

  res.redirect(302, redirectUrl.toString());
});

app.post('/oauth2/token', async (req, res) => {
  const { grant_type, code, redirect_uri } = req.body;

  // 1. Validation of common parameters
  if (!grant_type || !code || !redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // 2. Client Authentication
  let clientId, clientSecret;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const encoded = authHeader.substring(6);
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const parts = decoded.split(':');
    clientId = parts[0];
    clientSecret = parts.slice(1).join(':');
  } else {
    clientId = req.body.client_id;
    clientSecret = req.body.client_secret;
  }

  if (!clientId || !clientSecret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const { get } = await import('./db.js');
  const client = await get('SELECT * FROM clients WHERE client_id = ?', [clientId]);

  if (!client || client.client_secret !== clientSecret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // 3. Authorization Code Validation
  const authCode = await get('SELECT * FROM auth_codes WHERE code = ?', [code]);

  if (
    !authCode ||
    authCode.used === 1 ||
    authCode.expires_at < Math.floor(Date.now() / 1000) ||
    authCode.redirect_uri !== redirect_uri ||
    authCode.client_id !== clientId
  ) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // 4. PKCE Verification
  if (authCode.code_challenge) {
    const { code_verifier } = req.body;
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(code_verifier).digest();
    const challenge = hash.toString('base64url');

    if (challenge !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }

  // 5. Success - Issue Tokens
  const { run } = await import('./db.js');
  await run('UPDATE auth_codes SET used = 1 WHERE id = ?', [authCode.id]);

  const crypto = await import('crypto');
  const accessToken = crypto.randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;

  await run(`
    INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `, [accessToken, clientId, authCode.user_id, authCode.scope, expiresAt]);

  // Generate ID Token
  const { keyPair } = await import('./keys.js');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  const header = {
    alg: 'RS256',
    kid: keyPair.kid,
  };
  
  const payload = {
    sub: authCode.user_id.toString(),
    iss: baseUrl,
    aud: clientId,
    exp: expiresAt,
    iat: now,
  };

  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  
  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signInput = `${headerB64}.${payloadB64}`;
  
  const signature = crypto.sign('sha256', Buffer.from(signInput), keyPair.privateKey).toString('base64url');
  const idToken = `${signInput}.${signature}`;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    access_token: accessToken,
    id_token: idToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
});

app.get('/userinfo', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Bearer token required' });
  }

  const accessToken = authHeader.substring(7);
  const { get } = await import('./db.js');
  
  const tokenRecord = await get('SELECT * FROM tokens WHERE access_token = ?', [accessToken]);
  const now = Math.floor(Date.now() / 1000);

  if (!tokenRecord || tokenRecord.expires_at < now) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Token invalid or expired' });
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [tokenRecord.user_id]);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'User not found' });
  }

  const response = {
    sub: user.id.toString(),
  };

  const scopes = tokenRecord.scope.split(' ');
  if (scopes.includes('email')) {
    response.email = user.email;
  }

  res.status(200).json(response);
});

app.post('/userinfo', (req, res) => {
  res.status(405).json({ error: 'method_not_allowed', error_description: 'POST not supported on UserInfo endpoint' });
});

async function startServer() {
  try {
    await initDb();
    console.log('Database initialized.');
    
    await initKeys();
    
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
