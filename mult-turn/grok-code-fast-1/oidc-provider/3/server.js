import express from 'express';
import crypto from 'crypto';
import { initializeDatabase } from './db.js';
import { loadOrGenerateKeys, getJWKS } from './keys.js';

const app = express();
const PORT = process.env.PORT || 4000;

let publicKey, privateKey, kid, db;

// Middleware
app.use(express.urlencoded({ extended: true }));

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// OpenID Connect discovery endpoint
app.get('/.well-known/openid-configuration', (req, res) => {
  const base_url = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: base_url,
    authorization_endpoint: `${base_url}/oauth2/authorize`,
    token_endpoint: `${base_url}/oauth2/token`,
    userinfo_endpoint: `${base_url}/userinfo`,
    jwks_uri: `${base_url}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"]
  });
});

// GET /oauth2/authorize
app.get('/oauth2/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  // Validation
  if (!client_id) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'client_id not found' });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is required' });
  }
  const allowedUris = JSON.parse(client.redirect_uris);
  if (!allowedUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not allowed' });
  }

  if (!response_type || response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type', error_description: 'response_type must be code' });
  }

  if (!scope || !scope.split(' ').includes('openid')) {
    return res.status(400).json({ error: 'invalid_scope', error_description: 'scope must include openid' });
  }

  // Valid, return HTML form
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login</title>
    </head>
    <body>
      <h1>Login</h1>
      <form method="POST" action="/oauth2/authorize">
        <input type="hidden" name="client_id" value="${client_id}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="response_type" value="${response_type}">
        <input type="hidden" name="scope" value="${scope}">
        ${state ? `<input type="hidden" name="state" value="${state}">` : ''}
        ${code_challenge ? `<input type="hidden" name="code_challenge" value="${code_challenge}">` : ''}
        ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${code_challenge_method}">` : ''}
        <label for="username">Username:</label>
        <input type="text" id="username" name="username" required><br>
        <label for="password">Password:</label>
        <input type="password" id="password" name="password" required><br>
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `;
  res.send(html);
});

// POST /oauth2/authorize
app.post('/oauth2/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, username, password, code_challenge, code_challenge_method } = req.body;

  // Lookup user
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== password) {
    // Invalid credentials, re-render form with error
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login</title>
      </head>
      <body>
        <h1>Login</h1>
        <p style="color: red;">Invalid username or password</p>
        <form method="POST" action="/oauth2/authorize">
          <input type="hidden" name="client_id" value="${client_id}">
          <input type="hidden" name="redirect_uri" value="${redirect_uri}">
          <input type="hidden" name="response_type" value="${response_type}">
          <input type="hidden" name="scope" value="${scope}">
          ${state ? `<input type="hidden" name="state" value="${state}">` : ''}
          <label for="username">Username:</label>
          <input type="text" id="username" name="username" required><br>
          <label for="password">Password:</label>
          <input type="password" id="password" name="password" required><br>
          <button type="submit">Login</button>
        </form>
      </body>
      </html>
    `;
    res.send(html);
    return;
  }

  // Valid credentials
  const code = crypto.randomBytes(16).toString('base64url');
  const expires_at = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  db.prepare('INSERT INTO auth_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run(
    code, client_id, user.id, redirect_uri, scope, code_challenge || null, code_challenge_method || null, expires_at
  );

  let redirectUrl = `${redirect_uri}?code=${code}`;
  if (state) {
    redirectUrl += `&state=${state}`;
  }
  res.redirect(302, redirectUrl);
});

// POST /oauth2/token
app.post('/oauth2/token', (req, res) => {
  // Client authentication
  let client_id, client_secret;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      return res.status(401).json({ error: 'invalid_client' });
    }
    client_id = decoded.slice(0, colonIndex);
    client_secret = decoded.slice(colonIndex + 1);
  } else {
    client_id = req.body.client_id;
    client_secret = req.body.client_secret;
  }

  if (!client_id) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client || client.client_secret !== client_secret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Parameter validation
  const { grant_type, code, redirect_uri } = req.body;

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

  // Validate authorization code
  const authCode = db.prepare('SELECT * FROM auth_codes WHERE code = ?').get(code);
  if (!authCode || authCode.used || authCode.expires_at < Math.floor(Date.now() / 1000) || authCode.redirect_uri !== redirect_uri || authCode.client_id !== client_id) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // PKCE verification
  if (authCode.code_challenge) {
    const code_verifier = req.body.code_verifier;
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (hash !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }

  // Mark code as used
  db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(authCode.id);

  // Generate access token
  const access_token = crypto.randomBytes(32).toString('base64url');

  // Store token
  const tokenExpires = Math.floor(Date.now() / 1000) + 3600;
  db.prepare('INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    access_token, client_id, authCode.user_id, authCode.scope, tokenExpires
  );

  // Build id_token
  const base_url = `${req.protocol}://${req.get('host')}`;
  const header = { alg: 'RS256', kid: kid };
  const payload = {
    sub: authCode.user_id.toString(),
    iss: base_url,
    aud: client_id,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const id_token = `${signingInput}.${signature}`;

  // Response
  res.set('Cache-Control', 'no-store');
  res.json({
    access_token,
    id_token,
    token_type: 'Bearer',
    expires_in: 3600
  });
});

// UserInfo endpoint
app.get('/userinfo', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const access_token = authHeader.slice(7);

  const token = db.prepare('SELECT * FROM tokens WHERE access_token = ?').get(access_token);
  if (!token || token.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.user_id);
  const response = { sub: user.id.toString() };
  if (token.scope.includes('email')) {
    response.email = user.email;
  }
  res.json(response);
});

app.post('/userinfo', (req, res) => {
  res.status(405).json({ error: 'method_not_allowed' });
});

// JWKS endpoint
app.get('/.well-known/jwks.json', (req, res) => {
  const jwks = getJWKS(publicKey, kid);
  res.json(jwks);
});

// Middleware to set Content-Type for JSON responses
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Initialize database and start server
async function startServer() {
  try {
    db = initializeDatabase();
    console.log('Database initialized successfully');

    const keys = loadOrGenerateKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    kid = keys.kid;
    console.log('Keys loaded/generated successfully');

    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();