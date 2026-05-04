import express from 'express';
import { initializeDatabase, getClientById, getUserByUsername, insertAuthCode, getAuthCode, markAuthCodeUsed, insertToken, getToken, getUserById } from './db.js';
import { ensureKeyPair } from './keyManager.js';
import crypto from 'crypto';

const app = express();
let db;
let keyMaterial;

app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.set('Content-Type', 'application/json');
  next();
});

function getFirstQueryParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseBasicAuth(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const [scheme, encoded] = authHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) {
    return null;
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  return {
    client_id: decoded.slice(0, colonIndex),
    client_secret: decoded.slice(colonIndex + 1)
  };
}

function getClientCredentials(req) {
  const headerAuth = parseBasicAuth(req.get('authorization'));
  if (headerAuth && headerAuth.client_id) {
    return headerAuth;
  }

  return {
    client_id: getFirstQueryParam(req.body.client_id),
    client_secret: getFirstQueryParam(req.body.client_secret)
  };
}

async function authenticateClient(req) {
  const credentials = getClientCredentials(req);
  if (!credentials.client_id) {
    return { error: 'invalid_client', status: 401 };
  }

  const client = await getClientById(db, credentials.client_id);
  if (!client || client.client_secret !== credentials.client_secret) {
    return { error: 'invalid_client', status: 401 };
  }

  return { client };
}

