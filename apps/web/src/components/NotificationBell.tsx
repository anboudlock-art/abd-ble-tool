'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { apiRequest, type NotificationListResp } from '@/lib/api';

const POLL_MS = 30_000;

const kindLabel: Record<string, string> = {
  alarm: '告警',
  ship: '发货',
  deliver: '签收',
  assign: '分配',
  remote_command: '远程指令',
  system: '系统',
};

export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const q = useQuery({
    queryKey: ['notifications', { page: 1 }],
    queryFn: () =>
      apiRequest<NotificationListResp>('/api/v1/notifications', {
        query: { pageSize: 10 },
      }),
    refetchInterval: POLL_MS,
  });

  const markOne = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () =>
      apiRequest('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unreadCount = q.data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
        title="通知"
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-9 z-40 w-80 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">通知</span>
            <button
              disabled={unreadCount === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30"
            >
              <CheckCheck size={12} /> 全部已读
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {q.isLoading ? (
              <div className="px-4 py-6 text-sm text-slate-400">加载中…</div>
            ) : !q.data?.items.length ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                暂无通知
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {q.data.items.map((n) => (
                  <li
                    key={n.id}
                    className={`group px-3 py-2 ${n.readAt ? 'opacity-60' : 'bg-sky-50/40'}`}
                  >
                    <NotificationContent
                      n={n}
                      onClickThrough={() => {
                        if (!n.readAt) markOne.mutate(n.id);
                        setOpen(false);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {q.data?.total ? (
            <div className="border-t border-slate-100 px-3 py-2 text-right">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-sky-600 hover:underline"
              >
                查看全部 →
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NotificationContent({
  n,
  onClickThrough,
}: {
  n: NotificationListResp['items'][number];
  onClickThrough: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">{kindLabel[n.kind] ?? n.kind}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-400">
              {new Date(n.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <div className="mt-0.5 text-sm font-medium text-slate-900">{n.title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-600">{n.body}</div>
        </div>
      </div>
    </>
  );
  if (n.link) {
    return (
      <Link href={n.link} onClick={onClickThrough} className="block">
        {inner}
      </Link>
    );
  }
  return <div onClick={onClickThrough}>{inner}</div>;
}
