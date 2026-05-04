import { createHash, createPublicKey, generateKeyPairSync } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

const DEFAULT_PRIVATE_KEY_PATH = 'keys/private.pem';
const DEFAULT_PUBLIC_KEY_PATH = 'keys/public.pem';

export async function loadOrCreateSigningKeyPair({
  privateKeyPath = DEFAULT_PRIVATE_KEY_PATH,
  publicKeyPath = DEFAULT_PUBLIC_KEY_PATH,
} = {}) {
  try {
    const [privateKeyPem, publicKeyPem] = await Promise.all([
      readFile(privateKeyPath, 'utf8'),
      readFile(publicKeyPath, 'utf8'),
    ]);

    return buildSigningKey(privateKeyPem, publicKeyPem);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    return generateAndPersistSigningKeyPair(privateKeyPath, publicKeyPath);
  }
}

async function generateAndPersistSigningKeyPair(privateKeyPath, publicKeyPath) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
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

  await Promise.all([
    mkdir(dirname(privateKeyPath), { recursive: true }),
    mkdir(dirname(publicKeyPath), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(privateKeyPath, privateKey, { mode: 0o600 }),
    writeFile(publicKeyPath, publicKey, { mode: 0o644 }),
  ]);

  return buildSigningKey(privateKey, publicKey);
}

function buildSigningKey(privateKeyPem, publicKeyPem) {
  const publicJwk = createPublicKey(publicKeyPem).export({ format: 'jwk' });
  const kid = createHash('sha256')
    .update(publicKeyPem)
    .digest('base64url')
    .slice(0, 32);

  return {
    kid,
    privateKeyPem,
    publicKeyPem,
    jwk: {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid,
      n: publicJwk.n,
      e: publicJwk.e,
    },
  };
}
