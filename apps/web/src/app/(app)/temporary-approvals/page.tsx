'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type TemporaryUnlockPendingItem,
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

/**
 * 临开审批 — 单台设备 + 时长（1h/2h/4h/8h），紧急申请置顶。
 * 批准后后端建一条到期自动失效的 user-scoped 授权。
 */
export default function TemporaryApprovalsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['temporary-unlock', 'pending'],
    queryFn: () =>
      apiRequest<{ items: TemporaryUnlockPendingItem[]; total: number }>(
        '/api/v1/temporary-unlock/pending',
      ),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">临开审批</h1>
        <span className="text-sm text-slate-500">
          待办：
          <span className="font-semibold text-amber-600">
            {q.data?.total ?? '—'}
          </span>
        </span>
      </div>

      <Card>
        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !q.data?.items.length ? (
          <EmptyState message="暂无待审批的临开申请" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>申请时间</Th>
                <Th>申请人</Th>
                <Th>设备</Th>
                <Th>时长</Th>
                <Th>事由</Th>
                <Th>紧急</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {q.data.items.map((t) => (
                <Tr
                  key={t.id}
                  className={t.emergency ? 'bg-red-50/50 hover:bg-red-100/50' : undefined}
                >
                  <Td className="text-xs text-slate-500">
                    {new Date(t.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <div className="font-medium">{t.applicant.name}</div>
                    <div className="text-xs text-slate-500">{t.applicant.phone}</div>
                  </Td>
                  <Td>
                    <div className="font-mono text-sm">{t.device.lockId}</div>
                    {t.device.doorLabel ? (
                      <div className="text-xs text-slate-500">{t.device.doorLabel}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone="blue">{t.durationMinutes / 60} 小时</Badge>
                  </Td>
                  <Td className="max-w-xs truncate text-sm" title={t.reason}>
                    {t.reason}
                  </Td>
                  <Td>
                    {t.emergency ? (
                      <Badge tone="red">
                        <AlertCircle size={11} className="-mt-0.5 mr-1 inline" />
                        紧急
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Button variant="secondary" onClick={() => setOpenId(t.id)}>
                      审批
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {openId ? (
        <DecideDialog
          item={q.data?.items.find((i) => i.id === openId)}
          onClose={() => setOpenId(null)}
          onDecided={() => {
            qc.invalidateQueries({ queryKey: ['temporary-unlock', 'pending'] });
            setOpenId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DecideDialog({
  item,
  onClose,
  onDecided,
}: {
  item: TemporaryUnlockPendingItem | undefined;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      apiRequest(`/api/v1/temporary-unlock/${item!.id}/approve`, {
        method: 'POST',
        body: { decision, decisionNote: note || undefined },
      }),
    onSuccess: onDecided,
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '审批失败'),
  });

  if (!item) return null;
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
            {item.emergency ? '🚨 紧急临开审批' : '临开审批'}
          </h3>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <div>
            <div className="text-xs text-slate-500">申请人</div>
            <div className="font-medium">
              {item.applicant.name}{' '}
              <span className="font-mono text-xs text-slate-500">
                {item.applicant.phone}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">设备</div>
            <div className="font-mono">{item.device.lockId}</div>
            {item.device.doorLabel ? (
              <div className="text-xs text-slate-500">{item.device.doorLabel}</div>
            ) : null}
          </div>
          <div>
            <div className="text-xs text-slate-500">时长</div>
            <div className="font-medium">{item.durationMinutes / 60} 小时</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">事由</div>
            <div className="rounded bg-slate-50 px-2 py-1 text-sm">{item.reason}</div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              审批备注（可选）
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="danger"
            loading={decide.isPending && decide.variables === 'reject'}
            onClick={() => decide.mutate('reject')}
          >
            拒绝
          </Button>
          <Button
            loading={decide.isPending && decide.variables === 'approve'}
            onClick={() => decide.mutate('approve')}
          >
            批准
          </Button>
        </div>
      </div>
    </div>
  );
}
