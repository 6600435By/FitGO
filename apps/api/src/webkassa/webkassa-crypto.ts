import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Login password transform from ЛК SPA (umi.js effects), NOT generic cryptUserPsw:
 *
 *   bcryptHash = bcrypt(plainPassword, salt[0..29])
 *   secret     = AES-decrypt(salt[29..], key=bcryptHash)
 *   password'  = AES-encrypt(bcryptHash, key=secret)   ← encrypts the hash, not plaintext
 */
export function cryptLoginPassword(saltValue: string, plainPassword: string): string {
  if (saltValue.length < 30) {
    throw new Error('Webkassa salt: слишком короткий ответ');
  }
  const saltPart = saltValue.substring(0, 29);
  const encryptedPart = saltValue.substring(29);
  const bcryptHash = bcrypt.hashSync(plainPassword, saltPart);
  const secret = decryptData(encryptedPart, bcryptHash);
  if (!secret) {
    throw new Error(
      'Webkassa: не удалось расшифровать salt (проверьте WEBKASSA_PASSWORD)',
    );
  }
  return encryptData(bcryptHash, secret);
}

/**
 * Generic SPA cryptUserPsw (смена пароля и т.п.): encrypts userPassword, not bcrypt hash.
 * Kept for parity / tests; login must use {@link cryptLoginPassword}.
 */
export function cryptUserPsw(opts: {
  hash: string;
  adminPassword: string;
  userPassword: string;
}): string {
  const saltPart = opts.hash.substring(0, 29);
  const encryptedPart = opts.hash.substring(29);
  const bcryptHash = bcrypt.hashSync(opts.adminPassword, saltPart);
  const secret = decryptData(encryptedPart, bcryptHash);
  if (!secret) {
    throw new Error('Webkassa cryptUserPsw: decrypt failed');
  }
  return encryptData(opts.userPassword, secret);
}

/** PBKDF2-SHA1 → AES-256-CBC, blob = hex(salt16)+hex(iv16)+hex(ciphertext). */
export function decryptData(hexBlob: string, password: string): string | null {
  if (hexBlob.length < 64 || hexBlob.length % 2 !== 0) {
    throw new Error('Webkassa salt blob: неверный формат');
  }
  try {
    const salt = Buffer.from(hexBlob.slice(0, 32), 'hex');
    const iv = Buffer.from(hexBlob.slice(32, 64), 'hex');
    const ciphertext = Buffer.from(hexBlob.slice(64), 'hex');
    const key = deriveAesKey(password, salt);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // SPA returns false when AES decrypt fails (wrong password / bad blob)
    return null;
  }
}

export function encryptData(plaintext: string, password: string): string {
  // SPA uses getRandomString(16) + TextEncoder for PBKDF2 salt; any 16 bytes work
  // as long as they are embedded in the hex blob the server will decrypt.
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = deriveAesKey(password, salt);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return salt.toString('hex') + iv.toString('hex') + ciphertext.toString('hex');
}

function deriveAesKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 1024, 32, 'sha1');
}
