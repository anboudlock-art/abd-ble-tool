'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type AuditLogListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const ACTION_OPTIONS = [
  '',
  'devices',
  'users',
  'companies',
  'batches',
  'production',
  'departments',
  'teams',
  'integrations',
  'auth',
];

function actionTone(a: string): 'gray' | 'red' | 'amber' | 'green' {
  if (a.endsWith('.delete')) return 'red';
  if (a.endsWith('.update')) return 'amber';
  if (a.endsWith('.create') || a.endsWith('.ship') || a.endsWith('.deliver')) return 'green';
  return 'gray';
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const pageSize = 50;

  const q = useQuery({
    queryKey: ['audit-logs', { page, actionFilter }],
    queryFn: () =>
      apiRequest<AuditLogListResp>('/api/v1/audit-logs', {
        query: {
          page,
          pageSize,
          action: actionFilter || undefined,
        },
      }),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">操作日志</h1>
        <div className="text-sm text-slate-500">
          共 <span className="font-semibold text-slate-700">{data?.total ?? '—'}</span> 条
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <Input
            placeholder="按操作前缀过滤（如 devices / users.update）"
            className="w-72"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
          />
          <select
            value=""
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— 选择资源 —</option>
            {ACTION_OPTIONS.filter(Boolean).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            onClick={() => {
              setActionFilter('');
              setPage(1);
            }}
          >
            重置
          </Button>
        </div>

        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无日志" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>时间</Th>
                <Th>操作人</Th>
                <Th>操作</Th>
                <Th>目标</Th>
                <Th>来源 IP</Th>
                <Th>详情</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-xs text-slate-500">
                    {new Date(a.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    {a.actor?.name ? (
                      <span>
                        <span className="font-medium">{a.actor.name}</span>
                        {a.actor.phone ? (
                          <span className="ml-1 font-mono text-xs text-slate-400">
                            {a.actor.phone}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">
                        匿名/系统
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={actionTone(a.action)}>
                      <code className="text-xs">{a.action}</code>
                    </Badge>
                  </Td>
                  <Td className="text-xs">
                    {a.targetType ? `${a.targetType}#${a.targetId ?? '—'}` : '—'}
                  </Td>
                  <Td className="font-mono text-xs text-slate-500">{a.actorIp ?? '—'}</Td>
                  <Td className="max-w-xl">
                    <code className="block max-h-16 truncate font-mono text-xs text-slate-600">
                      {a.diff ? JSON.stringify(a.diff) : '—'}
                    </code>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {data && data.total > pageSize ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
            <span>第 {page} / {totalPages} 页</span>
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
