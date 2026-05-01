'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest, ApiClientError, type BatchListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';

export default function BatchesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const q = useQuery({
    queryKey: ['batches', { page }],
    queryFn: () =>
      apiRequest<BatchListResp>('/api/v1/production/batches', {
        query: { page, pageSize },
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/production/batches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['batches'] }),
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '删除失败'),
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
                <Th></Th>
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
                      {b.completedAt ? (
                        <span className="ml-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                          已完结
                        </span>
                      ) : null}
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
                    <Td>
                      <button
                        onClick={() => {
                          if (b.producedCount > 0) {
                            alert('该批次已有设备入库，无法删除');
                            return;
                          }
                          if (confirm(`删除批次 ${b.batchNo}？`)) {
                            remove.mutate(b.id);
                          }
                        }}
                        className="text-slate-400 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
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
