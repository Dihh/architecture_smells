import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keysDir = path.resolve(__dirname, 'keys');
const privateKeyPath = path.resolve(keysDir, 'private.pem');
const publicKeyPath = path.resolve(keysDir, 'public.pem');

function ensureKeysDirectory() {
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    }
  });

  fs.writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey, { encoding: 'utf8' });

  return { privateKey, publicKey };
}

function loadKeyPair() {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  return { privateKey, publicKey };
}

function computeKid(publicKey) {
  return crypto.createHash('sha256').update(publicKey).digest('base64url');
}

function publicKeyToJwk(publicKey, kid) {
  const keyObject = crypto.createPublicKey(publicKey);
  const jwk = keyObject.export({ format: 'jwk' });

  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid,
    n: jwk.n,
    e: jwk.e
  };
}

export function ensureKeyPair() {
  ensureKeysDirectory();

  const keysExist = fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath);
  const { privateKey, publicKey } = keysExist ? loadKeyPair() : generateKeyPair();
  const kid = computeKid(publicKey);

  return {
    privateKey,
    publicKey,
    kid,
    jwks: {
      keys: [publicKeyToJwk(publicKey, kid)]
    }
  };
}
