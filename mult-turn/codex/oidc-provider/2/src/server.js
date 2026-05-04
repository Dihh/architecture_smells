import crypto from 'node:crypto';
import express from 'express';
import { closeDatabase, get, initializeDatabase, run } from './db.js';

const app = express();
const port = Number.parseInt(process.env.PORT ?? '4000', 10);
const issuer = process.env.ISSUER ?? `http://localhost:${port}`;
const jwtKeyId = process.env.JWT_KEY_ID ?? 'oidc-provider-key-1';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.type('application/json');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/.well-known/jwks.json', (req, res) => {
  res.status(200).json({
    keys: [getPublicJwk()],
  });
});

const db = await initializeDatabase();

app.get('/oauth2/authorize', async (req, res, next) => {
  try {
    const validation = await validateAuthorizeRequest(req.query);

    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    res.status(200).type('html').send(renderLoginForm(req.query));
  } catch (error) {
    next(error);
  }
});

app.post('/oauth2/authorize', async (req, res, next) => {
  try {
    const validation = await validateAuthorizeRequest(req.body);

    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const user = await get(
      db,
      'SELECT id, username, password FROM users WHERE username = ?',
      [singleValue(req.body.username)],
    );

    if (!user || user.password !== singleValue(req.body.password)) {
      res
        .status(401)
        .type('html')
        .send(renderLoginForm(req.body, 'Invalid username or password'));
      return;
    }

    const code = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    const pkce = getPkceValues(req.body);

    await run(
      db,
      `INSERT INTO auth_codes (
        code,
        client_id,
        user_id,
        redirect_uri,
        scope,
        code_challenge,
        code_challenge_method,
        expires_at,
        used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        code,
        singleValue(req.body.client_id),
        user.id,
        singleValue(req.body.redirect_uri),
        singleValue(req.body.scope),
        pkce.codeChallenge,
        pkce.codeChallengeMethod,
        expiresAt,
      ],
    );

    const redirectUrl = new URL(singleValue(req.body.redirect_uri));
    redirectUrl.searchParams.set('code', code);

    const state = singleValue(req.body.state);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.post('/oauth2/token', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');

  try {
    const credentials = parseClientCredentials(req);

    if (!credentials.clientId) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    const client = await get(
      db,
      'SELECT client_id, client_secret FROM clients WHERE client_id = ?',
      [credentials.clientId],
    );

    if (!client || client.client_secret !== credentials.clientSecret) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    const grantType = singleValue(req.body.grant_type);
    const code = singleValue(req.body.code);
    const redirectUri = singleValue(req.body.redirect_uri);

    if (!grantType || !code || !redirectUri) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    if (grantType !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }

    const authorizationCode = await get(
      db,
      `SELECT
        code,
        client_id,
        user_id,
        redirect_uri,
        scope,
        code_challenge,
        expires_at,
        used
      FROM auth_codes
      WHERE code = ?`,
      [code],
    );

    const now = Math.floor(Date.now() / 1000);

    if (
      !authorizationCode ||
      authorizationCode.used === 1 ||
      authorizationCode.expires_at < now ||
      authorizationCode.redirect_uri !== redirectUri ||
      authorizationCode.client_id !== credentials.clientId
    ) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    if (!validatePkce(req.body, authorizationCode)) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    const update = await run(
      db,
      'UPDATE auth_codes SET used = 1 WHERE code = ? AND used = 0',
      [code],
    );

    if (update.changes !== 1) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    const accessToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = now + 60 * 60;

    await run(
      db,
      `INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        accessToken,
        authorizationCode.client_id,
        authorizationCode.user_id,
        authorizationCode.scope,
        expiresAt,
      ],
    );

    const idToken = signIdToken({
      sub: String(authorizationCode.user_id),
      iss: issuer,
      aud: authorizationCode.client_id,
      exp: expiresAt,
      iat: now,
    });

    res
      .status(200)
      .json({
        access_token: accessToken,
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
      });
  } catch (error) {
    next(error);
  }
});

app.get('/userinfo', async (req, res, next) => {
  try {
    const accessToken = parseBearerToken(req.get('authorization'));

    if (!accessToken) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    const token = await get(
      db,
      `SELECT tokens.user_id, tokens.scope, tokens.expires_at, users.email
       FROM tokens
       JOIN users ON users.id = tokens.user_id
       WHERE tokens.access_token = ?`,
      [accessToken],
    );
    const now = Math.floor(Date.now() / 1000);

    if (!token || token.expires_at < now) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    const responseBody = {
      sub: String(token.user_id),
    };

    if (scopeIncludes(token.scope, 'email')) {
      responseBody.email = token.email;
    }

    res.status(200).json(responseBody);
  } catch (error) {
    next(error);
  }
});

