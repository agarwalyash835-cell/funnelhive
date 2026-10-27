// Off-site backups are encrypted (AES-256-GCM) before they leave the server. File layout:
//   'FHB1' · 12-byte IV · ciphertext · 16-byte auth tag
// The key comes from ENCRYPTION_KEY (or, without it, the JWT secret) — set ENCRYPTION_KEY so backups stay readable
// even if the JWT secret is ever changed. No database import here: the restore drill uses this without opening one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('FHB1');
// The recovery key: the one secret that opens the off-site backups AND the API keys / tokens stored inside them
// (messaging.js derives its key from the same value). Kept off the server by the owner (Admin → Backups); on a new
// server it goes in .env as ENCRYPTION_KEY and everything restored is readable again.
export function recoveryKey(dataDir) {
  let s = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!s) try { s = fs.readFileSync(path.join(dataDir || process.env.DATA_DIR || '.', '.jwt-secret'), 'utf8').trim(); } catch {}
  if (!s) throw new Error('no ENCRYPTION_KEY / JWT secret to encrypt backups with');
  return s;
}
const key = (dataDir) => crypto.createHash('sha256').update(`backups:${recoveryKey(dataDir)}`).digest();
export const isEncrypted = (buf) => Buffer.isBuffer(buf) && buf.length > 32 && buf.subarray(0, 4).equals(MAGIC);

// streams src → dst (the database can be large)
export async function encryptFile(src, dst, dataDir) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(dataDir), iv);
  const out = fs.createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(fs.createReadStream(src), c, out, { end: false }).catch((e) => { out.destroy(); throw e; });
  await new Promise((resolve, reject) => out.end(c.getAuthTag(), (e) => (e ? reject(e) : resolve())));
}
// streams an encrypted file → a plain one; throws (and removes dst) if the file was changed or the key is wrong
export async function decryptFile(src, dst, dataDir) {
  const size = fs.statSync(src).size;
  const head = Buffer.alloc(16), tag = Buffer.alloc(16);
  const fd = fs.openSync(src, 'r');
  try { fs.readSync(fd, head, 0, 16, 0); if (size > 32) fs.readSync(fd, tag, 0, 16, size - 16); } finally { fs.closeSync(fd); }
  if (size <= 32 || !head.subarray(0, 4).equals(MAGIC)) throw new Error('not an encrypted backup');
  const d = crypto.createDecipheriv('aes-256-gcm', key(dataDir), head.subarray(4, 16));
  d.setAuthTag(tag);
  try { await pipeline(fs.createReadStream(src, { start: 16, end: size - 17 }), d, fs.createWriteStream(dst)); } catch { fs.rmSync(dst, { force: true }); throw new Error('the backup couldn’t be decrypted (wrong ENCRYPTION_KEY, or the file is damaged)'); }
}
export const isEncryptedFile = (file) => { try { const b = Buffer.alloc(4), fd = fs.openSync(file, 'r'); try { fs.readSync(fd, b, 0, 4, 0); } finally { fs.closeSync(fd); } return b.equals(MAGIC) && fs.statSync(file).size > 32; } catch { return false; } };
// throws if the file was changed or the key is wrong
export function decryptBuffer(buf, dataDir) {
  if (!isEncrypted(buf)) throw new Error('not an encrypted backup');
  const d = crypto.createDecipheriv('aes-256-gcm', key(dataDir), buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(buf.length - 16));
  try { return Buffer.concat([d.update(buf.subarray(16, buf.length - 16)), d.final()]); } catch { throw new Error('the backup couldn’t be decrypted (wrong ENCRYPTION_KEY, or the file is damaged)'); }
}
