import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const KEYS_DIR = path.resolve('keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');
const KID_PATH = path.join(KEYS_DIR, 'kid.txt');

export let keyPair = {
  privateKey: null,
  publicKey: null,
  kid: null,
};

async function ensureKeysDir() {
  try {
    await fs.mkdir(KEYS_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

export async function initKeys() {
  await ensureKeysDir();

  try {
    const privateKeyPem = await fs.readFile(PRIVATE_KEY_PATH, 'utf8');
    const publicKeyPem = await fs.readFile(PUBLIC_KEY_PATH, 'utf8');
    const kid = await fs.readFile(KID_PATH, 'utf8');

    keyPair.privateKey = privateKeyPem;
    keyPair.publicKey = publicKeyPem;
    keyPair.kid = kid;
    console.log('Loaded existing RSA keys.');
  } catch (err) {
    console.log('Generating new RSA key pair...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    const kid = crypto.randomBytes(16).toString('hex');

    await fs.writeFile(PRIVATE_KEY_PATH, privateKey);
    await fs.writeFile(PUBLIC_KEY_PATH, publicKey);
    await fs.writeFile(KID_PATH, kid);

    keyPair.privateKey = privateKey;
    keyPair.publicKey = publicKey;
    keyPair.kid = kid;
    console.log('New RSA keys generated and saved.');
  }
}

export function getJwks() {
  if (!keyPair.publicKey) return { keys: [] };

  const key = crypto.createPublicKey(keyPair.publicKey);
  const jwk = key.export({ format: 'jwk' });

  return {
    keys: [
      {
        kty: jwk.kty,
        use: 'sig',
        alg: 'RS256',
        kid: keyPair.kid,
        n: jwk.n,
        e: jwk.e,
      },
    ],
  };
}
