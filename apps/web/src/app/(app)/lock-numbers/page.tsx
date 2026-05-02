'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, QrCode } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  downloadFile,
  type BatchListResp,
} from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface LockNumberItem {
  id: string;
  lockId: string;
  status: 'reserved' | 'registered' | 'voided';
  deviceId: string | null;
  createdAt: string;
  registeredAt: string | null;
}
interface LockNumberListResp {
  batchId: string;
  batchNo: string;
  items: LockNumberItem[];
  total: number;
}

/**
 * 锁号生成器（v2.6 §0.2）— 仅 vendor_admin。
 * 选定批次 → 输入年月+起始流水号+数量 → 生成 → 三种导出。
 */
export default function LockNumbersPage() {
  const qc = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const today = new Date();
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [startSeq, setStartSeq] = useState('1');
  const [count, setCount] = useState('100');
  const [error, setError] = useState<string | null>(null);

  const batchesQ = useQuery({
    queryKey: ['production-batches', { all: true }],
    queryFn: () =>
      apiRequest<BatchListResp>('/api/v1/production-batches', {
        query: { pageSize: 200 },
      }),
  });

  const listQ = useQuery({
    queryKey: ['lock-numbers', selectedBatchId],
    queryFn: () =>
      apiRequest<LockNumberListResp>(
        `/api/v1/production-batches/${selectedBatchId}/lock-numbers`,
      ),
    enabled: !!selectedBatchId,
  });

  const prefix = useMemo(
    () => `${Number(year) % 10}${String(Number(month)).padStart(2, '0')}`,
    [year, month],
  );

  const generate = useMutation({
    mutationFn: () =>
      apiRequest<{ count: number; firstLockId: string; lastLockId: string }>(
        '/api/v1/lock-numbers/generate',
        {
          method: 'POST',
          body: {
            batchId: Number(selectedBatchId),
            year: Number(year),
            month: Number(month),
            startSeq: Number(startSeq),
            count: Number(count),
          },
        },
      ),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['lock-numbers', selectedBatchId] });
      alert(
        `已生成 ${resp.count} 个锁号\n${resp.firstLockId} ~ ${resp.lastLockId}`,
      );
      // Auto-bump start seq for the next batch
      setStartSeq(String(Number(startSeq) + Number(count)));
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '生成失败'),
  });

  function exportFile(format: 'excel' | 'qr-zip' | 'pdf') {
    if (!selectedBatchId) return;
    const ext = format === 'excel' ? 'xlsx' : format === 'qr-zip' ? 'zip' : 'pdf';
    void downloadFile(
      '/api/v1/lock-numbers/export',
      { batchId: selectedBatchId, format },
      `locknumbers_${selectedBatchId}.${ext}`,
    ).catch((err) => alert(err instanceof Error ? err.message : '导出失败'));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">锁号生成器</h1>
      <p className="text-sm text-slate-500">
        生成锁号后导出 QR 码 / Excel / A4 打印，贴在锁身。注册时 APP 扫码读取。
      </p>

      <Card>
        <CardHeader title="生成新批次" />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                生产批次
              </label>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— 选择批次 —</option>
                {batchesQ.data?.items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNo} · {b.modelName} · 计划 {b.quantity}
                    {b.completedAt ? ' (已关闭)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">年</label>
                <Input
                  className="w-24"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">月</label>
                <Input
                  className="w-16"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="text-xs text-slate-500">
                前缀：<span className="font-mono text-base text-slate-900">{prefix}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">起始流水号</label>
              <Input
                value={startSeq}
                onChange={(e) => setStartSeq(e.target.value)}
                inputMode="numeric"
              />
              <p className="mt-1 font-mono text-xs text-slate-500">
                首个：{prefix}
                {String(Number(startSeq) || 0).padStart(5, '0')}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">数量</label>
              <Input
                value={count}
                onChange={(e) => setCount(e.target.value)}
                inputMode="numeric"
              />
              <p className="mt-1 font-mono text-xs text-slate-500">
                末个：{prefix}
                {String((Number(startSeq) || 0) + (Number(count) || 0) - 1).padStart(5, '0')}
              </p>
            </div>
            <div className="flex items-end">
              <Button
                disabled={!selectedBatchId || !count}
                loading={generate.isPending}
                onClick={() => {
                  setError(null);
                  generate.mutate();
                }}
              >
                生成锁号
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="批次锁号清单"
          description={
            selectedBatchId
              ? `${listQ.data?.batchNo ?? ''} · 共 ${listQ.data?.total ?? '—'} 个`
              : '先在上方选择批次'
          }
          action={
            selectedBatchId && listQ.data && listQ.data.items.length > 0 ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => exportFile('excel')}>
                  <FileSpreadsheet size={14} /> Excel
                </Button>
                <Button variant="secondary" onClick={() => exportFile('qr-zip')}>
                  <QrCode size={14} /> QR ZIP
                </Button>
                <Button variant="secondary" onClick={() => exportFile('pdf')}>
                  <FileText size={14} /> A4 PDF
                </Button>
              </div>
            ) : null
          }
        />
        {!selectedBatchId ? (
          <EmptyState message="请先选择批次" />
        ) : listQ.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !listQ.data?.items.length ? (
          <EmptyState message="该批次还没有生成锁号" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>锁号</Th>
                <Th>状态</Th>
                <Th>生成时间</Th>
                <Th>注册时间</Th>
                <Th>设备</Th>
              </Tr>
            </THead>
            <TBody>
              {listQ.data.items.slice(0, 200).map((it) => (
                <Tr key={it.id}>
                  <Td className="font-mono">{it.lockId}</Td>
                  <Td>
                    <Badge
                      tone={
                        it.status === 'registered'
                          ? 'green'
                          : it.status === 'voided'
                            ? 'red'
                            : 'gray'
                      }
                    >
                      {it.status === 'registered'
                        ? '已注册'
                        : it.status === 'voided'
                          ? '已作废'
                          : '待用'}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {new Date(it.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {it.registeredAt
                      ? new Date(it.registeredAt).toLocaleString('zh-CN')
                      : '—'}
                  </Td>
                  <Td className="text-xs">
                    {it.deviceId ? (
                      <a
                        href={`/devices/${it.deviceId}`}
                        className="text-sky-600 hover:underline"
                      >
                        #{it.deviceId}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {listQ.data && listQ.data.items.length > 200 ? (
          <p className="border-t border-slate-100 px-6 py-2 text-xs text-slate-400">
            仅显示前 200 行。导出 Excel 查看全部。
          </p>
        ) : null}
      </Card>

      <p className="text-xs text-slate-400">
        <Download size={11} className="-mt-0.5 mr-1 inline" />
        导出文件直接由后端流式生成，文件大小取决于锁号数量；QR ZIP 1000 个约 15 MB。
      </p>
    </div>
  );
}
