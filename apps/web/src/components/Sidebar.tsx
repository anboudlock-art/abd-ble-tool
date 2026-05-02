'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, viewAsStorage, type CompanyListResp } from '@/lib/api';
import {
  AlertTriangle,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Cpu,
  Factory,
  Hash,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Plug,
  Radio,
  ShieldCheck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/providers/AuthProvider';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Lock;
  roles?: string[];
}

interface NavGroup {
  /** null = ungrouped, rendered as a single item (e.g. 概览) */
  groupId: string | null;
  groupLabel?: string;
  groupRoles?: string[];
  collapsible?: boolean;
  defaultOpen?: boolean;
  items: NavItem[];
}

/**
 * Sidebar v2.7 (task 1) — 4 functional groups + 概览 root.
 * Roles per item come from CLAUDE_TASKS_V27.md §1; group-level `roles`
 * is the union (so a group hides if every item is hidden).
 */
const groups: NavGroup[] = [
  {
    groupId: null,
    items: [{ href: '/dashboard', label: '概览', icon: LayoutDashboard }],
  },
  {
    groupId: 'vendor',
    groupLabel: '🏭 厂商功能',
    groupRoles: ['vendor_admin', 'production_operator'],
    items: [
      {
        href: '/warehouses',
        label: '三库总览',
        icon: Factory,
        roles: ['vendor_admin', 'production_operator'],
      },
      {
        href: '/repairs',
        label: '维修中库',
        icon: Wrench,
        roles: ['vendor_admin', 'company_admin', 'production_operator'],
      },
    ],
  },
  {
    groupId: 'production',
    groupLabel: '📦 生产环节',
    groupRoles: ['vendor_admin', 'production_operator'],
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        href: '/batches',
        label: '生产批次',
        icon: Boxes,
        roles: ['vendor_admin', 'production_operator'],
      },
      { href: '/lock-numbers', label: '锁号生成', icon: Hash, roles: ['vendor_admin'] },
      {
        href: '/ble-debug',
        label: 'BLE 调试',
        icon: Radio,
        roles: ['vendor_admin', 'production_operator'],
      },
    ],
  },
  {
    groupId: 'ops',
    groupLabel: '🔧 运维功能',
    items: [
      {
        href: '/devices',
        label: '设备',
        icon: Lock,
        roles: ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader', 'member'],
      },
      {
        href: '/devices/manage',
        label: '设备管理',
        icon: UsersRound,
        roles: ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
      },
      {
        href: '/authorizations',
        label: '授权管理',
        icon: ListChecks,
        roles: ['vendor_admin', 'company_admin', 'dept_admin'],
      },
      {
        href: '/permission-approvals',
        label: '权限审批',
        icon: ShieldCheck,
        roles: ['vendor_admin', 'company_admin', 'dept_admin'],
      },
      {
        href: '/temporary-approvals',
        label: '临开审批',
        icon: Clock3,
        roles: ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
      },
      {
        href: '/alarms',
        label: '告警',
        icon: AlertTriangle,
        roles: ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader', 'member'],
      },
    ],
  },
  {
    groupId: 'admin',
    groupLabel: '⚙️ 管理设置',
    groupRoles: ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        href: '/companies',
        label: '客户公司',
        icon: Building2,
        roles: ['vendor_admin'],
      },
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
        href: '/audit-logs',
        label: '操作日志',
        icon: ClipboardList,
        roles: ['vendor_admin', 'company_admin'],
      },
    ],
  },
];

function visibleItems(items: NavItem[], role: string | undefined): NavItem[] {
  if (!role) return [];
  return items.filter((it) => !it.roles || it.roles.includes(role));
}

export function Sidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const isVendor = user?.role === 'vendor_admin';
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups
        .filter((g) => g.collapsible)
        .map((g) => [g.groupId!, g.defaultOpen ?? false]),
    ),
  );

  // Vendor view-as-company state. Mirrored from localStorage so it
  // survives reloads and stays in sync across components.
  const [viewAs, setViewAs] = useState<string>(() => viewAsStorage.get() ?? '');
  useEffect(() => {
    const sync = () => setViewAs(viewAsStorage.get() ?? '');
    window.addEventListener('abd:view-as-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('abd:view-as-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const companiesQ = useQuery({
    queryKey: ['companies', { sidebar: true }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', { query: { pageSize: 200 } }),
    enabled: isVendor,
  });

  function applyViewAs(next: string) {
    setViewAs(next);
    viewAsStorage.set(next || null);
    // Every server-side query depends on which company we're scoped to;
    // wipe the cache so nothing stale leaks across the swap.
    qc.invalidateQueries();
    router.refresh();
  }

  // When viewing as a company, pretend to be company_admin so the sidebar
  // hides厂商-only sections (锁号生成 / 客户公司 / 三库总览 …).
  const effectiveRole = isVendor && viewAs ? 'company_admin' : user?.role;

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5">
        <div className="text-base font-semibold text-slate-900">Anboud</div>
        <div className="text-xs text-slate-500">智能锁管理平台</div>
      </div>

      {isVendor && (companiesQ.data?.items.length ?? 0) > 0 ? (
        <div className="px-3 pb-2">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
            视角
          </label>
          <select
            value={viewAs}
            onChange={(e) => applyViewAs(e.target.value)}
            className="block w-full truncate rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          >
            <option value="">🏭 厂商总览</option>
            {companiesQ.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                👁 {c.name}
              </option>
            ))}
          </select>
          {viewAs ? (
            <button
              onClick={() => applyViewAs('')}
              className="mt-1 w-full text-left text-[10px] text-amber-600 hover:underline"
            >
              退出客户视角
            </button>
          ) : null}
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {groups.map((g) => {
          const items = visibleItems(g.items, effectiveRole);
          if (items.length === 0) return null;

          // Ungrouped (e.g. 概览)
          if (g.groupId == null) {
            return (
              <div key="root" className="space-y-1">
                {items.map((it) => renderItem(it, pathname))}
              </div>
            );
          }

          const open = g.collapsible ? !!openGroups[g.groupId] : true;
          return (
            <div key={g.groupId} className="mt-3">
              {g.collapsible ? (
                <button
                  onClick={() =>
                    setOpenGroups((s) => ({ ...s, [g.groupId!]: !open }))
                  }
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-xs font-medium uppercase tracking-wider text-slate-500 hover:bg-slate-50"
                >
                  <span>{g.groupLabel}</span>
                  <ChevronDown
                    size={12}
                    className={clsx(
                      'transition-transform',
                      open ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>
              ) : (
                <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                  {g.groupLabel}
                </div>
              )}
              {open ? (
                <div className="mt-1 space-y-0.5">
                  {items.map((it) => renderItem(it, pathname))}
                </div>
              ) : null}
            </div>
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

function renderItem(it: NavItem, pathname: string) {
  const Icon = it.icon;
  // Use exact match for /devices vs /devices/manage to avoid both
  // highlighting at once.
  const active = pathname === it.href || pathname.startsWith(it.href + '/');
  return (
    <Link
      key={it.href}
      href={it.href}
      className={clsx(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      <Icon size={16} />
      <span>{it.label}</span>
    </Link>
  );
}
