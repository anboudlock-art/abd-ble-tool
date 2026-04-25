'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiRequest, type BatchListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';

export default function BatchesPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const q = useQuery({
    queryKey: ['batches', { page }],
    queryFn: () =>
      apiRequest<BatchListResp>('/api/v1/production/batches', {
        query: { page, pageSize },
      }),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">生产批次</h1>
        <Link href="/batches/new">
          <Button>
            <Plus size={14} /> 新建批次
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader title="批次列表" description={`共 ${data?.total ?? '—'} 个批次`} />
        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : q.isError ? (
          <div className="px-6 py-8 text-sm text-red-500">
            加载失败：{(q.error as Error).message}
          </div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无批次，请先新建" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>批号</Th>
                <Th>型号</Th>
                <Th>计划数量</Th>
                <Th>已采集</Th>
                <Th>进度</Th>
                <Th>创建时间</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((b) => {
                const pct =
                  b.quantity > 0
                    ? Math.min(100, Math.round((b.producedCount / b.quantity) * 100))
                    : 0;
                return (
                  <Tr key={b.id}>
                    <Td>
                      <Link
                        href={`/batches/${b.id}`}
                        className="font-mono text-sky-600 hover:underline"
                      >
                        {b.batchNo}
                      </Link>
                    </Td>
                    <Td>
                      {b.modelCode ?? '—'}
                      {b.modelName ? (
                        <span className="ml-1 text-xs text-slate-400">{b.modelName}</span>
                      ) : null}
                    </Td>
                    <Td>{b.quantity}</Td>
                    <Td>{b.producedCount}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{pct}%</span>
                      </div>
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {new Date(b.createdAt).toLocaleString('zh-CN')}
                    </Td>
                  </Tr>
                );
              })}
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