app.post('/userinfo', (req, res) => {
  res.status(405).json({ error: 'method_not_allowed' });
});

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

function parseClientCredentials(req) {
  const basicCredentials = parseBasicAuth(req.get('authorization'));

  if (basicCredentials.clientId) {
    return basicCredentials;
  }

  return {
    clientId: singleValue(req.body.client_id),
    clientSecret: singleValue(req.body.client_secret),
  };
}

function parseBasicAuth(authorizationHeader = '') {
  if (!authorizationHeader.startsWith('Basic ')) {
    return { clientId: '', clientSecret: '' };
  }

  const encodedCredentials = authorizationHeader.slice('Basic '.length);
  const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString(
    'utf8',
  );
  const separatorIndex = decodedCredentials.indexOf(':');

  if (separatorIndex === -1) {
    return { clientId: '', clientSecret: '' };
  }

  return {
    clientId: decodedCredentials.slice(0, separatorIndex),
    clientSecret: decodedCredentials.slice(separatorIndex + 1),
  };
}

function parseBearerToken(authorizationHeader = '') {
  const [scheme, token, extra] = authorizationHeader.split(/\s+/);

  if (scheme !== 'Bearer' || !token || extra) {
    return '';
  }

  return token;
}

function getPublicJwk() {
  return {
    ...publicKey.export({ format: 'jwk' }),
    kid: jwtKeyId,
    use: 'sig',
    alg: 'RS256',
  };
}

function scopeIncludes(scope, expectedScope) {
  return scope.split(/\s+/).filter(Boolean).includes(expectedScope);
}

function validatePkce(body, authorizationCode) {
  if (!authorizationCode.code_challenge) {
    return true;
  }

  const codeVerifier = singleValue(body.code_verifier);

  if (!codeVerifier) {
    return false;
  }

  const verifierChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return verifierChallenge === authorizationCode.code_challenge;
}

function signIdToken(payload) {
  const header = {
    alg: 'RS256',
    kid: jwtKeyId,
  };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function validateAuthorizeRequest(query) {
  const client_id = singleValue(query.client_id);
  const redirect_uri = singleValue(query.redirect_uri);
  const response_type = singleValue(query.response_type);
  const scope = singleValue(query.scope);

  if (!client_id) {
    return { valid: false, error: 'invalid_client_id' };
  }

  const client = await get(
    db,
    'SELECT client_id, redirect_uris FROM clients WHERE client_id = ?',
    [client_id],
  );

  if (!client) {
    return { valid: false, error: 'invalid_client_id' };
  }

  if (!redirect_uri) {
    return { valid: false, error: 'invalid_redirect_uri' };
  }

  const redirectUris = JSON.parse(client.redirect_uris);
  if (!redirectUris.includes(redirect_uri)) {
    return { valid: false, error: 'invalid_redirect_uri' };
  }

  if (response_type !== 'code') {
    return { valid: false, error: 'invalid_response_type' };
  }

  if (!scope) {
    return { valid: false, error: 'invalid_scope' };
  }

  const scopes = scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes('openid')) {
    return { valid: false, error: 'invalid_scope' };
  }

  return { valid: true };
}

function renderLoginForm(query, errorMessage = '') {
  const fields = [
    'client_id',
    'redirect_uri',
    'state',
    'response_type',
    'scope',
    'code_challenge',
    'code_challenge_method',
  ];
  const hiddenFields = fields
    .map((field) => {
      const value = singleValue(query[field]);
      return `<input type="hidden" name="${field}" value="${escapeHtml(value)}">`;
    })
    .join('\n        ');
  const errorHtml = errorMessage
    ? `<p role="alert">${escapeHtml(errorMessage)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Sign in</title>
  </head>
  <body>
    ${errorHtml}
    <form method="POST" action="/oauth2/authorize">
      ${hiddenFields}
      <label>
        Username
        <input name="username" autocomplete="username">
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password">
      </label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`;
}

function getPkceValues(body) {
  const codeChallenge = singleValue(body.code_challenge);
  const codeChallengeMethod = singleValue(body.code_challenge_method);

  if (codeChallenge && codeChallengeMethod === 'S256') {
    return { codeChallenge, codeChallengeMethod };
  }

  return { codeChallenge: null, codeChallengeMethod: null };
}

function singleValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return typeof value === 'string' ? value : '';
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function shutdown() {
  server.close(async () => {
    await closeDatabase(db);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
