/**
 * Attachment storage helpers (Phase 4).
 *
 * Files are stored on local disk under STORAGE_DIR (default
 * ~/workspace/atlas-erp/storage). The file_key (random uuid + original
 * extension) is S3-safe by design so a future S3-compatible backend can reuse
 * the same keys behind this module's interface.
 */
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function maxUploadMb(): number {
  const v = Number(process.env.MAX_UPLOAD_MB);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

/** Storage root; created on demand. */
export function storageDir(): string {
  return process.env.STORAGE_DIR || join(homedir(), 'workspace', 'atlas-erp', 'storage');
}

export function ensureStorageDir(): string {
  const dir = storageDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Allowed upload MIME types: images, PDF, CSV, Excel, plain text. */
const ALLOWED_EXACT = new Set([
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function isAllowedMime(mime: string): boolean {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  return m.startsWith('image/') || ALLOWED_EXACT.has(m);
}

/** Random storage key preserving the original extension (lowercased). */
export function storageKeyFor(originalName: string): string {
  return `${randomUUID()}${extname(originalName || '').toLowerCase()}`;
}

/** Minimal structural type for a multer memory-storage file (avoids a hard @types/multer dependency at the call sites). */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
