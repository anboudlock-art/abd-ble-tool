'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type PermissionRequestPendingItem,
} from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

/**
 * PC审批 — 长期开锁权限。审批人逐设备勾选「批准/拒绝」，
 * 提交后后端自动算出整体状态（approved / partial / rejected）。
 */
export default function PermissionApprovalsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['permission-requests', 'pending'],
    queryFn: () =>
      apiRequest<{ items: PermissionRequestPendingItem[]; total: number }>(
        '/api/v1/permission-requests/pending',
      ),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">长期开锁权限审批</h1>
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
          <EmptyState message="暂无待审批的申请" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>申请时间</Th>
                <Th>申请人</Th>
                <Th>设备数</Th>
                <Th>事由</Th>
                <Th>有效期</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {q.data.items.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-xs text-slate-500">
                    {new Date(r.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <div className="font-medium">{r.applicant.name}</div>
                    <div className="text-xs text-slate-500">
                      {r.applicant.phone}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone="blue">{r.devices.length} 台</Badge>
                  </Td>
                  <Td className="max-w-xs truncate text-sm" title={r.reason}>
                    {r.reason}
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {r.validUntil
                      ? `至 ${new Date(r.validUntil).toLocaleDateString('zh-CN')}`
                      : '永久'}
                  </Td>
                  <Td>
                    <Button variant="secondary" onClick={() => setOpenId(r.id)}>
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
        <ApprovalDialog
          requestId={openId}
          onClose={() => setOpenId(null)}
          onDecided={() => {
            qc.invalidateQueries({ queryKey: ['permission-requests', 'pending'] });
            setOpenId(null);
          }}
          item={q.data?.items.find((i) => i.id === openId)}
        />
      ) : null}
    </div>
  );
}

interface DialogProps {
  requestId: string;
  item?: PermissionRequestPendingItem;
  onClose: () => void;
  onDecided: () => void;
}

function ApprovalDialog({ requestId, item, onClose, onDecided }: DialogProps) {
  const [decisions, setDecisions] = useState<Record<string, 'approve' | 'reject'>>(
    () => Object.fromEntries((item?.devices ?? []).map((d) => [d.deviceId, 'approve'])),
  );
  const [note, setNote] = useState('');

  const allApprove = useMemo(
    () => Object.values(decisions).every((d) => d === 'approve'),
    [decisions],
  );
  const allReject = useMemo(
    () => Object.values(decisions).every((d) => d === 'reject'),
    [decisions],
  );

  const submit = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/permission-requests/${requestId}/approve`, {
        method: 'POST',
        body: {
          decisions: Object.entries(decisions).map(([deviceId, decision]) => ({
            deviceId: Number(deviceId),
            decision,
          })),
          decisionNote: note || undefined,
        },
      }),
    onSuccess: onDecided,
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '审批失败'),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold">长期开锁权限申请</h3>
          {item ? (
            <p className="mt-1 text-xs text-slate-500">
              {item.applicant.name} · {item.applicant.phone} · {item.reason}
            </p>
          ) : null}
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex gap-2">
            <Button
              variant={allApprove ? 'primary' : 'secondary'}
              onClick={() =>
                setDecisions((cur) =>
                  Object.fromEntries(
                    Object.keys(cur).map((k) => [k, 'approve' as const]),
                  ),
                )
              }
            >
              全部批准
            </Button>
            <Button
              variant={allReject ? 'danger' : 'secondary'}
              onClick={() =>
                setDecisions((cur) =>
                  Object.fromEntries(
                    Object.keys(cur).map((k) => [k, 'reject' as const]),
                  ),
                )
              }
            >
              全部拒绝
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
            <Table>
              <THead>
                <Tr>
                  <Th>设备</Th>
                  <Th className="w-32">决定</Th>
                </Tr>
              </THead>
              <TBody>
                {item?.devices.map((d) => (
                  <Tr key={d.deviceId}>
                    <Td className="font-mono text-sm">{d.lockId}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <button
                          onClick={() =>
                            setDecisions((c) => ({ ...c, [d.deviceId]: 'approve' }))
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded ${
                            decisions[d.deviceId] === 'approve'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() =>
                            setDecisions((c) => ({ ...c, [d.deviceId]: 'reject' }))
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded ${
                            decisions[d.deviceId] === 'reject'
                              ? 'bg-red-500 text-white'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
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
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>
            提交
          </Button>
        </div>
      </div>
    </div>
  );
}
