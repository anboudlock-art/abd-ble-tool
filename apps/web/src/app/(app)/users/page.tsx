'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { apiRequest, type UserListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const roleLabel: Record<string, string> = {
  vendor_admin: '厂商管理员',
  company_admin: '公司管理员',
  dept_admin: '部门管理员',
  team_leader: '班组长',
  member: '成员',
  production_operator: '生产操作员',
};

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const q = useQuery({
    queryKey: ['users', { page }],
    queryFn: () => apiRequest<UserListResp>('/api/v1/users', { query: { page, pageSize } }),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">人员</h1>
        <Link href="/users/new">
          <Button>
            <Plus size={14} /> 新建用户
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader title="人员列表" description={`共 ${data?.total ?? '—'} 人`} />
        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无人员" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>姓名</Th>
                <Th>手机号</Th>
                <Th>所属公司</Th>
                <Th>角色</Th>
                <Th>班组</Th>
                <Th>状态</Th>
                <Th>最近登录</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((u) => (
                <Tr key={u.id}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="font-mono text-xs">{u.phone}</Td>
                  <Td>{u.companyName ?? '厂商'}</Td>
                  <Td>
                    <Badge tone="blue">{roleLabel[u.role] ?? u.role}</Badge>
                  </Td>
                  <Td>{u.teams.map((t) => t.name).join(', ') || '—'}</Td>
                  <Td>
                    <Badge tone={u.status === 'active' ? 'green' : 'amber'}>
                      {u.status === 'active' ? '正常' : u.status === 'invited' ? '待激活' : u.status}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '—'}
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
