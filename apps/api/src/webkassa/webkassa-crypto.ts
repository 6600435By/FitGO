import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Mirrors cabinet.webkassa.by SPA modules `1wK3` / `+n12`:
 * salt → bcrypt(adminPassword) → AES decrypt secret → AES encrypt userPassword.
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
  return encryptData(opts.userPassword, secret);
}

/** PBKDF2-SHA1 → AES-256-CBC, blob = hex(salt16)+hex(iv16)+hex(ciphertext). */
export function decryptData(hexBlob: string, password: string): string {
  if (hexBlob.length < 64 || hexBlob.length % 2 !== 0) {
    throw new Error('Webkassa salt blob: неверный формат');
  }
  const salt = Buffer.from(hexBlob.slice(0, 32), 'hex');
  const iv = Buffer.from(hexBlob.slice(32, 64), 'hex');
  const ciphertext = Buffer.from(hexBlob.slice(64), 'hex');
  const key = deriveAesKey(password, salt);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

export function encryptData(plaintext: string, password: string): string {
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
