'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { useAuth } from '@/providers/AuthProvider';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        加载中…
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
