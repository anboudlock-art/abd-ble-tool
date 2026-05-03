import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ApiError } from '@abd/shared';
import { getAuthContext } from '../lib/auth.js';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function extFromMime(mime: string, fallback = '.jpg'): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    default:
      return fallback;
  }
}

/**
 * v2.8 Ask 4: APP uploads deployment / ack-time photos. multipart/form-data,
 * single file under field name `file`. Returns `{ url, sizeBytes, mimeType }`.
 *
 * Storage layout under UPLOAD_DIR (env-configurable, default
 * `/var/abd/uploads`):
 *   YYYY/MM/DD/<ulid>.<ext>
 *
 * Files served back at `/uploads/*` by the @fastify/static plugin
 * registered in app.ts. Until Nginx + domain are wired up, that's
 * served straight from the API process.
 */
export default async function uploadRoutes(app: FastifyInstance) {
  app.post('/uploads', { onRequest: [app.authenticate] }, async (req, reply) => {
    // Force the auth context even though we don't gate by role — only
    // logged-in users may upload, so we can blame an actor if abuse
    // shows up.
    getAuthContext(req);

    const file = await req.file({ limits: { fileSize: MAX_BYTES + 1 } });
    if (!file) throw ApiError.badRequest('No file part');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw ApiError.badRequest(`Unsupported mime type: ${file.mimetype}`);
    }

    const buf = await file.toBuffer();
    if (buf.length > MAX_BYTES) {
      throw ApiError.badRequest(`File exceeds ${MAX_BYTES} bytes`);
    }

    const root = process.env.UPLOAD_DIR ?? '/var/abd/uploads';
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const dir = join(root, yyyy, mm, dd);
    await mkdir(dir, { recursive: true });

    const id = randomUUID();
    const ext = extFromMime(file.mimetype, extname(file.filename) || '.bin');
    const filename = `${id}${ext}`;
    await writeFile(join(dir, filename), buf);

    const url = `/uploads/${yyyy}/${mm}/${dd}/${filename}`;
    reply.code(201);
    return {
      url,
      sizeBytes: buf.length,
      mimeType: file.mimetype,
      originalName: file.filename,
    };
  });
}
