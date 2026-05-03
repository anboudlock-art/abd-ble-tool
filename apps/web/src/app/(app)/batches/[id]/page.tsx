'use client';

import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock as LockIcon, Unlock } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type ProductionBatch,
  type ProductionScan,
} from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const qc = useQueryClient();
  const isVendor = user?.role === 'vendor_admin';

  const batchQ = useQuery({
    queryKey: ['batch', id],
    queryFn: () => apiRequest<ProductionBatch>(`/api/v1/production/batches/${id}`),
  });

  const complete = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/production/batches/${id}/complete`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['batch', id] }),
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '操作失败'),
  });

  const reopen = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/production/batches/${id}/reopen`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['batch', id] }),
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '操作失败'),
  });

  const scansQ = useQuery({
    queryKey: ['batch', id, 'scans'],
    queryFn: () =>
      apiRequest<{ items: ProductionScan[] }>(
        `/api/v1/production/batches/${id}/scans`,
      ),
    refetchInterval: 5_000, // poll while production line is active
  });

  if (batchQ.isLoading) return <div className="text-sm text-slate-400">加载中…</div>;
  if (batchQ.isError || !batchQ.data) {
    return (
      <div className="text-sm text-red-500">
        加载失败：{(batchQ.error as Error)?.message}
      </div>
    );
  }
  const b = batchQ.data;
  const pct = b.quantity > 0 ? Math.round((b.producedCount / b.quantity) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link
        href="/batches"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={14} /> 返回批次列表
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold text-slate-900">{b.batchNo}</h1>
            {b.completedAt ? (
              <Badge tone="gray">已完结</Badge>
            ) : (
              <Badge tone="green">进行中</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {b.modelCode} · {b.modelName}
            {b.completedAt ? (
              <span className="ml-2">
                · 完结于 {new Date(b.completedAt).toLocaleString('zh-CN')}
              </span>
            ) : null}
          </p>
        </div>
        {isVendor ? (
          <div>
            {b.completedAt ? (
              <Button
                variant="secondary"
                loading={reopen.isPending}
                onClick={() => {
                  if (confirm(`重新开放批次 ${b.batchNo}？`)) reopen.mutate();
                }}
              >
                <Unlock size={14} /> 重新开放
              </Button>
            ) : (
              <Button
                loading={complete.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `完结批次 ${b.batchNo}？完结后将无法继续添加扫码记录`,
                    )
                  ) {
                    complete.mutate();
                  }
                }}
              >
                <LockIcon size={14} /> 完结批次
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="计划数量" value={b.quantity} />
        <Stat label="已采集" value={b.producedCount} />
        <Stat label="扫描次数" value={b.scannedCount} />
        <Stat label="进度" value={`${pct}%`} />
      </div>

      <Card>
        <CardHeader
          title="采集记录"
          description="生产线 APP 实时上报，自动每 5 秒刷新"
        />
        {scansQ.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !scansQ.data?.items.length ? (
          <EmptyState message="暂无采集记录" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>时间</Th>
                <Th>锁号 (QR)</Th>
                <Th>BLE MAC</Th>
                <Th>IMEI</Th>
                <Th>固件</Th>
                <Th>质检</Th>
                <Th>耗时</Th>
              </Tr>
            </THead>
            <TBody>
              {scansQ.data.items.map((s) => (
                <Tr key={s.id}>
                  <Td className="text-xs text-slate-500">
                    {new Date(s.scannedAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    {s.deviceId ? (
                      <Link
                        href={`/devices/${s.deviceId}`}
                        className="font-mono text-sky-600 hover:underline"
                      >
                        {s.qrScanned}
                      </Link>
                    ) : (
                      <span className="font-mono">{s.qrScanned}</span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{s.bleMacRead ?? '—'}</Td>
                  <Td className="font-mono text-xs">{s.imeiRead ?? '—'}</Td>
                  <Td className="text-xs">{s.firmwareVersionRead ?? '—'}</Td>
                  <Td>
                    <Badge tone={s.qcResult === 'passed' ? 'green' : 'red'}>
                      {s.qcResult}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {s.durationMs ? `${s.durationMs} ms` : '—'}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      </CardBody>
    </Card>
  );
}
