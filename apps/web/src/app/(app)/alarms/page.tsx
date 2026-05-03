'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck } from 'lucide-react';
import { apiRequest, ApiClientError, type AlarmListResp } from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const SEVERITY_OPTIONS = ['', 'info', 'warning', 'critical'];
const STATUS_OPTIONS = ['', 'open', 'acknowledged', 'resolved'];
const TYPE_OPTIONS = ['', 'low_battery', 'offline', 'tampered', 'command_timeout'];

const typeLabel: Record<string, string> = {
  low_battery: '低电量',
  offline: '离线',
  tampered: '破拆/剪断',
  command_timeout: '指令超时',
};

const statusLabel: Record<string, string> = {
  open: '未处理',
  acknowledged: '已确认',
  resolved: '已解决',
};

function severityTone(s: string): 'red' | 'amber' | 'blue' {
  return s === 'critical' ? 'red' : s === 'warning' ? 'amber' : 'blue';
}

function statusTone(s: string): 'red' | 'amber' | 'green' {
  return s === 'open' ? 'red' : s === 'acknowledged' ? 'amber' : 'green';
}

export default function AlarmsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const pageSize = 30;

  const q = useQuery({
    queryKey: ['alarms', { page, status, severity, type }],
    queryFn: () =>
      apiRequest<AlarmListResp>('/api/v1/alarms', {
        query: {
          page,
          pageSize,
          status: status || undefined,
          severity: severity || undefined,
          type: type || undefined,
        },
      }),
    refetchInterval: 30_000, // pull a refresh every 30s
  });

  const ack = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/alarms/${id}/ack`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alarms'] }),
    onError: (e) =>
      alert(e instanceof ApiClientError ? e.body.message : '确认失败'),
  });

  const resolve = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/alarms/${id}/resolve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alarms'] }),
    onError: (e) =>
      alert(e instanceof ApiClientError ? e.body.message : '解决失败'),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">告警</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">
            未处理：<span className="font-semibold text-red-600">{data?.openCount ?? '—'}</span>
          </span>
          <span className="text-slate-500">
            共 <span className="font-semibold text-slate-700">{data?.total ?? '—'}</span> 条
          </span>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '全部状态' : statusLabel[s]}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '全部级别' : s === 'critical' ? '严重' : s === 'warning' ? '警告' : '提示'}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === '' ? '全部类型' : typeLabel[t]}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            onClick={() => {
              setStatus('');
              setSeverity('');
              setType('');
              setPage(1);
            }}
          >
            重置
          </Button>
        </div>

        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无符合条件的告警" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>触发时间</Th>
                <Th>设备</Th>
                <Th>类型</Th>
                <Th>级别</Th>
                <Th>状态</Th>
                <Th>消息</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((a) => (
                <Tr key={a.id}>
                  <Td className="text-xs text-slate-500">
                    {new Date(a.triggeredAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <Link
                      href={`/devices/${a.deviceId}`}
                      className="font-mono text-sky-600 hover:underline"
                    >
                      {a.lockId ?? a.deviceId}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone="gray">{typeLabel[a.type] ?? a.type}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={severityTone(a.severity)}>
                      {a.severity === 'critical' ? '严重' : a.severity === 'warning' ? '警告' : '提示'}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(a.status)}>
                      {statusLabel[a.status] ?? a.status}
                    </Badge>
                  </Td>
                  <Td className="text-sm">{a.message}</Td>
                  <Td>
                    <div className="flex gap-2">
                      {a.status === 'open' ? (
                        <button
                          title="确认"
                          onClick={() => ack.mutate(a.id)}
                          className="text-slate-400 hover:text-amber-500"
                        >
                          <Check size={14} />
                        </button>
                      ) : null}
                      {a.status !== 'resolved' ? (
                        <button
                          title="标记已解决"
                          onClick={() => resolve.mutate(a.id)}
                          className="text-slate-400 hover:text-emerald-500"
                        >
                          <CheckCheck size={14} />
                        </button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {data && data.total > pageSize ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
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
    </div>
  );
}
