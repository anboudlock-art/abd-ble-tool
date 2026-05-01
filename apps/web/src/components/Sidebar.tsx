'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Boxes, Building2, ClipboardList, Cpu, KeyRound, LayoutDashboard, Lock, LogOut, Plug, Radio, UsersRound } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/providers/AuthProvider';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Lock;
  roles?: string[];
}

const items: NavItem[] = [
  { href: '/dashboard', label: '概览', icon: LayoutDashboard },
  { href: '/devices', label: '设备', icon: Lock },
  { href: '/alarms', label: '告警', icon: AlertTriangle },
  {
    href: '/batches',
    label: '生产批次',
    icon: Boxes,
    roles: ['vendor_admin', 'production_operator'],
  },
  { href: '/companies', label: '客户公司', icon: Building2, roles: ['vendor_admin'] },
  {
    href: '/users',
    label: '人员',
    icon: UsersRound,
    roles: ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
  },
  {
    href: '/integrations',
    label: '对接 API',
    icon: Plug,
    roles: ['vendor_admin', 'company_admin'],
  },
  {
    href: '/firmware',
    label: '固件 OTA',
    icon: Cpu,
    roles: ['vendor_admin', 'company_admin'],
  },
  {
    href: '/ble-debug',
    label: 'BLE 调试',
    icon: Radio,
    roles: ['vendor_admin', 'production_operator'],
  },
  {
    href: '/audit-logs',
    label: '操作日志',
    icon: ClipboardList,
    roles: ['vendor_admin', 'company_admin'],
  },
];

export function Sidebar() {
  const pathname = usePathname() ?? '';
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5">
        <div className="text-base font-semibold text-slate-900">Anboud</div>
        <div className="text-xs text-slate-500">智能锁管理平台</div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items
          .filter((it) => !it.roles || (user?.role && it.roles.includes(user.role)))
          .map((it) => {
          const active = pathname.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Icon size={16} />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-4">
        <div className="mb-2 truncate text-xs text-slate-600">
          {user?.name ?? ''}
          <span className="ml-1 text-slate-400">({user?.role})</span>
        </div>
        <Link
          href="/change-password"
          className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
        >
          <KeyRound size={14} /> 修改密码
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
        >
          <LogOut size={14} /> 退出
        </button>
      </div>
    </aside>
  );
}
