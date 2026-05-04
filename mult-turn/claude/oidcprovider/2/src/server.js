import express from 'express';
import crypto from 'crypto';
import { initDb } from './db.js';
import db from './db.js';
import { loadOrGenerateKeys, getJwks, getPrivateKey } from './keys.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/oauth2/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state } = req.query;

  if (!client_id) return res.status(400).send('Missing client_id');
  const client = await db.get('SELECT * FROM clients WHERE client_id = ?', [client_id]);
  if (!client) return res.status(400).send('Unknown client_id');

  if (!redirect_uri) return res.status(400).send('Missing redirect_uri');
  const allowedUris = JSON.parse(client.redirect_uris);
  if (!allowedUris.includes(redirect_uri)) return res.status(400).send('Invalid redirect_uri');

  if (response_type !== 'code') return res.status(400).send('response_type must be "code"');

  if (!scope || !scope.split(' ').includes('openid')) return res.status(400).send('scope must include "openid"');

  res.status(200).send(`<!DOCTYPE html>
<html>
<body>
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id" value="${esc(client_id)}">
    <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}">
    <input type="hidden" name="state" value="${esc(state)}">
    <input type="hidden" name="response_type" value="${esc(response_type)}">
    <input type="hidden" name="scope" value="${esc(scope)}">
    <label>Username: <input type="text" name="username"></label><br>
    <label>Password: <input type="password" name="password"></label><br>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`);
});

function loginForm(fields, error = '') {
  const { client_id, redirect_uri, state, response_type, scope } = fields;
  return `<!DOCTYPE html>
<html>
<body>
  ${error ? `<p>${esc(error)}</p>` : ''}
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id" value="${esc(client_id)}">
    <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}">
    <input type="hidden" name="state" value="${esc(state)}">
    <input type="hidden" name="response_type" value="${esc(response_type)}">
    <input type="hidden" name="scope" value="${esc(scope)}">
    <label>Username: <input type="text" name="username"></label><br>
    <label>Password: <input type="password" name="password"></label><br>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

app.post('/oauth2/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state,
          username, password, code_challenge, code_challenge_method } = req.body;

  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || user.password !== password) {
    return res.status(401).send(loginForm(
      { client_id, redirect_uri, state, response_type, scope },
      'Invalid username or password.'
    ));
  }

  const code = crypto.randomBytes(32).toString('hex');
  const expires_at = Math.floor(Date.now() / 1000) + 600;

  await db.run(
    `INSERT INTO auth_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      code,
      client_id,
      user.id,
      redirect_uri,
      scope,
      code_challenge || null,
      code_challenge_method || null,
      expires_at,
    ]
  );

  const location = new URL(redirect_uri);
  location.searchParams.set('code', code);
  if (state) location.searchParams.set('state', state);

  res.redirect(302, location.toString());
});

app.post('/oauth2/token', async (req, res) => {
  // Client authentication
  let client_id, client_secret;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    client_id = decoded.slice(0, colon);
    client_secret = decoded.slice(colon + 1);
  } else {
    client_id = req.body.client_id;
    client_secret = req.body.client_secret;
  }

  if (!client_id) return res.status(401).json({ error: 'invalid_client' });
  const client = await db.get('SELECT * FROM clients WHERE client_id = ?', [client_id]);
  if (!client) return res.status(401).json({ error: 'invalid_client' });
  if (client.client_secret !== client_secret) return res.status(401).json({ error: 'invalid_client' });

  // Request validation
  const { grant_type, code, redirect_uri } = req.body;
  if (!grant_type || !code || !redirect_uri) return res.status(400).json({ error: 'invalid_request' });
  if (grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });

  // Validate authorization code
  const authCode = await db.get('SELECT * FROM auth_codes WHERE code = ?', [code]);
  if (!authCode) return res.status(400).json({ error: 'invalid_grant' });
  if (authCode.used) return res.status(400).json({ error: 'invalid_grant' });
  if (authCode.expires_at < Math.floor(Date.now() / 1000)) return res.status(400).json({ error: 'invalid_grant' });
  if (authCode.redirect_uri !== redirect_uri) return res.status(400).json({ error: 'invalid_grant' });
  if (authCode.client_id !== client_id) return res.status(400).json({ error: 'invalid_grant' });

  // PKCE verification
  if (authCode.code_challenge) {
    const { code_verifier } = req.body;
    if (!code_verifier) return res.status(400).json({ error: 'invalid_grant' });
    const digest = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (digest !== authCode.code_challenge) return res.status(400).json({ error: 'invalid_grant' });
  }

  // Mark code used immediately (replay prevention)
  await db.run('UPDATE auth_codes SET used = 1 WHERE code = ?', [code]);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  // Access token
  const access_token = crypto.randomBytes(32).toString('hex');
  await db.run(
    'INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
    [access_token, client_id, authCode.user_id, authCode.scope, exp]
  );

  // ID token JWT (manual, no external library)
  const jwks = getJwks();
  const kid = jwks.keys[0].kid;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
  const issuer = `${req.protocol}://${req.get('host')}`;
  const payload = Buffer.from(JSON.stringify({
    sub: String(authCode.user_id),
    iss: issuer,
    aud: client_id,
    exp,
    iat: now,
  })).toString('base64url');
  const signing_input = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signing_input), getPrivateKey()).toString('base64url');
  const id_token = `${signing_input}.${signature}`;

  res.set('Cache-Control', 'no-store').status(200).json({
    access_token,
    id_token,
    token_type: 'Bearer',
    expires_in: 3600,
  });
});

async function userinfo(req, res) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'invalid_token' });

  const token = auth.slice(7);
  const row = await db.get('SELECT * FROM tokens WHERE access_token = ?', [token]);
  if (!row) return res.status(401).json({ error: 'invalid_token' });
  if (row.expires_at < Math.floor(Date.now() / 1000)) return res.status(401).json({ error: 'invalid_token' });

  const user = await db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  const response = { sub: String(user.id) };
  if (row.scope.split(' ').includes('email')) response.email = user.email;

  res.status(200).json(response);
}

app.get('/userinfo', userinfo);
app.post('/userinfo', userinfo);

app.get(/^\/\.well-known\/openid-configuration$/, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer:                                 base,
    authorization_endpoint:                 `${base}/oauth2/authorize`,
    token_endpoint:                         `${base}/oauth2/token`,
    userinfo_endpoint:                      `${base}/userinfo`,
    jwks_uri:                               `${base}/.well-known/jwks.json`,
    response_types_supported:              ['code'],
    subject_types_supported:               ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  });
});

app.get(/^\/\.well-known\/jwks\.json$/, (req, res) => {
  res.json(getJwks());
});

await initDb();
loadOrGenerateKeys();

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
