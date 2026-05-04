import { createHash, randomBytes, sign } from 'crypto';
import {
  createToken,
  findAuthorizationCode,
  findClientByClientId,
  markAuthorizationCodeUsed,
} from './database.js';

const ACCESS_TOKEN_TTL_SECONDS = 3600;

export async function handleTokenPost(req, res, db, signingKey) {
  res.set('Cache-Control', 'no-store');

  const requestValidation = validateTokenRequest(req.body);
  if (!requestValidation.valid) {
    res.status(400).json({ error: requestValidation.error });
    return;
  }

  const credentials = getClientCredentials(req);
  if (!credentials.clientId) {
    res.status(401).json({ error: 'invalid_client' });
    return;
  }

  const client = await findClientByClientId(db, credentials.clientId);
  if (!client || client.client_secret !== credentials.clientSecret) {
    res.status(401).json({ error: 'invalid_client' });
    return;
  }

  const code = getBodyParam(req.body.code);
  const redirectUri = getBodyParam(req.body.redirect_uri);
  const authCode = await findAuthorizationCode(db, code);

  if (!isAuthorizationCodeValid(authCode, credentials.clientId, redirectUri)) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  if (!isPkceValid(authCode, getBodyParam(req.body.code_verifier))) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  const markResult = await markAuthorizationCodeUsed(db, code);
  if (markResult.changes !== 1) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
  const accessToken = randomBytes(32).toString('base64url');

  await createToken(db, {
    accessToken,
    clientId: authCode.client_id,
    userId: authCode.user_id,
    scope: authCode.scope,
    expiresAt,
  });

  const idToken = signIdToken({
    signingKey,
    issuer: getIssuer(req),
    clientId: authCode.client_id,
    userId: authCode.user_id,
    issuedAt: now,
    expiresAt,
  });

  res
    .status(200)
    .json({
      access_token: accessToken,
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
}

function validateTokenRequest(body) {
  const grantType = getBodyParam(body.grant_type);
  const code = getBodyParam(body.code);
  const redirectUri = getBodyParam(body.redirect_uri);

  if (!grantType || !code || !redirectUri) {
    return invalid('invalid_request');
  }

  if (grantType !== 'authorization_code') {
    return invalid('unsupported_grant_type');
  }

  return { valid: true };
}

function getClientCredentials(req) {
  const basicCredentials = getBasicCredentials(req.get('authorization'));
  if (basicCredentials.clientId) {
    return basicCredentials;
  }

  return {
    clientId: getBodyParam(req.body.client_id),
    clientSecret: getBodyParam(req.body.client_secret),
  };
}

function getBasicCredentials(authorizationHeader) {
  if (!authorizationHeader?.startsWith('Basic ')) {
    return {};
  }

  const encodedCredentials = authorizationHeader.slice('Basic '.length).trim();
  const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString(
    'utf8'
  );
  const separatorIndex = decodedCredentials.indexOf(':');

  if (separatorIndex === -1) {
    return {};
  }

  return {
    clientId: decodedCredentials.slice(0, separatorIndex),
    clientSecret: decodedCredentials.slice(separatorIndex + 1),
  };
}

function isAuthorizationCodeValid(authCode, clientId, redirectUri) {
  const now = Math.floor(Date.now() / 1000);

  return (
    authCode &&
    authCode.used !== 1 &&
    authCode.expires_at >= now &&
    authCode.redirect_uri === redirectUri &&
    authCode.client_id === clientId
  );
}

function isPkceValid(authCode, codeVerifier) {
  if (!authCode.code_challenge) {
    return true;
  }

  if (!codeVerifier) {
    return false;
  }

  const challenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return challenge === authCode.code_challenge;
}

function signIdToken({
  signingKey,
  issuer,
  clientId,
  userId,
  issuedAt,
  expiresAt,
}) {
  const header = {
    alg: 'RS256',
    kid: signingKey.kid,
  };
  const payload = {
    sub: String(userId),
    iss: issuer,
    aud: clientId,
    exp: expiresAt,
    iat: issuedAt,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), {
    key: signingKey.privateKeyPem,
  }).toString('base64url');

  return `${signingInput}.${signature}`;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function getIssuer(req) {
  return process.env.ISSUER ?? `${req.protocol}://${req.get('host')}`;
}

function getBodyParam(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function invalid(error) {
  return { valid: false, error };
}
