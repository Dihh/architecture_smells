import { generateKeyPairSync, createPublicKey, createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'public.pem');
const KID_PATH = join(KEYS_DIR, 'kid.txt');

let privateKey;
let publicKey;
let kid;

function deriveKid(pubPem) {
  return createHash('sha256').update(pubPem).digest('hex').slice(0, 16);
}

export function loadOrGenerateKeys() {
  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf8');
    publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf8');
    kid = existsSync(KID_PATH) ? readFileSync(KID_PATH, 'utf8').trim() : deriveKid(publicKey);
  } else {
    mkdirSync(KEYS_DIR, { recursive: true });
    const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    privateKey = priv;
    publicKey = pub;
    kid = deriveKid(publicKey);
    writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    writeFileSync(PUBLIC_KEY_PATH, publicKey);
    writeFileSync(KID_PATH, kid);
  }
  console.log(`RSA key loaded, kid=${kid}`);
}

export function getPrivateKey() {
  return privateKey;
}

export function getJwks() {
  const keyObj = createPublicKey(publicKey);
  const { n, e } = keyObj.export({ format: 'jwk' });
  return {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid,
        n,
        e,
      },
    ],
  };
}
