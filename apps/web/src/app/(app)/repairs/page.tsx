'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Wrench, XCircle } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type DeviceRepairListItem,
  type DeviceRepairListResp,
} from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const STATUS_OPTIONS = ['', 'intake', 'diagnosing', 'awaiting_parts', 'repairing', 'repaired', 'irreparable', 'returned'] as const;

const statusLabel: Record<string, string> = {
  intake: '已收件',
  diagnosing: '诊断中',
  awaiting_parts: '等配件',
  repairing: '维修中',
  repaired: '已修好',
  irreparable: '不可修',
  returned: '已出库',
};

function statusTone(s: string): 'gray' | 'amber' | 'green' | 'red' | 'blue' {
  switch (s) {
    case 'repaired':
      return 'green';
    case 'irreparable':
      return 'red';
    case 'returned':
      return 'gray';
    case 'awaiting_parts':
      return 'blue';
    default:
      return 'amber';
  }
}

/**
 * 维修中库 — 设备退修后的工单。可改状态、关闭并把设备恢复到入修前的状态。
 * 入修动作在设备详情页发起。
 */
export default function RepairsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('');
  const [openItem, setOpenItem] = useState<DeviceRepairListItem | null>(null);
  const pageSize = 30;

  const q = useQuery({
    queryKey: ['repairs', { page, status }],
    queryFn: () =>
      apiRequest<DeviceRepairListResp>('/api/v1/repairs', {
        query: { page, pageSize, status: status || undefined },
      }),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">维修中库</h1>
        <span className="text-sm text-slate-500">
          共 <span className="font-semibold text-slate-700">{data?.total ?? '—'}</span> 单
        </span>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '全部状态' : statusLabel[s]}
              </option>
            ))}
          </select>
        </div>

        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无维修单" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>入修时间</Th>
                <Th>设备</Th>
                <Th>来源公司</Th>
                <Th>故障</Th>
                <Th>状态</Th>
                <Th>入修前状态</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {data.items.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-xs text-slate-500">
                    {new Date(r.intakeAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <a
                      href={`/devices/${r.device.id}`}
                      className="font-mono text-sky-600 hover:underline"
                    >
                      {r.device.lockId}
                    </a>
                  </Td>
                  <Td className="text-sm">{r.sourceCompanyName ?? '—'}</Td>
                  <Td className="max-w-xs truncate text-sm" title={r.faultReason}>
                    {r.faultReason}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>
                      {statusLabel[r.status] ?? r.status}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">{r.priorStatus}</Td>
                  <Td>
                    {!r.closedAt ? (
                      <Button variant="secondary" onClick={() => setOpenItem(r)}>
                        处理
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">已关闭</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {data && data.total > pageSize ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {openItem ? (
        <RepairDialog
          item={openItem}
          onClose={() => setOpenItem(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['repairs'] });
            setOpenItem(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RepairDialog({
  item,
  onClose,
  onChanged,
}: {
  item: DeviceRepairListItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (status: 'diagnosing' | 'repairing' | 'awaiting_parts' | 'repaired' | 'irreparable') =>
      apiRequest(`/api/v1/repairs/${item.id}/update-status`, {
        method: 'POST',
        body: { status, notes: notes || undefined },
      }),
    onSuccess: onChanged,
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '更新失败'),
  });

  const close = useMutation({
    mutationFn: (resolution: 'restore' | 'retire') =>
      apiRequest(`/api/v1/repairs/${item.id}/close`, {
        method: 'POST',
        body: { resolution, notes: notes || undefined },
      }),
    onSuccess: onChanged,
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '关闭失败'),
  });

  const isTerminal = item.status === 'repaired' || item.status === 'irreparable';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold">
            维修单 #{item.id} · 锁号 {item.device.lockId}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{item.faultReason}</p>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">当前状态</span>
            <Badge tone={statusTone(item.status)}>
              {statusLabel[item.status] ?? item.status}
            </Badge>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              备注（可选）
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="例如：电池虚焊，已更换 3.7V 1200mAh"
            />
          </div>

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          {!isTerminal ? (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">推进状态</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={update.isPending && update.variables === 'diagnosing'}
                  onClick={() => update.mutate('diagnosing')}
                >
                  诊断中
                </Button>
                <Button
                  variant="secondary"
                  loading={update.isPending && update.variables === 'awaiting_parts'}
                  onClick={() => update.mutate('awaiting_parts')}
                >
                  等配件
                </Button>
                <Button
                  variant="secondary"
                  loading={update.isPending && update.variables === 'repairing'}
                  onClick={() => update.mutate('repairing')}
                >
                  正在修
                </Button>
                <Button
                  loading={update.isPending && update.variables === 'repaired'}
                  onClick={() => update.mutate('repaired')}
                >
                  <CheckCircle2 size={14} /> 已修好
                </Button>
                <Button
                  variant="danger"
                  loading={update.isPending && update.variables === 'irreparable'}
                  onClick={() => update.mutate('irreparable')}
                >
                  <XCircle size={14} /> 不可修
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">关闭维修单</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  loading={close.isPending && close.variables === 'restore'}
                  onClick={() => close.mutate('restore')}
                >
                  <Wrench size={14} /> 恢复到入修前状态（{item.priorStatus}）
                </Button>
                <Button
                  variant="danger"
                  loading={close.isPending && close.variables === 'retire'}
                  onClick={() => {
                    if (confirm('确定报废这台设备？操作不可逆。')) close.mutate('retire');
                  }}
                >
                  报废
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
