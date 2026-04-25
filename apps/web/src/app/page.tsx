'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/devices' : '/login');
  }, [user, loading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-slate-400">
      正在跳转…
    </main>
  );
}
