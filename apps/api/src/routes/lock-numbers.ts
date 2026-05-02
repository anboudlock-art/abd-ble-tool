import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError, GenerateLockNumbersSchema } from '@abd/shared';
import { getAuthContext, requireRole } from '../lib/auth.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';

/**
 * v2.6 §0.2 锁号生成器.
 *
 * Lock ID format (8 digits): yMMsssss
 *   y     = year mod 10              (e.g. 2026 → 6)
 *   MM    = 2-digit month            (e.g. May → 05)
 *   sssss = 5-digit serial within month, starting at startSeq
 *
 * Generated rows go into `lock_number` with status='reserved'. Three export
 * formats are supplied:
 *   - excel : single-sheet xlsx
 *   - qr-zip: ZIP of one PNG per lock (filename = lockId.png)
 *   - pdf   : A4 grid for batch printing (5 columns × 13 rows = 65/page)
 */
export default async function lockNumberRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // -------------------- generate --------------------

  typed.post(
    '/lock-numbers/generate',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { body: GenerateLockNumbersSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { batchId, year, month, startSeq, count } = req.body;

      const batch = await prisma.productionBatch.findUnique({
        where: { id: BigInt(batchId) },
      });
      if (!batch) throw ApiError.notFound('Batch not found');
      if (batch.completedAt) throw ApiError.conflict('Batch is closed');

      // Build the lock IDs
      const prefix = `${year % 10}${String(month).padStart(2, '0')}`;
      const lockIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const seq = startSeq + i;
        if (seq > 99_999) throw ApiError.conflict(`Seq ${seq} exceeds 5-digit limit`);
        lockIds.push(`${prefix}${String(seq).padStart(5, '0')}`);
      }

      // Reject if any of these IDs already exist (uniqueness on lockNumber.lockId)
      const dup = await prisma.lockNumber.findMany({
        where: { lockId: { in: lockIds } },
        select: { lockId: true },
      });
      if (dup.length > 0) {
        throw ApiError.conflict(
          `${dup.length} lock id(s) already exist (e.g. ${dup[0]!.lockId})`,
        );
      }

      const result = await prisma.lockNumber.createMany({
        data: lockIds.map((lockId) => ({
          lockId,
          batchId: batch.id,
          generatedByUserId: ctx.userId,
        })),
      });
      reply.code(201);
      return {
        batchId: batch.id.toString(),
        batchNo: batch.batchNo,
        prefix,
        startSeq,
        count: result.count,
        firstLockId: lockIds[0],
        lastLockId: lockIds[lockIds.length - 1],
      };
    },
  );

  // -------------------- export --------------------

  typed.get(
    '/lock-numbers/export',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: {
        querystring: z.object({
          batchId: z.coerce.number().int().positive(),
          format: z.enum(['excel', 'qr-zip', 'pdf']).default('excel'),
        }),
      },
    },
    async (req, reply) => {
      const { batchId, format } = req.query;
      const batch = await prisma.productionBatch.findUnique({
        where: { id: BigInt(batchId) },
      });
      if (!batch) throw ApiError.notFound('Batch not found');

      const items = await prisma.lockNumber.findMany({
        where: { batchId: BigInt(batchId) },
        orderBy: { lockId: 'asc' },
        select: { lockId: true, status: true, createdAt: true, registeredAt: true },
      });

      if (format === 'excel') {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('LockNumbers');
        ws.columns = [
          { header: '锁号', key: 'lockId', width: 14 },
          { header: '状态', key: 'status', width: 14 },
          { header: '生成时间', key: 'createdAt', width: 22 },
          { header: '注册时间', key: 'registeredAt', width: 22 },
        ];
        for (const it of items) {
          ws.addRow({
            lockId: it.lockId,
            status: it.status,
            createdAt: it.createdAt.toISOString(),
            registeredAt: it.registeredAt?.toISOString() ?? '',
          });
        }
        const buf = await wb.xlsx.writeBuffer();
        reply
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header(
            'Content-Disposition',
            `attachment; filename="locknumbers_${batch.batchNo}.xlsx"`,
          )
          .send(Buffer.from(buf));
        return reply;
      }

      if (format === 'qr-zip') {
        const zip = new JSZip();
        for (const it of items) {
          const png = await QRCode.toBuffer(it.lockId, {
            type: 'png',
            width: 256,
            margin: 1,
          });
          zip.file(`${it.lockId}.png`, png);
        }
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        reply
          .type('application/zip')
          .header(
            'Content-Disposition',
            `attachment; filename="qr_${batch.batchNo}.zip"`,
          )
          .send(buf);
        return reply;
      }

      // pdf — A4 sheet with 5×13 grid (65 labels per page)
      const cols = 5;
      const rows = 13;
      const perPage = cols * rows;
      const doc = new PDFDocument({ size: 'A4', margin: 24 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      const ended = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
      });

      const cellW = (595.28 - 48) / cols; // A4 = 595.28pt wide, margin 24 each side
      const cellH = (841.89 - 48) / rows;
      for (let i = 0; i < items.length; i++) {
        if (i > 0 && i % perPage === 0) doc.addPage({ size: 'A4', margin: 24 });
        const idxOnPage = i % perPage;
        const col = idxOnPage % cols;
        const row = Math.floor(idxOnPage / cols);
        const x = 24 + col * cellW;
        const y = 24 + row * cellH;
        const png = await QRCode.toBuffer(items[i]!.lockId, {
          type: 'png',
          width: 200,
          margin: 0,
        });
        doc.image(png, x + 8, y + 4, { width: cellW - 16, height: cellH - 22 });
        doc.fontSize(9).text(items[i]!.lockId, x, y + cellH - 16, {
          width: cellW,
          align: 'center',
        });
      }
      doc.end();
      const buf = await ended;
      reply
        .type('application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="labels_${batch.batchNo}.pdf"`,
        )
        .send(buf);
      return reply;
    },
  );
}
