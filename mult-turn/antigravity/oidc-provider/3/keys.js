import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const KEYS_DIR = './keys';
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');
const KID_PATH = path.join(KEYS_DIR, 'kid.txt');

export async function getKeys() {
  try {
    await fs.mkdir(KEYS_DIR, { recursive: true });

    let privateKey, publicKey, kid;

    try {
      privateKey = await fs.readFile(PRIVATE_KEY_PATH, 'utf8');
      publicKey = await fs.readFile(PUBLIC_KEY_PATH, 'utf8');
      kid = await fs.readFile(KID_PATH, 'utf8');
      console.log('Loaded existing RSA keys.');
    } catch (err) {
      console.log('Generating new RSA key pair...');
      const { privateKey: priv, publicKey: pub } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      privateKey = priv;
      publicKey = pub;
      kid = crypto.randomBytes(16).toString('hex');

      await fs.writeFile(PRIVATE_KEY_PATH, privateKey);
      await fs.writeFile(PUBLIC_KEY_PATH, publicKey);
      await fs.writeFile(KID_PATH, kid);
      console.log('New RSA keys generated and saved.');
    }

    return { privateKey, publicKey, kid };
  } catch (error) {
    console.error('Error managing RSA keys:', error);
    throw error;
  }
}

export function getJwks(publicKeyPem, kid) {
  const pubKey = crypto.createPublicKey(publicKeyPem);
  const jwk = pubKey.export({ format: 'jwk' });

  return {
    keys: [
      {
        kty: jwk.kty,
        use: 'sig',
        alg: 'RS256',
        kid: kid,
        n: jwk.n,
        e: jwk.e,
      },
    ],
  };
}
