'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, Building2, Lock, LogOut, UsersRound } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/providers/AuthProvider';

const items = [
  { href: '/devices', label: '设备', icon: Lock },
  { href: '/batches', label: '生产批次', icon: Boxes },
  { href: '/companies', label: '客户公司', icon: Building2 },
  { href: '/users', label: '人员', icon: UsersRound },
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
        {items.map((it) => {
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
