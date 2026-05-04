import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from './database.js';
import { publicKey, privateKey, kid } from './keys.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to set Content-Type for JSON responses
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// JWKS endpoint
app.get('/.well-known/jwks.json', (req, res) => {
  const jwk = publicKey.export({ format: 'jwk' });
  const jwks = {
    keys: [
      {
        kty: jwk.kty,
        use: 'sig',
        alg: 'RS256',
        kid: kid,
        n: jwk.n,
        e: jwk.e
      }
    ]
  };
  res.json(jwks);
});

// OpenID Connect discovery endpoint
app.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const config = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth2/authorize`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    userinfo_endpoint: `${baseUrl}/userinfo`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256']
  };
  res.json(config);
});

// Authorization endpoint GET
app.get('/oauth2/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  // Validation
  if (!client_id || !redirect_uri || !response_type || !scope) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type' });
  }

  if (!scope.includes('openid')) {
    return res.status(400).json({ error: 'invalid_scope' });
  }

  // Check client
  db.get('SELECT * FROM clients WHERE client_id = ?', [client_id], (err, client) => {
    if (err || !client) {
      return res.status(400).json({ error: 'invalid_client' });
    }

    const redirectUris = JSON.parse(client.redirect_uris);
    if (!redirectUris.includes(redirect_uri)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
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
    <input type="hidden" name="state" value="${state || ''}">
    ${code_challenge ? `<input type="hidden" name="code_challenge" value="${code_challenge}">` : ''}
    ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${code_challenge_method}">` : ''}
    <label>Username: <input type="text" name="username" required></label><br>
    <label>Password: <input type="password" name="password" required></label><br>
    <button type="submit">Login</button>
  </form>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// Authorization endpoint POST
app.post('/oauth2/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, username, password, code_challenge, code_challenge_method } = req.body;

  // Lookup user
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err || !user || user.password !== password) {
      // Invalid credentials, re-render form with error
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Login</title>
</head>
<body>
  <h1>Login</h1>
  <p style="color: red;">Invalid username or password.</p>
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id" value="${client_id}">
    <input type="hidden" name="redirect_uri" value="${redirect_uri}">
    <input type="hidden" name="response_type" value="${response_type}">
    <input type="hidden" name="scope" value="${scope}">
    <input type="hidden" name="state" value="${state || ''}">
    ${code_challenge ? `<input type="hidden" name="code_challenge" value="${code_challenge}">` : ''}
    ${code_challenge_method ? `<input type="hidden" name="code_challenge_method" value="${code_challenge_method}">` : ''}
    <label>Username: <input type="text" name="username" required></label><br>
    <label>Password: <input type="password" name="password" required></label><br>
    <button type="submit">Login</button>
  </form>
</body>
</html>
      `;
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    // Valid, generate code
    const code = crypto.randomBytes(32).toString('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

    // Insert into auth_codes
    db.run(`INSERT INTO auth_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, used)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
           [code, client_id, user.id, redirect_uri, scope, code_challenge || null, code_challenge_method || null, expiresAt],
           (err) => {
             if (err) {
               console.error(err);
               return res.status(500).json({ error: 'internal_error' });
             }

             // Redirect
             let redirectUrl = `${redirect_uri}?code=${code}`;
             if (state) {
               redirectUrl += `&state=${state}`;
             }
             res.redirect(redirectUrl);
           });
  });
});

// Token endpoint
app.post('/oauth2/token', (req, res) => {
  const { grant_type, code, redirect_uri, client_id: bodyClientId, client_secret: bodyClientSecret } = req.body;

  // Check required params
  if (!grant_type) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!code) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // Client authentication
  let clientId = bodyClientId;
  let clientSecret = bodyClientSecret;

  // Check Basic auth
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex !== -1) {
      clientId = decoded.slice(0, colonIndex);
      clientSecret = decoded.slice(colonIndex + 1);
    }
  }

  if (!clientId) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // Check client in db
  db.get('SELECT * FROM clients WHERE client_id = ?', [clientId], (err, client) => {
    if (err || !client || client.client_secret !== clientSecret) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    // Validate authorization code
    db.get('SELECT * FROM auth_codes WHERE code = ?', [code], (err, authCode) => {
      if (err || !authCode) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (authCode.used === 1) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (authCode.expires_at < Math.floor(Date.now() / 1000)) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (authCode.redirect_uri !== redirect_uri) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (authCode.client_id !== clientId) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      // PKCE verification
      if (authCode.code_challenge) {
        const { code_verifier } = req.body;
        if (!code_verifier) {
          return res.status(400).json({ error: 'invalid_grant' });
        }
        const challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        if (challenge !== authCode.code_challenge) {
          return res.status(400).json({ error: 'invalid_grant' });
        }
      }

      // Mark code as used
      db.run('UPDATE auth_codes SET used = 1 WHERE id = ?', [authCode.id]);

      // Generate access token
      const accessToken = crypto.randomBytes(32).toString('hex');

      // Store token
      const tokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
      db.run('INSERT INTO tokens (access_token, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
             [accessToken, clientId, authCode.user_id, authCode.scope, tokenExpiresAt]);

      // Build id_token
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const payload = {
        sub: authCode.user_id.toString(),
        iss: baseUrl,
        aud: clientId,
        exp: tokenExpiresAt,
        iat: Math.floor(Date.now() / 1000)
      };
      const idToken = jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: kid });

      // Return tokens
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        access_token: accessToken,
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600
      });
    });
  });
});

// UserInfo endpoint
app.get('/userinfo', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const token = authHeader.slice(7).trim();

  db.get('SELECT * FROM tokens WHERE access_token = ?', [token], (err, tokenRow) => {
    if (err || !tokenRow) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    if (tokenRow.expires_at < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    // Get user
    db.get('SELECT * FROM users WHERE id = ?', [tokenRow.user_id], (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'invalid_token' });
      }

      const response = { sub: user.id.toString() };
      if (tokenRow.scope.includes('email')) {
        response.email = user.email;
      }
      res.json(response);
    });
  });
});

app.post('/userinfo', (req, res) => {
  res.status(405).json({ error: 'method_not_allowed' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});