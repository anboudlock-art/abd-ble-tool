'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface MeResp {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  mustChangePassword: boolean;
  companyId: string | null;
  companyName: string | null;
  companyShortCode: string | null;
  teams: Array<{
    id: string;
    name: string;
    roleInTeam: string;
    departmentId: string | null;
    departmentName: string | null;
  }>;
}

const roleLabel: Record<string, string> = {
  vendor_admin: '厂商管理员',
  company_admin: '公司管理员',
  dept_admin: '部门管理员',
  team_leader: '班组长',
  member: '成员',
  production_operator: '生产操作员',
};

/**
 * v2.7 P0: minimal /settings page. Shows the caller's profile (name,
 * phone, role, company, dept/team memberships) and links to the
 * change-password flow. The user/role/team data already comes from
 * /users/me — no new API.
 */
export default function SettingsPage() {
  const { logout } = useAuth();
  const meQ = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => apiRequest<MeResp>('/api/v1/users/me'),
  });

  const me = meQ.data;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">设置</h1>

      {meQ.isLoading ? (
        <div className="text-sm text-slate-400">加载中…</div>
      ) : !me ? (
        <div className="text-sm text-red-500">无法加载用户信息</div>
      ) : (
        <>
          <Card className="max-w-2xl">
            <CardHeader title="个人资料" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <Item label="姓名">{me.name}</Item>
                <Item label="角色">
                  <Badge tone="blue">{roleLabel[me.role] ?? me.role}</Badge>
                </Item>
                <Item label="手机号">
                  <span className="font-mono">{me.phone}</span>
                </Item>
                <Item label="邮箱">{me.email ?? '—'}</Item>
                <Item label="所属公司">
                  {me.companyName ?? <span className="text-slate-400">未绑定</span>}
                </Item>
                <Item label="账户状态">
                  <Badge tone={me.status === 'active' ? 'green' : 'amber'}>
                    {me.status === 'active' ? '正常' : me.status}
                  </Badge>
                </Item>
              </dl>

              {me.teams.length > 0 ? (
                <div className="mt-6">
                  <div className="mb-2 text-xs font-medium text-slate-500">
                    所在班组
                  </div>
                  <ul className="space-y-1 text-sm">
                    {me.teams.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
                      >
                        <div>
                          <span className="font-medium">{t.name}</span>
                          {t.departmentName ? (
                            <span className="ml-2 text-xs text-slate-500">
                              @ {t.departmentName}
                            </span>
                          ) : null}
                        </div>
                        {t.roleInTeam === 'leader' ? (
                          <Badge tone="amber">组长</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card className="max-w-2xl">
            <CardHeader
              title="安全"
              description={
                me.mustChangePassword
                  ? '⚠ 系统标记你需要修改初始密码'
                  : '建议每 3 个月修改一次密码'
              }
            />
            <CardBody>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <ShieldCheck size={16} />
                  登录密码
                </div>
                <Link href="/change-password">
                  <Button variant="secondary">
                    <KeyRound size={14} /> 修改密码
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>

          <Card className="max-w-2xl">
            <CardHeader title="退出" />
            <CardBody>
              <Button variant="danger" onClick={logout}>
                <LogOut size={14} /> 退出登录
              </Button>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children}</dd>
    </div>
  );
}
