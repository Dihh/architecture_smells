import { randomBytes } from 'crypto';
import {
  createAuthorizationCode,
  findClientByClientId,
  findUserByUsername,
} from './database.js';

export async function handleAuthorizeGet(req, res, db) {
  const validation = await validateAuthorizeRequest(req.query, db);

  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  res
    .status(200)
    .type('html')
    .send(renderLoginForm(withPkceParams(validation.params, req.query)));
}

export async function handleAuthorizePost(req, res, db) {
  const validation = await validateAuthorizeRequest(req.body, db);

  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const username = getQueryParam(req.body.username);
  const password = getQueryParam(req.body.password);
  const user = username ? await findUserByUsername(db, username) : undefined;

  if (!user || user.password !== password) {
    res
      .status(401)
      .type('html')
      .send(
        renderLoginForm(
          withPkceParams(validation.params, req.body),
          'Invalid username or password'
        )
      );
    return;
  }

  const code = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const { codeChallenge, codeChallengeMethod } = getPkceParams(req.body);

  await createAuthorizationCode(db, {
    code,
    clientId: validation.params.client_id,
    userId: user.id,
    redirectUri: validation.params.redirect_uri,
    scope: validation.params.scope,
    codeChallenge,
    codeChallengeMethod,
    expiresAt,
  });

  const redirectUrl = new URL(validation.params.redirect_uri);
  redirectUrl.searchParams.set('code', code);

  if (validation.params.state) {
    redirectUrl.searchParams.set('state', validation.params.state);
  }

  res.redirect(302, redirectUrl.toString());
}

async function validateAuthorizeRequest(query, db) {
  const clientId = getQueryParam(query.client_id);
  const redirectUri = getQueryParam(query.redirect_uri);
  const responseType = getQueryParam(query.response_type);
  const scope = getQueryParam(query.scope);
  const state = getQueryParam(query.state) ?? '';

  if (!clientId) {
    return invalid('invalid_client');
  }

  const client = await findClientByClientId(db, clientId);
  if (!client) {
    return invalid('invalid_client');
  }

  if (!redirectUri) {
    return invalid('invalid_redirect_uri');
  }

  const redirectUris = JSON.parse(client.redirect_uris);
  if (!redirectUris.includes(redirectUri)) {
    return invalid('invalid_redirect_uri');
  }

  if (responseType !== 'code') {
    return invalid('unsupported_response_type');
  }

  if (!scope || !scope.split(/\s+/).includes('openid')) {
    return invalid('invalid_scope');
  }

  return {
    valid: true,
    params: {
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: responseType,
      scope,
    },
  };
}

function getPkceParams(body) {
  const codeChallenge = getQueryParam(body.code_challenge);
  const codeChallengeMethod = getQueryParam(body.code_challenge_method);

  if (codeChallenge && codeChallengeMethod === 'S256') {
    return { codeChallenge, codeChallengeMethod };
  }

  return { codeChallenge: null, codeChallengeMethod: null };
}

function withPkceParams(params, body) {
  const codeChallenge = getQueryParam(body.code_challenge);
  const codeChallengeMethod = getQueryParam(body.code_challenge_method);

  return {
    ...params,
    code_challenge: codeChallenge ?? '',
    code_challenge_method: codeChallengeMethod ?? '',
  };
}

function getQueryParam(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function invalid(error) {
  return { valid: false, error };
}

function renderLoginForm(params, errorMessage = '') {
  const pkceFields =
    params.code_challenge || params.code_challenge_method
      ? `
        <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge ?? '')}">
        <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method ?? '')}">`
      : '';
  const error = errorMessage
    ? `
      <p role="alert">${escapeHtml(errorMessage)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Sign in</title>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
${error}
      <form method="POST" action="/oauth2/authorize">
        <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}">
        <input type="hidden" name="state" value="${escapeHtml(params.state)}">
        <input type="hidden" name="response_type" value="${escapeHtml(params.response_type)}">
        <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">
${pkceFields}

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
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
