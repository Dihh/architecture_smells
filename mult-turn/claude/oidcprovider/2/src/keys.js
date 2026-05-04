import { generateKeyPairSync, createHash, createPublicKey } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'keys');
const PRIVATE_KEY_PATH = join(ROOT, 'private.pem');
const PUBLIC_KEY_PATH = join(ROOT, 'public.pem');
const KID_PATH = join(ROOT, 'kid.txt');

let privateKey;
let publicKey;
let kid;

export function loadOrGenerateKeys() {
  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH) && existsSync(KID_PATH)) {
    privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf8');
    publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf8');
    kid = readFileSync(KID_PATH, 'utf8').trim();
    console.log(`Loaded existing RSA key pair (kid: ${kid})`);
  } else {
    mkdirSync(ROOT, { recursive: true });
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    kid = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
    writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    writeFileSync(PUBLIC_KEY_PATH, publicKey);
    writeFileSync(KID_PATH, kid);
    console.log(`Generated new RSA key pair (kid: ${kid})`);
  }
}

export function getPrivateKey() {
  return privateKey;
}

export function getJwks() {
  const keyObject = createPublicKey(publicKey);
  const { n, e } = keyObject.export({ format: 'jwk' });
  return {
    keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid, n, e }],
  };
}
