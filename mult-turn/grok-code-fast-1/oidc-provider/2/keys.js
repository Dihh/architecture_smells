import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEYS_DIR = 'keys';
const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_FILE = path.join(KEYS_DIR, 'public.pem');
const KID_FILE = path.join(KEYS_DIR, 'kid.txt');

let privateKey;
let publicKey;
let kid;

function generateKeys() {
  const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(PRIVATE_KEY_FILE, priv);
  fs.writeFileSync(PUBLIC_KEY_FILE, pub);

  // Generate kid as hash of public key
  kid = crypto.createHash('sha256').update(pub).digest('hex').substring(0, 16);
  fs.writeFileSync(KID_FILE, kid);

  privateKey = crypto.createPrivateKey(priv);
  publicKey = crypto.createPublicKey(pub);
}

function loadKeys() {
  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE) && fs.existsSync(KID_FILE)) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_FILE, 'utf8'));
    publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_FILE, 'utf8'));
    kid = fs.readFileSync(KID_FILE, 'utf8');
  } else {
    generateKeys();
  }
}

loadKeys();

export { privateKey, publicKey, kid };