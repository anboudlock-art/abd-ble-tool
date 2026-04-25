'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiRequest, type CompanyListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const industryLabel: Record<string, string> = {
  logistics: '物流',
  security: '安防监管',
  other: '其它',
};

export default function CompaniesPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const q = useQuery({
    queryKey: ['companies', { page }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', {
        query: { page, pageSize },
      }),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">客户公司</h1>
        <Link href="/companies/new">
          <Button>
            <Plus size={14} /> 新建公司
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader title="公司列表" description={`共 ${data?.total ?? '—'} 个`} />
        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无公司，请先新建" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>名称</Th>
                <Th>编码</Th>
                <Th>行业</Th>
                <Th>状态</Th>
                <Th>设备数</Th>
                <Th>用户数</Th>
                <Th>联系人</Th>
                <Th>创建时间</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/companies/${c.id}`} className="font-medium text-sky-600 hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs">{c.shortCode ?? '—'}</Td>
                  <Td>{industryLabel[c.industry] ?? c.industry}</Td>
                  <Td>
                    <Badge tone={c.status === 'active' ? 'green' : 'gray'}>
                      {c.status === 'active' ? '正常' : '停用'}
                    </Badge>
                  </Td>
                  <Td>{c.deviceCount}</Td>
                  <Td>{c.userCount}</Td>
                  <Td>
                    {c.contactName ?? '—'}
                    {c.contactPhone ? <span className="ml-2 text-xs text-slate-400">{c.contactPhone}</span> : null}
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {new Date(c.createdAt).toLocaleString('zh-CN')}
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
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </Button>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
