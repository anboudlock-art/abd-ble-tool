'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type AuthorizationListResp,
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const STATE_OPTIONS = ['', 'active', 'expiring', 'expired', 'revoked'] as const;
const stateLabel: Record<string, string> = {
  active: '有效',
  expiring: '将过期',
  expired: '已过期',
  revoked: '已撤销',
};
function stateTone(s: string): 'green' | 'amber' | 'gray' | 'red' {
  return s === 'active'
    ? 'green'
    : s === 'expiring'
      ? 'amber'
      : s === 'revoked'
        ? 'red'
        : 'gray';
}

/**
 * 授权管理 (v2.6 §3.6) — 公司全部 device_assignment 行的视图，
 * 按 ✅有效 / ⚠️将过期 / ❌过期 / 已撤销 分类。可撤销有效行。
 */
export default function AuthorizationsPage() {
  const qc = useQueryClient();
  const [state, setState] = useState<string>('active');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const q = useQuery({
    queryKey: ['authorizations', { state, page }],
    queryFn: () =>
      apiRequest<AuthorizationListResp>('/api/v1/authorizations', {
        query: { state: state || undefined, page, pageSize },
      }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/authorizations/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authorizations'] }),
    onError: (e) =>
      alert(e instanceof ApiClientError ? e.body.message : '撤销失败'),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">授权管理</h1>
        <span className="text-sm text-slate-500">
          共 <span className="font-semibold text-slate-700">{data?.total ?? '—'}</span> 条
        </span>
      </div>

      <Card>
        <div className="flex items-center gap-3 px-6 py-3">
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '全部' : stateLabel[s]}
              </option>
            ))}
          </select>
        </div>

        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无授权" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>设备</Th>
                <Th>授权范围</Th>
                <Th>有效期</Th>
                <Th>状态</Th>
                <Th>授予时间</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {data.items.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <a
                      href={`/devices/${a.deviceId}`}
                      className="font-mono text-sky-600 hover:underline"
                    >
                      {a.lockId}
                    </a>
                    {a.doorLabel ? (
                      <div className="text-xs text-slate-500">{a.doorLabel}</div>
                    ) : null}
                  </Td>
                  <Td>
                    {a.scope === 'user' && a.userName ? (
                      <div>
                        <div className="font-medium">{a.userName}</div>
                        <div className="font-mono text-xs text-slate-500">
                          {a.userPhone}
                        </div>
                        {a.teamName ? (
                          <div className="text-xs text-slate-400">@ {a.teamName}</div>
                        ) : null}
                      </div>
                    ) : a.teamName ? (
                      <span>整个班组：{a.teamName}</span>
                    ) : (
                      <span className="text-slate-400">公司级</span>
                    )}
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {a.validUntil
                      ? new Date(a.validUntil).toLocaleString('zh-CN')
                      : '永久'}
                  </Td>
                  <Td>
                    <Badge tone={stateTone(a.state)}>
                      {stateLabel[a.state] ?? a.state}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {new Date(a.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    {a.state !== 'revoked' && a.state !== 'expired' ? (
                      <button
                        title="撤销"
                        onClick={() => {
                          if (confirm(`撤销 ${a.lockId} 的授权？`))
                            revoke.mutate(a.id);
                        }}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
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
    </div>
  );
}
