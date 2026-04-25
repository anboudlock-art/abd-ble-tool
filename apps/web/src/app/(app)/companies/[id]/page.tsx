'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Users } from 'lucide-react';
import { apiRequest, ApiClientError, type CompanyDetail, type UserListResp } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [showTeamFormForDept, setShowTeamFormForDept] = useState<string | null>(null);

  const companyQ = useQuery({
    queryKey: ['company', id],
    queryFn: () => apiRequest<CompanyDetail>(`/api/v1/companies/${id}`),
  });

  const usersQ = useQuery({
    queryKey: ['users', { companyId: id }],
    queryFn: () =>
      apiRequest<UserListResp>('/api/v1/users', {
        query: { companyId: id, pageSize: 200 },
      }),
  });

  const createDept = useMutation({
    mutationFn: (input: { name: string; code?: string }) =>
      apiRequest('/api/v1/departments', {
        method: 'POST',
        body: { ...input, companyId: Number(id) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company', id] });
      setShowDeptForm(false);
    },
  });

  const createTeam = useMutation({
    mutationFn: (input: { departmentId: string; name: string }) =>
      apiRequest('/api/v1/teams', {
        method: 'POST',
        body: { departmentId: Number(input.departmentId), name: input.name },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company', id] });
      setShowTeamFormForDept(null);
    },
  });

  if (companyQ.isLoading) return <div className="text-sm text-slate-400">加载中…</div>;
  if (companyQ.isError || !companyQ.data) {
    return <div className="text-sm text-red-500">加载失败</div>;
  }
  const c = companyQ.data;

  return (
    <div className="space-y-6">
      <Link href="/companies" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft size={14} /> 返回公司列表
      </Link>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{c.name}</h1>
          <p className="mt-1 text-xs text-slate-500">
            <span className="font-mono">{c.shortCode ?? ''}</span> · 设备 {c.deviceCount} · 用户{' '}
            {c.userCount}
          </p>
        </div>
        <Link href={`/users/new?companyId=${id}`}>
          <Button variant="secondary">
            <Plus size={14} /> 添加用户
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader
          title="组织架构"
          description="公司 → 部门 → 班组"
          action={
            <Button variant="secondary" onClick={() => setShowDeptForm((v) => !v)}>
              <Plus size={14} /> 新建部门
            </Button>
          }
        />

        {showDeptForm ? (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
            <DeptForm
              loading={createDept.isPending}
              onCancel={() => setShowDeptForm(false)}
              onSubmit={(d) => createDept.mutate(d)}
            />
            {createDept.error ? (
              <p className="mt-2 text-xs text-red-500">
                {createDept.error instanceof ApiClientError
                  ? createDept.error.body.message
                  : '创建失败'}
              </p>
            ) : null}
          </div>
        ) : null}

        {!c.departments.length ? (
          <EmptyState message="暂无部门" />
        ) : (
          <CardBody className="space-y-4 p-6">
            {c.departments.map((d) => (
              <div key={d.id} className="rounded-md border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <div>
                    <span className="text-sm font-semibold text-slate-900">{d.name}</span>
                    {d.code ? (
                      <span className="ml-2 font-mono text-xs text-slate-400">{d.code}</span>
                    ) : null}
                    <span className="ml-3 text-xs text-slate-500">
                      {d.teams.length} 个班组
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setShowTeamFormForDept((v) => (v === d.id ? null : d.id))}
                  >
                    <Plus size={14} /> 班组
                  </Button>
                </div>

                {showTeamFormForDept === d.id ? (
                  <div className="border-b border-slate-100 px-4 py-3">
                    <TeamForm
                      loading={createTeam.isPending}
                      onCancel={() => setShowTeamFormForDept(null)}
                      onSubmit={(name) =>
                        createTeam.mutate({ departmentId: d.id, name })
                      }
                    />
                  </div>
                ) : null}

                {!d.teams.length ? (
                  <div className="px-4 py-3 text-xs text-slate-400">暂无班组</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {d.teams.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between px-4 py-2.5 text-sm"
                      >
                        <div>
                          <span className="font-medium">{t.name}</span>
                          <span className="ml-3 inline-flex items-center gap-1 text-xs text-slate-500">
                            <Users size={12} /> {t.memberCount} 人
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="人员" description={`${usersQ.data?.total ?? 0} 个`} />
        {!usersQ.data?.items.length ? (
          <EmptyState message="暂无人员" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>姓名</Th>
                <Th>手机号</Th>
                <Th>角色</Th>
                <Th>所在班组</Th>
                <Th>状态</Th>
                <Th>最近登录</Th>
              </Tr>
            </THead>
            <TBody>
              {usersQ.data.items.map((u) => (
                <Tr key={u.id}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="font-mono text-xs">{u.phone}</Td>
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
      </Card>
    </div>
  );
}

const roleLabel: Record<string, string> = {
  vendor_admin: '厂商管理员',
  company_admin: '公司管理员',
  dept_admin: '部门管理员',
  team_leader: '班组长',
  member: '成员',
  production_operator: '生产操作员',
};

function DeptForm({
  loading,
  onSubmit,
  onCancel,
}: {
  loading: boolean;
  onSubmit: (d: { name: string; code?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit({ name: name.trim(), code: code.trim() || undefined });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div>
        <label className="block text-xs font-medium text-slate-700">部门名称</label>
        <Input
          className="w-56"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：运维部"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700">编码（选填）</label>
        <Input className="w-32" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <Button type="submit" loading={loading}>
        创建
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        取消
      </Button>
    </form>
  );
}

function TeamForm({
  loading,
  onSubmit,
  onCancel,
}: {
  loading: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
      className="flex items-end gap-3"
    >
      <div>
        <label className="block text-xs font-medium text-slate-700">班组名称</label>
        <Input
          className="w-56"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：一组"
        />
      </div>
      <Button type="submit" loading={loading}>
        创建
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        取消
      </Button>
    </form>
  );
}