function renderAuthorizeForm(params, errorMessage = '') {
  const {
    client_id,
    redirect_uri,
    state,
    response_type,
    scope,
    code_challenge,
    code_challenge_method,
    username = ''
  } = params;

  const optionalFields = [];
  if (code_challenge) {
    optionalFields.push(
      `<input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}" />`
    );
  }
  if (code_challenge_method) {
    optionalFields.push(
      `<input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}" />`
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authorize</title>
</head>
<body>
  <h1>Login</h1>
  ${errorMessage ? `<p style="color: red;">${escapeHtml(errorMessage)}</p>` : ''}
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(client_id)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}" />
    <input type="hidden" name="state" value="${escapeHtml(state)}" />
    <input type="hidden" name="response_type" value="${escapeHtml(response_type)}" />
    <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
    ${optionalFields.join('\n    ')}
    <div>
      <label>
        Username
        <input type="text" name="username" value="${escapeHtml(username)}" />
      </label>
    </div>
    <div>
      <label>
        Password
        <input type="password" name="password" />
      </label>
    </div>
    <div>
      <button type="submit">Continue</button>
    </div>
  </form>
</body>
</html>`;
}

app.get('/oauth2/authorize', async (req, res) => {
  const client_id = getFirstQueryParam(req.query.client_id);
  const redirect_uri = getFirstQueryParam(req.query.redirect_uri);
  const response_type = getFirstQueryParam(req.query.response_type);
  const scope = getFirstQueryParam(req.query.scope);
  const state = getFirstQueryParam(req.query.state);
  const code_challenge = getFirstQueryParam(req.query.code_challenge);
  const code_challenge_method = getFirstQueryParam(req.query.code_challenge_method);

  if (!client_id) {
    return res.status(400).json({ error: 'client_id is required' });
  }

  const client = await getClientById(db, client_id);
  if (!client) {
    return res.status(400).json({ error: 'invalid client_id' });
  }

  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid redirect_uri' });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ error: 'invalid response_type' });
  }

  if (!scope || !scope.split(/\s+/).includes('openid')) {
    return res.status(400).json({ error: 'invalid scope' });
  }

  res.type('html').send(renderAuthorizeForm({
    client_id,
    redirect_uri,
    state,
    response_type,
    scope,
    code_challenge,
    code_challenge_method
  }));
});

app.post('/oauth2/authorize', async (req, res) => {
  const client_id = getFirstQueryParam(req.body.client_id);
  const redirect_uri = getFirstQueryParam(req.body.redirect_uri);
  const response_type = getFirstQueryParam(req.body.response_type);
  const scope = getFirstQueryParam(req.body.scope);
  const state = getFirstQueryParam(req.body.state);
  const username = getFirstQueryParam(req.body.username);
  const password = getFirstQueryParam(req.body.password);
  const code_challenge = getFirstQueryParam(req.body.code_challenge) || null;
  const code_challenge_method = getFirstQueryParam(req.body.code_challenge_method) || null;

  if (!client_id) {
    return res.status(400).json({ error: 'client_id is required' });
  }

  const client = await getClientById(db, client_id);
  if (!client) {
    return res.status(400).json({ error: 'invalid client_id' });
  }

  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid redirect_uri' });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ error: 'invalid response_type' });
  }

  if (!scope || !scope.split(/\s+/).includes('openid')) {
    return res.status(400).json({ error: 'invalid scope' });
  }

  if (!username || !password) {
    return res.status(400).type('html').send(renderAuthorizeForm({
      client_id,
      redirect_uri,
      state,
      response_type,
      scope,
      code_challenge,
      code_challenge_method,
      username
    }, 'Invalid username or password'));
  }

  const user = await getUserByUsername(db, username);
  if (!user || user.password !== password) {
    return res.status(401).type('html').send(renderAuthorizeForm({
      client_id,
      redirect_uri,
      state,
      response_type,
      scope,
      code_challenge,
      code_challenge_method,
      username
    }, 'Invalid username or password'));
  }

  const code = crypto.randomBytes(32).toString('hex');
  const expires_at = Math.floor(Date.now() / 1000) + 600;

  await insertAuthCode(db, {
    code,
    client_id,
    user_id: user.id,
    redirect_uri,
    scope,
    code_challenge,
    code_challenge_method,
    expires_at
  });

  const location = new URL(redirect_uri);
  location.searchParams.set('code', code);
  if (state) {
    location.searchParams.set('state', state);
  }

  res.redirect(location.toString());
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

let jwks = { keys: [] };

app.get('/.well-known/jwks.json', (req, res) => {
  res.status(200).json(jwks);
});

app.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.status(200).json({
    issuer: `${baseUrl}`,
    authorization_endpoint: `${baseUrl}/oauth2/authorize`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    userinfo_endpoint: `${baseUrl}/userinfo`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256']
  });
});

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt(payload, privateKey, kid) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).end().sign(privateKey);
  const encodedSignature = signature.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${encodedSignature}`;
}

app.post('/oauth2/token', async (req, res) => {
  const grant_type = getFirstQueryParam(req.body.grant_type);
  const code = getFirstQueryParam(req.body.code);
  const redirect_uri = getFirstQueryParam(req.body.redirect_uri);
  const code_verifier = getFirstQueryParam(req.body.code_verifier);

  if (!grant_type || !code || !redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const clientAuth = await authenticateClient(req);
  if (clientAuth.error) {
    return res.status(clientAuth.status).json({ error: clientAuth.error });
  }

  const authCode = await getAuthCode(db, code);
  if (!authCode) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (authCode.used === 1) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (authCode.expires_at < now) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (authCode.client_id !== clientAuth.client.client_id) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (authCode.code_challenge) {
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const verifierHash = crypto.createHash('sha256').update(code_verifier).digest();
    const encodedVerifierHash = verifierHash.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    if (encodedVerifierHash !== authCode.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
  }

  await markAuthCodeUsed(db, code);

  const access_token = crypto.randomBytes(32).toString('hex');
  const expires_at = now + 3600;

  await insertToken(db, {
    access_token,
    client_id: clientAuth.client.client_id,
    user_id: authCode.user_id,
    scope: authCode.scope,
    expires_at
  });

  const issuer = `${req.protocol}://${req.get('host')}`;
  const id_token = signJwt({
    sub: String(authCode.user_id),
    iss: issuer,
    aud: clientAuth.client.client_id,
    exp: expires_at,
    iat: now
  }, keyMaterial.privateKey, keyMaterial.kid);

  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    access_token,
    id_token,
    token_type: 'Bearer',
    expires_in: 3600
  });
});

function parseBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

app.get('/userinfo', async (req, res) => {
  const tokenString = parseBearerToken(req.get('authorization'));
  if (!tokenString) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const token = await getToken(db, tokenString);
  if (!token) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at < now) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const user = await getUserById(db, token.user_id);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const response = { sub: String(user.id) };
  if (token.scope && token.scope.split(/\s+/).includes('email')) {
    response.email = user.email;
  }

  return res.status(200).json(response);
});

app.post('/userinfo', (req, res) => {
  res.set('Allow', 'GET');
  return res.status(405).json({ error: 'method_not_allowed' });
});

const port = Number(process.env.PORT || 4000);

try {
  db = await initializeDatabase();
  keyMaterial = ensureKeyPair();
  jwks = keyMaterial.jwks;

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${port}`);
  });
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('Failed to initialize server', error);
  process.exit(1);
}
