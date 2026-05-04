import crypto from "crypto";
import express from "express";
import { openDatabase, getClientById, getUserByUsername, getUserById, insertAuthCode, getAuthCode, markAuthCodeUsed, insertToken, getToken } from "./db.js";
import { getJwks, getKeys } from "./keys.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.set("Content-Type", "application/json");
    return originalJson(body);
  };
  next();
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/.well-known/jwks.json", async (req, res) => {
  const jwks = await getJwks();
  res.json({ keys: jwks });
});

app.get("/.well-known/openid-configuration", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    issuer: `${baseUrl}`,
    authorization_endpoint: `${baseUrl}/oauth2/authorize`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    userinfo_endpoint: `${baseUrl}/userinfo`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
});

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAuthorizationForm(params) {
  const {
    client_id = "",
    redirect_uri = "",
    response_type = "",
    scope = "",
    state = "",
    code_challenge = "",
    code_challenge_method = "",
    error,
  } = params;

  const errorHtml = error
    ? `<p style="color: red; font-weight: bold;">${htmlEscape(error)}</p>`
    : "";

  const codeChallengeFields = code_challenge
    ? `    <input type="hidden" name="code_challenge" value="${htmlEscape(code_challenge)}" />\n`
    : "";
  const codeChallengeMethodField = code_challenge_method
    ? `    <input type="hidden" name="code_challenge_method" value="${htmlEscape(code_challenge_method)}" />\n`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Login</title>
</head>
<body>
  <h1>Login</h1>
  ${errorHtml}
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id" value="${htmlEscape(client_id)}" />
    <input type="hidden" name="redirect_uri" value="${htmlEscape(redirect_uri)}" />
    <input type="hidden" name="state" value="${htmlEscape(state)}" />
    <input type="hidden" name="response_type" value="${htmlEscape(response_type)}" />
    <input type="hidden" name="scope" value="${htmlEscape(scope)}" />
${codeChallengeFields}${codeChallengeMethodField}    <div>
      <label for="username">Username:</label>
      <input id="username" name="username" type="text" required />
    </div>
    <div>
      <label for="password">Password:</label>
      <input id="password" name="password" type="password" required />
    </div>
    <button type="submit">Login</button>
  </form>
</body>
</html>`;
}

app.get("/oauth2/authorize", async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = req.query;

  if (!client_id) {
    return res.status(400).json({ error: "invalid_request", error_description: "client_id is required" });
  }

  const client = await getClientById(app.locals.db, client_id);
  if (!client) {
    return res.status(400).json({ error: "invalid_request", error_description: "client_id not found" });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is required" });
  }

  let registeredRedirectUris = [];
  try {
    registeredRedirectUris = JSON.parse(client.redirect_uris || "[]");
  } catch {
    registeredRedirectUris = [];
  }

  if (!registeredRedirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" });
  }

  if (response_type !== "code") {
    return res.status(400).json({ error: "invalid_request", error_description: "response_type must be code" });
  }

  if (!scope || !String(scope).split(/\s+/).includes("openid")) {
    return res.status(400).json({ error: "invalid_request", error_description: "scope must include openid" });
  }

  const formHtml = renderAuthorizationForm({
    client_id,
    redirect_uri,
    response_type,
    scope,
    state: state ?? "",
    code_challenge: code_challenge ?? "",
    code_challenge_method: code_challenge_method ?? "",
  });

  res.set("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(formHtml);
});

app.post("/oauth2/authorize", async (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    username,
    password,
    code_challenge,
    code_challenge_method,
  } = req.body;

  if (!client_id) {
    return res.status(400).json({ error: "invalid_request", error_description: "client_id is required" });
  }

  const client = await getClientById(app.locals.db, client_id);
  if (!client) {
    return res.status(400).json({ error: "invalid_request", error_description: "client_id not found" });
  }

  if (!redirect_uri) {
    return res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is required" });
  }

  let registeredRedirectUris = [];
  try {
    registeredRedirectUris = JSON.parse(client.redirect_uris || "[]");
  } catch {
    registeredRedirectUris = [];
  }

  if (!registeredRedirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" });
  }

  if (response_type !== "code") {
    return res.status(400).json({ error: "invalid_request", error_description: "response_type must be code" });
  }

  if (!scope || !String(scope).split(/\s+/).includes("openid")) {
    return res.status(400).json({ error: "invalid_request", error_description: "scope must include openid" });
  }

  const user = await getUserByUsername(app.locals.db, username || "");
  if (!user || user.password !== password) {
    const formHtml = renderAuthorizationForm({
      client_id,
      redirect_uri,
      response_type,
      scope,
      state: state ?? "",
      code_challenge: code_challenge ?? "",
      code_challenge_method: code_challenge_method ?? "",
      error: "Invalid username or password",
    });
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send(formHtml);
  }

  const code = crypto.randomBytes(32).toString("hex");
  const expires_at = Math.floor(Date.now() / 1000) + 10 * 60;

  await insertAuthCode(app.locals.db, {
    code,
    client_id,
    user_id: user.id,
    redirect_uri,
    scope,
    code_challenge: code_challenge || null,
    code_challenge_method: code_challenge_method || null,
    expires_at,
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return res.redirect(302, redirectUrl.toString());
});

function parseBasicAuth(authorization) {
  if (!authorization || typeof authorization !== "string") return null;
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (!match) return null;

  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) return null;

  return {
    client_id: decoded.slice(0, separatorIndex),
    client_secret: decoded.slice(separatorIndex + 1),
  };
}

function getClientCredentials(req) {
  const authorization = req.get("authorization");
  const basic = parseBasicAuth(authorization);
  if (basic && basic.client_id && basic.client_secret !== undefined) {
    return basic;
  }

  const { client_id, client_secret } = req.body || {};
  if (client_id && client_secret !== undefined) {
    return { client_id, client_secret };
  }

  return {};
}

function invalidRequest(res) {
  return res.status(400).json({ error: "invalid_request" });
}

function unsupportedGrantType(res) {
  return res.status(400).json({ error: "unsupported_grant_type" });
}

function invalidClient(res) {
  return res.status(401).json({ error: "invalid_client" });
}

function invalidGrant(res) {
  return res.status(400).json({ error: "invalid_grant" });
}

function parseBearerToken(authorization) {
  if (!authorization || typeof authorization !== "string") return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1];
}

function base64urlEncode(buffer) {
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(payload, privateKeyPem, kid) {
  const header = {
    alg: "RS256",
    kid,
    typ: "JWT",
  };

  const encodedHeader = base64urlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const encodedPayload = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).end().sign(privateKeyPem);
  const encodedSignature = base64urlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

app.post("/oauth2/token", async (req, res) => {
  const { grant_type, code, redirect_uri, code_verifier } = req.body;

  if (!grant_type || grant_type === undefined) {
    return invalidRequest(res);
  }

  if (!code) {
    return invalidRequest(res);
  }

  if (!redirect_uri) {
    return invalidRequest(res);
  }

  if (grant_type !== "authorization_code") {
    return unsupportedGrantType(res);
  }

  const credentials = getClientCredentials(req);
  if (!credentials.client_id || credentials.client_secret === undefined) {
    return invalidClient(res);
  }

  const client = await getClientById(app.locals.db, credentials.client_id);
  if (!client) {
    return invalidClient(res);
  }

  if (client.client_secret !== credentials.client_secret) {
    return invalidClient(res);
  }

  const authCode = await getAuthCode(app.locals.db, code);
  const now = Math.floor(Date.now() / 1000);
  if (
    !authCode ||
    authCode.used === 1 ||
    authCode.expires_at < now ||
    authCode.redirect_uri !== redirect_uri ||
    authCode.client_id !== credentials.client_id
  ) {
    return invalidGrant(res);
  }

  if (authCode.code_challenge) {
    if (!code_verifier) {
      return invalidGrant(res);
    }
    if (authCode.code_challenge_method === "S256") {
      const hashed = crypto.createHash("sha256").update(code_verifier, "utf8").digest();
      const encodedVerifier = base64urlEncode(hashed);
      if (encodedVerifier !== authCode.code_challenge) {
        return invalidGrant(res);
      }
    }
  }

  await markAuthCodeUsed(app.locals.db, code);

  const accessToken = crypto.randomBytes(32).toString("hex");
  const accessExpiresAt = now + 3600;

  await insertToken(app.locals.db, {
    access_token: accessToken,
    client_id: credentials.client_id,
    user_id: authCode.user_id,
    scope: authCode.scope,
    expires_at: accessExpiresAt,
  });

  const keys = await getKeys();
  const issuer = `${req.protocol}://${req.get("host")}`;
  const idTokenPayload = {
    sub: String(authCode.user_id),
    iss: issuer,
    aud: credentials.client_id,
    exp: now + 3600,
    iat: now,
  };
  const idToken = signJwt(idTokenPayload, keys.privateKeyPem, keys.kid);

  res.set("Cache-Control", "no-store");
  return res.status(200).json({
    access_token: accessToken,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: 3600,
  });
});

app.get("/userinfo", async (req, res) => {
  const authorization = req.get("authorization");
  const token = parseBearerToken(authorization);
  if (!token) {
    return res.status(401).json({ error: "invalid_token" });
  }

  const accessRecord = await getToken(app.locals.db, token);
  const now = Math.floor(Date.now() / 1000);
  if (!accessRecord || accessRecord.expires_at < now) {
    return res.status(401).json({ error: "invalid_token" });
  }

  const user = await getUserById(app.locals.db, accessRecord.user_id);
  if (!user) {
    return res.status(401).json({ error: "invalid_token" });
  }

  const response = { sub: String(user.id) };
  if (String(accessRecord.scope).split(/\s+/).includes("email")) {
    response.email = user.email;
  }

  return res.status(200).json(response);
});

app.post("/userinfo", (req, res) => {
  res.set("Allow", "GET");
  return res.status(405).json({ error: "method_not_allowed" });
});

async function startServer() {
  const db = await openDatabase();
  app.locals.db = db;
  const keys = await getKeys();
  console.log(`Loaded JWKS key kid=${keys.kid}`);

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
