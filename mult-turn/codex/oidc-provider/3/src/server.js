import express from 'express';
import { handleAuthorizeGet, handleAuthorizePost } from './authorize.js';
import { initializeDatabase, openDatabase } from './database.js';
import { loadOrCreateSigningKeyPair } from './keys.js';
import { handleTokenPost } from './token.js';
import { handleUserInfoGet } from './userinfo.js';

const app = express();
const port = Number.parseInt(process.env.PORT ?? '4000', 10);
const db = openDatabase(process.env.DB_FILE);
let signingKey;

app.use((req, res, next) => {
  res.type('application/json');
  next();
});
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/.well-known/jwks.json', (req, res) => {
  res.status(200).json({ keys: [signingKey.jwk] });
});

app.get('/oauth2/authorize', async (req, res, next) => {
  try {
    await handleAuthorizeGet(req, res, db);
  } catch (error) {
    next(error);
  }
});

app.post('/oauth2/authorize', async (req, res, next) => {
  try {
    await handleAuthorizePost(req, res, db);
  } catch (error) {
    next(error);
  }
});

app.post('/oauth2/token', async (req, res, next) => {
  try {
    await handleTokenPost(req, res, db, signingKey);
  } catch (error) {
    next(error);
  }
});

app.get('/userinfo', async (req, res, next) => {
  try {
    await handleUserInfoGet(req, res, db);
  } catch (error) {
    next(error);
  }
});

app.post('/userinfo', (req, res) => {
  res.status(405).json({ error: 'method_not_allowed' });
});

try {
  [signingKey] = await Promise.all([
    loadOrCreateSigningKeyPair(),
    initializeDatabase(db),
  ]);

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}
