'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { apiRequest, type NotificationListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const kindLabel: Record<string, string> = {
  alarm: '告警',
  ship: '发货',
  deliver: '签收',
  assign: '分配',
  remote_command: '远程指令',
  system: '系统',
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const pageSize = 30;

  const q = useQuery({
    queryKey: ['notifications', { page, unreadOnly }],
    queryFn: () =>
      apiRequest<NotificationListResp>('/api/v1/notifications', {
        query: { page, pageSize, unreadOnly: unreadOnly ? 'true' : 'false' },
      }),
    refetchInterval: 30_000,
  });

  const markOne = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () =>
      apiRequest('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">通知</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">
            未读：<span className="font-semibold text-red-600">{data?.unreadCount ?? '—'}</span>
          </span>
          <Button
            variant="secondary"
            disabled={(data?.unreadCount ?? 0) === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck size={14} /> 全部标已读
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="收件箱"
          action={
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => {
                  setUnreadOnly(e.target.checked);
                  setPage(1);
                }}
              />
              仅看未读
            </label>
          }
        />

        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无通知" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>时间</Th>
                <Th>类型</Th>
                <Th>标题</Th>
                <Th>详情</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((n) => (
                <Tr key={n.id} className={n.readAt ? 'opacity-60' : ''}>
                  <Td className="text-xs text-slate-500">
                    {new Date(n.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <Badge tone={n.kind === 'alarm' ? 'red' : 'gray'}>
                      {kindLabel[n.kind] ?? n.kind}
                    </Badge>
                  </Td>
                  <Td className="font-medium">
                    {n.link ? (
                      <Link
                        href={n.link}
                        className="text-sky-600 hover:underline"
                        onClick={() => !n.readAt && markOne.mutate(n.id)}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </Td>
                  <Td className="text-sm text-slate-600">{n.body}</Td>
                  <Td>
                    {!n.readAt ? (
                      <button
                        onClick={() => markOne.mutate(n.id)}
                        className="text-xs text-slate-500 hover:text-sky-600"
                      >
                        标已读
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">已读</span>
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
    </div>
  );
}
