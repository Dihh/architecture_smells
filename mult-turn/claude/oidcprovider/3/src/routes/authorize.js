import { randomBytes } from 'crypto';
import { Router } from 'express';
import { get, run } from '../db.js';

const router = Router();

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function loginForm(params, error) {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <h1>Sign in</h1>
  ${error ? `<p style="color:red">${esc(error)}</p>` : ''}
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id"             value="${esc(client_id)}">
    <input type="hidden" name="redirect_uri"          value="${esc(redirect_uri)}">
    <input type="hidden" name="response_type"         value="${esc(response_type)}">
    <input type="hidden" name="scope"                 value="${esc(scope)}">
    <input type="hidden" name="state"                 value="${esc(state)}">
    <input type="hidden" name="code_challenge"        value="${esc(code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${esc(code_challenge_method)}">
    <label>Username<br><input type="text"     name="username"></label><br>
    <label>Password<br><input type="password" name="password"></label><br>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

router.get('/oauth2/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  if (!client_id) {
    return res.status(400).json({ error: 'missing client_id' });
  }

  const client = await get('SELECT * FROM clients WHERE client_id = ?', [client_id]);
  if (!client) {
    return res.status(400).json({ error: 'unknown client_id' });
  }

  const registeredUris = JSON.parse(client.redirect_uris);

  if (!redirect_uri || !registeredUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid redirect_uri' });
  }

  if (!response_type || response_type !== 'code') {
    return res.status(400).json({ error: 'invalid response_type' });
  }

  if (!scope || !scope.split(' ').includes('openid')) {
    return res.status(400).json({ error: 'scope must include openid' });
  }

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(loginForm({ client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method }));
});

router.post('/oauth2/authorize', async (req, res) => {
  const {
    client_id, redirect_uri, response_type, scope, state,
    username, password,
    code_challenge, code_challenge_method,
  } = req.body;

  const oauthParams = { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method };

  const sendForm = (error) => {
    res.setHeader('Content-Type', 'text/html');
    res.status(400).send(loginForm(oauthParams, error));
  };

  // Validate OAuth params (same rules as GET)
  if (!client_id) return sendForm('Invalid request: missing client_id');

  const client = await get('SELECT * FROM clients WHERE client_id = ?', [client_id]);
  if (!client) return sendForm('Invalid request: unknown client');

  const registeredUris = JSON.parse(client.redirect_uris);
  if (!redirect_uri || !registeredUris.includes(redirect_uri)) return sendForm('Invalid request: invalid redirect_uri');
  if (!response_type || response_type !== 'code') return sendForm('Invalid request: invalid response_type');
  if (!scope || !scope.split(' ').includes('openid')) return sendForm('Invalid request: scope must include openid');

  // Authenticate user
  const user = await get('SELECT * FROM users WHERE username = ?', [username ?? '']);
  if (!user || user.password !== password) {
    return sendForm('Invalid username or password');
  }

  // Generate authorization code
  const code = randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  await run(
    `INSERT INTO auth_codes
       (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      code,
      client_id,
      user.id,
      redirect_uri,
      scope,
      code_challenge || null,
      code_challenge_method || null,
      expiresAt,
    ]
  );

  const location = new URL(redirect_uri);
  location.searchParams.set('code', code);
  if (state) location.searchParams.set('state', state);

  res.redirect(302, location.toString());
});

export default router;
