import fs from "fs/promises";
import { createHash, createPublicKey, generateKeyPairSync } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const keysDir = join(__dirname, "../keys");
const privateKeyPath = join(keysDir, "private.pem");
const publicKeyPath = join(keysDir, "public.pem");

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function computeKid(publicKeyPem) {
  return createHash("sha256").update(publicKeyPem).digest("base64url");
}

async function ensureKeysDirectory() {
  await fs.mkdir(keysDir, { recursive: true });
}

async function writeKeyFiles(privatePem, publicPem) {
  await ensureKeysDirectory();
  await fs.writeFile(privateKeyPath, privatePem, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(publicKeyPath, publicPem, { encoding: "utf8" });
}

export async function loadOrCreateKeys() {
  await ensureKeysDirectory();

  let privateKeyPem;
  let publicKeyPem;

  if (await fileExists(privateKeyPath) && (await fileExists(publicKeyPath))) {
    privateKeyPem = await fs.readFile(privateKeyPath, "utf8");
    publicKeyPem = await fs.readFile(publicKeyPath, "utf8");
  } else {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    privateKeyPem = privateKey;
    publicKeyPem = publicKey;
    await writeKeyFiles(privateKeyPem, publicKeyPem);
  }

  const kid = computeKid(publicKeyPem);
  const publicJwk = createPublicKey(publicKeyPem).export({ format: "jwk" });

  return {
    privateKeyPem,
    publicKeyPem,
    kid,
    jwk: {
      kty: publicJwk.kty,
      use: "sig",
      alg: "RS256",
      kid,
      n: publicJwk.n,
      e: publicJwk.e,
    },
  };
}

let loadedKeys;

export async function getKeys() {
  if (!loadedKeys) {
    loadedKeys = await loadOrCreateKeys();
  }
  return loadedKeys;
}

export async function getJwks() {
  const keys = await getKeys();
  return [keys.jwk];
}
