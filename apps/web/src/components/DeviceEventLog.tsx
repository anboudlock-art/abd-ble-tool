'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';

interface LockEventItem {
  id: string;
  eventType:
    | 'opened'
    | 'closed'
    | 'tampered'
    | 'heartbeat'
    | 'low_battery'
    | 'offline'
    | 'online';
  source: 'ble' | 'lora' | 'fourg' | 'system';
  battery: number | null;
  lat: string | null;
  lng: string | null;
  createdAt: string;
  receivedAt: string;
  operatorUserId: string | null;
}
interface ListResp {
  items: LockEventItem[];
  total: number;
  page: number;
  pageSize: number;
}

const TYPE_FILTER = [
  '',
  'opened',
  'closed',
  'tampered',
  'heartbeat',
  'online',
  'offline',
  'low_battery',
] as const;

const typeLabel: Record<string, string> = {
  opened: '🔓 开锁',
  closed: '🔒 关锁',
  tampered: '⚠️ 剪断/破拆',
  heartbeat: '💓 心跳/GPS',
  low_battery: '🪫 低电量',
  offline: '🔴 离线',
  online: '🟢 上线',
};
const sourceLabel: Record<string, string> = {
  ble: 'BLE',
  lora: 'LoRa',
  fourg: '4G',
  system: '系统',
};

/**
 * v2.8 设备事件日志 — 用 GET /devices/:id/events 拉 lock_event 列表。
 * 时间倒序，type 过滤，分页。最旧的页面尾部"加载更多"或上下页。
 */
export function DeviceEventLog({ deviceId }: { deviceId: string }) {
  const [eventType, setEventType] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const q = useQuery({
    queryKey: ['device-events', deviceId, { eventType, page }],
    queryFn: () =>
      apiRequest<ListResp>(`/api/v1/devices/${deviceId}/events`, {
        query: {
          page,
          pageSize,
          ...(eventType ? { eventType } : {}),
        },
      }),
    refetchInterval: 60_000,
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card>
      <CardHeader
        title="事件日志"
        description={`锁的上行事件流：开关锁 / 心跳 / GPS / 离线`}
      />
      <div className="flex items-center gap-3 px-6 py-2">
        <select
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          {TYPE_FILTER.map((t) => (
            <option key={t} value={t}>
              {t === '' ? '全部类型' : typeLabel[t] ?? t}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">
          {data ? `共 ${data.total} 条` : null}
        </span>
      </div>

      {q.isLoading ? (
        <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
      ) : !data?.items.length ? (
        <EmptyState message="暂无事件日志" />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>时间</Th>
              <Th>事件</Th>
              <Th>来源</Th>
              <Th>电量</Th>
              <Th>位置</Th>
            </Tr>
          </THead>
          <TBody>
            {data.items.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap text-xs text-slate-500">
                  {new Date(e.createdAt).toLocaleString('zh-CN')}
                </Td>
                <Td className="text-sm">{typeLabel[e.eventType] ?? e.eventType}</Td>
                <Td className="text-xs text-slate-500">
                  {sourceLabel[e.source] ?? e.source}
                </Td>
                <Td className="text-xs">
                  {e.battery == null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span
                      className={
                        e.battery < 20
                          ? 'text-rose-500'
                          : e.battery < 50
                            ? 'text-amber-500'
                            : 'text-emerald-600'
                      }
                    >
                      {e.battery}%
                    </span>
                  )}
                </Td>
                <Td className="font-mono text-xs text-slate-500">
                  {e.lat && e.lng ? `${e.lat}, ${e.lng}` : '—'}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {data && data.total > pageSize ? (
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-2 text-xs text-slate-500">
          <span>
            第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
