'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiRequest, ApiClientError, type UserListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

const roleLabel: Record<string, string> = {
  vendor_admin: '厂商管理员',
  company_admin: '公司管理员',
  dept_admin: '部门管理员',
  team_leader: '班组长',
  member: '成员',
  production_operator: '生产操作员',
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [resetReveal, setResetReveal] = useState<{ name: string; phone: string; tempPassword: string } | null>(null);
  // v2.8.1 Task 1: edit-user modal state. Holds the row being edited
  // (or null when closed) so the form pre-fills + the mutation knows
  // whose id to PUT.
  const [editing, setEditing] = useState<UserListResp['items'][number] | null>(null);
  const pageSize = 20;

  const canManage = me?.role === 'vendor_admin' || me?.role === 'company_admin';
  const isVendorAdmin = me?.role === 'vendor_admin';

  const q = useQuery({
    queryKey: ['users', { page }],
    queryFn: () => apiRequest<UserListResp>('/api/v1/users', { query: { page, pageSize } }),
  });

  const reset = useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ id: string; tempPassword: string }>(
        `/api/v1/users/${id}/reset-password`,
        { method: 'POST' },
      ),
    onSuccess: (resp, id) => {
      const u = q.data?.items.find((x) => x.id === id);
      if (u) {
        setResetReveal({ name: u.name, phone: u.phone, tempPassword: resp.tempPassword });
      }
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => {
      alert(err instanceof ApiClientError ? err.body.message : '重置失败');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) =>
      alert(err instanceof ApiClientError ? err.body.message : '删除失败'),
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
                {canManage ? <Th></Th> : null}
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
                  {canManage ? (
                    <Td>
                      <div className="flex gap-2">
                        <button
                          title="编辑"
                          onClick={() => setEditing(u)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          title="重置密码"
                          disabled={reset.isPending && reset.variables === u.id}
                          onClick={() => {
                            if (confirm(`重置 ${u.name} 的密码？将生成新的临时密码`)) {
                              reset.mutate(u.id);
                            }
                          }}
                          className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          title="删除"
                          disabled={remove.isPending && remove.variables === u.id}
                          onClick={() => {
                            if (u.id === me?.id) {
                              alert('不能删除自己');
                              return;
                            }
                            if (confirm(`删除用户 ${u.name}？`)) {
                              remove.mutate(u.id);
                            }
                          }}
                          className="text-slate-400 hover:text-red-500 disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  ) : null}
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

      {editing ? (
        <EditUserModal
          user={editing}
          isVendorAdmin={isVendorAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['users'] });
            setEditing(null);
          }}
        />
      ) : null}

      {resetReveal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={() => setResetReveal(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-base font-semibold">密码已重置</h2>
              <button
                onClick={() => setResetReveal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <p className="text-xs text-amber-600">
                ⚠️ 临时密码仅本次显示，请立即告知 {resetReveal.name}（{resetReveal.phone}），用户首次登录后必须修改
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">临时密码</label>
                <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
                  <code className="flex-1 break-all font-mono text-sm">{resetReveal.tempPassword}</code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(resetReveal.tempPassword)}
                    className="text-slate-500 hover:text-slate-900"
                    title="复制"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button onClick={() => setResetReveal(null)}>我已记下</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * v2.8.1 Task 1 — edit user (name / role / status / email).
 * Phone is NOT editable (it's the login id; reissuing it would
 * silently move the account). vendor_admin can pick from all
 * non-platform roles; company_admin can't elevate to vendor_admin
 * or production_operator (server enforces this too).
 */
function EditUserModal({
  user,
  isVendorAdmin,
  onClose,
  onSaved,
}: {
  user: UserListResp['items'][number];
  isVendorAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState<'active' | 'locked'>(
    user.status === 'locked' ? 'locked' : 'active',
  );
  const [error, setError] = useState<string | null>(null);

  const allowedRoles = isVendorAdmin
    ? (['vendor_admin', 'company_admin', 'dept_admin', 'team_leader', 'member', 'production_operator'] as const)
    : (['company_admin', 'dept_admin', 'team_leader', 'member'] as const);

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/users/${user.id}`, {
        method: 'PUT',
        body: {
          name,
          email: email.trim() || null,
          role,
          status,
        },
      }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '保存失败'),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-base font-semibold">编辑用户 · {user.phone}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">姓名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              邮箱 <span className="text-slate-400">(可选)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={128}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r] ?? r}
                </option>
              ))}
            </select>
            {!isVendorAdmin ? (
              <p className="mt-1 text-xs text-slate-400">
                公司管理员不能授予厂商级 / 生产员角色
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'locked')}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="active">正常</option>
              <option value="locked">禁用 (锁定)</option>
            </select>
          </div>
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!name.trim()}
            loading={save.isPending}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
