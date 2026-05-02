'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { useAuth } from '@/providers/AuthProvider';

/**
 * v2.7 P0 #4: per-route role guard.
 *
 * Sidebar already hides off-role links, but a member who pastes a URL
 * (or navigates via browser history) could previously reach any page.
 * This map enforces the same role gates as the sidebar before mounting
 * the page; mismatches bounce to /dashboard with a console hint.
 *
 * Match order: longest prefix wins so /devices/manage > /devices.
 * `null` value = open to every authenticated user.
 */
const ROUTE_ROLES: Record<string, readonly string[] | null> = {
  '/dashboard': null,
  '/notifications': null,
  '/change-password': null,
  '/settings': null,
  '/devices': null, // /devices list is open; /devices/manage tightens below
  '/devices/manage': ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
  '/alarms': null,
  '/warehouses': ['vendor_admin', 'production_operator'],
  '/repairs': ['vendor_admin', 'company_admin', 'production_operator'],
  '/batches': ['vendor_admin', 'production_operator'],
  '/lock-numbers': ['vendor_admin'],
  '/ble-debug': ['vendor_admin', 'production_operator'],
  '/companies': ['vendor_admin'],
  '/users': ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
  '/integrations': ['vendor_admin', 'company_admin'],
  '/firmware': ['vendor_admin', 'company_admin'],
  '/audit-logs': ['vendor_admin', 'company_admin'],
  '/permission-approvals': ['vendor_admin', 'company_admin', 'dept_admin'],
  '/temporary-approvals': [
    'vendor_admin',
    'company_admin',
    'dept_admin',
    'team_leader',
  ],
  '/authorizations': ['vendor_admin', 'company_admin', 'dept_admin', 'team_leader'],
};

function allowedFor(pathname: string, role: string | undefined): boolean {
  if (!role) return false;
  // Find the most-specific (longest) route prefix that matches.
  let best: { len: number; allow: readonly string[] | null } | null = null;
  for (const [prefix, allow] of Object.entries(ROUTE_ROLES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      if (!best || prefix.length > best.len) {
        best = { len: prefix.length, allow };
      }
    }
  }
  if (!best) return true; // unmapped routes default to open
  if (best.allow == null) return true;
  return best.allow.includes(role);
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = useMemo(
    () => (user ? allowedFor(pathname ?? '', user.role) : true),
    [user, pathname],
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
      return;
    }
    if (!allowed) {
      // eslint-disable-next-line no-console
      console.warn(`Route ${pathname} not allowed for role ${user.role}`);
      router.replace('/dashboard');
    }
  }, [loading, user, router, pathname, allowed]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        加载中…
      </main>
    );
  }

  // mustChangePassword: BEFORE the useEffect-driven redirect lands the
  // page would otherwise render for one frame. Hard-block the children
  // so the QA test (and a real human navigating fast) can't get a peek
  // at any other page until the password is changed.
  if (user.mustChangePassword && pathname !== '/change-password') {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        首次登录请修改密码，正在跳转…
      </main>
    );
  }

  // While the route-guard redirect lands, render a placeholder rather
  // than the forbidden page itself.
  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        无权限访问，正在跳转…
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-end border-b border-slate-200 bg-white px-6 py-2">
          <NotificationBell />
        </div>
        <div className="mx-auto max-w-7xl p-6">{children}</div>
      </main>
    </div>
  );
}
