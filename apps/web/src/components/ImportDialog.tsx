'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, X } from 'lucide-react';
import { apiRequest, type BatchListResp } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface Props {
  onClose: () => void;
  onDone: () => void;
}

interface ParsedRow {
  rowNum: number;
  lockId: string;
  bleMac: string;
  imei?: string;
  firmwareVersion?: string;
  qcResult: string;
  qcRemark?: string;
}

interface RowResult {
  rowNum: number;
  lockId: string;
  status: 'pending' | 'ok' | 'error';
  message?: string;
}

const TEMPLATE = [
  'lockId,bleMac,imei,firmwareVersion,qcResult,qcRemark',
  '60806001,E1:6A:9C:F1:F8:7E,860041068503363,V10.0,passed,',
  '60806002,E1:6A:9C:F1:F8:80,,,passed,',
].join('\n');

export function ImportDialog({ onClose, onDone }: Props) {
  const qc = useQueryClient();
  const [batchId, setBatchId] = useState('');
  const [rawText, setRawText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [running, setRunning] = useState(false);

  const batchesQ = useQuery({
    queryKey: ['batches', { all: true }],
    queryFn: () =>
      apiRequest<BatchListResp>('/api/v1/production/batches', {
        query: { pageSize: 100 },
      }),
  });

  function downloadTemplate() {
    const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'device-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
    const r = new FileReader();
    r.onload = () => setRawText(String(r.result ?? ''));
    r.readAsText(file, 'utf-8');
  }

  function parse() {
    setParseError(null);
    setResults([]);
    const text = rawText.replace(/^﻿/, '').trim();
    if (!text) {
      setParseError('请粘贴或上传 CSV 内容');
      return;
    }
    const lines = text.split(/\r?\n/);
    const header = lines[0]!.split(',').map((s) => s.trim());
    const required = ['lockId', 'bleMac'];
    for (const r of required) {
      if (!header.includes(r)) {
        setParseError(`CSV 必须包含 "${r}" 列`);
        return;
      }
    }
    const idx = (k: string) => header.indexOf(k);
    const out: ParsedRow[] = [];
    const errs: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const cells = splitCsv(line);
      const lockId = (cells[idx('lockId')] ?? '').trim();
      const bleMac = (cells[idx('bleMac')] ?? '').trim();
      if (!lockId || !bleMac) {
        errs.push(`第 ${i + 1} 行：lockId / bleMac 不能为空`);
        continue;
      }
      if (!/^\d{8}$/.test(lockId)) {
        errs.push(`第 ${i + 1} 行：lockId 必须为 8 位数字`);
        continue;
      }
      if (!/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(bleMac)) {
        errs.push(`第 ${i + 1} 行：bleMac 格式错误`);
        continue;
      }
      const imei = ((cells[idx('imei')] ?? '').trim() || undefined) as string | undefined;
      if (imei && !/^\d{15}$/.test(imei)) {
        errs.push(`第 ${i + 1} 行：imei 必须为 15 位数字`);
        continue;
      }
      out.push({
        rowNum: i + 1,
        lockId,
        bleMac: bleMac.toUpperCase(),
        imei,
        firmwareVersion: (cells[idx('firmwareVersion')] ?? '').trim() || undefined,
        qcResult: (cells[idx('qcResult')] ?? '').trim() || 'passed',
        qcRemark: (cells[idx('qcRemark')] ?? '').trim() || undefined,
      });
    }
    if (errs.length) {
      setParseError(errs.slice(0, 5).join('\n') + (errs.length > 5 ? `\n…还有 ${errs.length - 5} 行错误` : ''));
    }
    setRows(out);
  }

  async function runImport() {
    if (!batchId) {
      setParseError('请选择批次');
      return;
    }
    setRunning(true);
    setResults(rows.map((r) => ({ rowNum: r.rowNum, lockId: r.lockId, status: 'pending' as const })));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      try {
        await apiRequest('/api/v1/production/scans', {
          method: 'POST',
          body: {
            batchId: Number(batchId),
            lockId: r.lockId,
            bleMac: r.bleMac,
            imei: r.imei,
            firmwareVersion: r.firmwareVersion,
            qcResult: r.qcResult,
            qcRemark: r.qcRemark,
          },
        });
        setResults((prev) =>
          prev.map((p) => (p.rowNum === r.rowNum ? { ...p, status: 'ok' } : p)),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        setResults((prev) =>
          prev.map((p) =>
            p.rowNum === r.rowNum ? { ...p, status: 'error', message: msg } : p,
          ),
        );
      }
    }

    setRunning(false);
    void qc.invalidateQueries({ queryKey: ['devices'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.filter((r) => r.status === 'error').length;
  const allDone = results.length > 0 && results.every((r) => r.status !== 'pending');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">批量导入设备</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            CSV 格式 · 表头必须包含 <code className="font-mono">lockId,bleMac</code>，可选{' '}
            <code className="font-mono">imei,firmwareVersion,qcResult,qcRemark</code>
            <Button variant="ghost" className="ml-2 inline-flex !px-2 !py-1" onClick={downloadTemplate}>
              <Download size={12} /> 模板
            </Button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">所属批次</label>
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              disabled={running}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— 选择批次 —</option>
              {batchesQ.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} · {b.modelCode ?? ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">CSV 内容</label>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={running}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="mb-2 block w-full text-sm"
            />
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={running}
              placeholder="或者在这里粘贴 CSV 文本"
              className="block h-32 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs"
            />
          </div>

          {parseError ? (
            <div className="whitespace-pre-line rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {parseError}
            </div>
          ) : null}

          {rows.length > 0 && results.length === 0 ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              已解析 {rows.length} 行，准备就绪
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs text-slate-600">
                进度：{okCount + errCount} / {results.length} ·{' '}
                <span className="text-emerald-600">成功 {okCount}</span> ·{' '}
                <span className="text-red-600">失败 {errCount}</span>
              </div>
              <div className="max-h-48 overflow-y-auto rounded border border-slate-200 text-xs">
                {results.map((r) => (
                  <div
                    key={r.rowNum}
                    className="flex items-center justify-between border-b border-slate-100 px-2 py-1 last:border-0"
                  >
                    <span className="font-mono">行 {r.rowNum} · {r.lockId}</span>
                    {r.status === 'pending' ? (
                      <span className="text-slate-400">等待…</span>
                    ) : r.status === 'ok' ? (
                      <span className="text-emerald-600">✓ 入库</span>
                    ) : (
                      <span className="truncate text-red-600" title={r.message}>
                        ✗ {r.message}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <div className="flex gap-2">
            {rows.length === 0 ? (
              <Button variant="secondary" onClick={parse} disabled={running}>
                <FileUp size={14} /> 解析 CSV
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {allDone ? '关闭' : '取消'}
            </Button>
            {rows.length > 0 && results.length === 0 ? (
              <Button onClick={runImport} disabled={!batchId || running}>
                开始导入 ({rows.length} 行)
              </Button>
            ) : null}
            {allDone ? (
              <Button onClick={onDone}>完成</Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minimal CSV cell splitter (handles quoted cells with embedded commas). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else if (c === '"' && cur === '') {
      inQuote = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
