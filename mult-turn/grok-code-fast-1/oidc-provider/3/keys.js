import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEYS_DIR = 'keys';
const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_FILE = path.join(KEYS_DIR, 'public.pem');
const KID_FILE = path.join(KEYS_DIR, 'kid.txt');

export function loadOrGenerateKeys() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR);
  }

  let privateKey, publicKey, kid;

  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE) && fs.existsSync(KID_FILE)) {
    // Load existing keys
    privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_FILE));
    publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_FILE));
    kid = fs.readFileSync(KID_FILE, 'utf8').trim();
  } else {
    // Generate new key pair
    const { privateKey: priv, publicKey: pub } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    privateKey = priv;
    publicKey = pub;

    // Save to files
    fs.writeFileSync(PRIVATE_KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(PUBLIC_KEY_FILE, publicKey.export({ type: 'spki', format: 'pem' }));

    // Generate kid as hash of public key
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    kid = crypto.createHash('sha256').update(publicKeyPem).digest('base64url').substring(0, 16);
    fs.writeFileSync(KID_FILE, kid);
  }

  return { privateKey, publicKey, kid };
}

export function getJWKS(publicKey, kid) {
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: kid,
        n: jwk.n,
        e: jwk.e,
      },
    ],
  };
}