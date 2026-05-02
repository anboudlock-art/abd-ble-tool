'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Wifi,
} from 'lucide-react';
import { apiRequest, type AlarmListResp, type DashboardSummary } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, deviceStatusLabel, deviceStatusTone } from '@/components/ui/Badge';
import { useAuth } from '@/providers/AuthProvider';

const STATUS_ORDER = [
  'manufactured',
  'in_warehouse',
  'shipped',
  'delivered',
  'assigned',
  'active',
  'returned',
  'retired',
];

export default function DashboardPage() {
  const { user } = useAuth();

  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiRequest<DashboardSummary>('/api/v1/dashboard/summary'),
    refetchInterval: 30_000,
  });

  const recentAlarmsQ = useQuery({
    queryKey: ['alarms', { recent: true }],
    queryFn: () =>
      apiRequest<AlarmListResp>('/api/v1/alarms', {
        query: { status: 'open', pageSize: 5 },
      }),
    refetchInterval: 30_000,
  });

  const s = summaryQ.data;
  const onlineRatePct =
    s?.online.rate != null ? Math.round(s.online.rate * 100) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">概览</h1>
        <p className="mt-1 text-sm text-slate-500">
          欢迎回来，{user?.name ?? ''} · 数据每 30 秒自动刷新
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          icon={<Lock size={18} />}
          label="设备总数"
          value={s?.deviceCounts.total ?? '—'}
          accent="text-slate-900"
        />
        <Stat
          icon={<Wifi size={18} />}
          label="在线率（active）"
          value={
            onlineRatePct == null
              ? s?.online.active === 0
                ? '—'
                : '加载中'
              : `${onlineRatePct}%`
          }
          sub={
            s
              ? `${s.online.online} / ${s.online.active} 台在线`
              : undefined
          }
          accent={
            onlineRatePct == null
              ? 'text-slate-400'
              : onlineRatePct >= 90
                ? 'text-emerald-600'
                : onlineRatePct >= 70
                  ? 'text-amber-500'
                  : 'text-red-600'
          }
        />
        <Stat
          icon={<AlertTriangle size={18} />}
          label="未处理告警"
          value={s?.alarms.open ?? '—'}
          sub={
            s
              ? `严重 ${s.alarms.byCritical} · 警告 ${s.alarms.byWarning} · 提示 ${s.alarms.byInfo}`
              : undefined
          }
          accent={
            s && s.alarms.byCritical > 0
              ? 'text-red-600'
              : s && s.alarms.open > 0
                ? 'text-amber-500'
                : 'text-emerald-600'
          }
        />
        <Stat
          icon={<Activity size={18} />}
          label="近 7 天事件"
          value={s?.events.recent7d ?? '—'}
          accent="text-slate-900"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="设备状态分布" />
          <CardBody>
            {!s ? (
              <div className="text-sm text-slate-400">加载中…</div>
            ) : s.deviceCounts.total === 0 ? (
              <div className="text-sm text-slate-400">暂无设备</div>
            ) : (
              <div className="space-y-2">
                {STATUS_ORDER.filter((st) => (s.deviceCounts.byStatus[st] ?? 0) > 0).map((st) => {
                  const n = s.deviceCounts.byStatus[st] ?? 0;
                  const pct = (n / s.deviceCounts.total) * 100;
                  return (
                    <div key={st} className="flex items-center gap-3">
                      <div className="w-20">
                        <Badge tone={deviceStatusTone(st)}>
                          {deviceStatusLabel[st] ?? st}
                        </Badge>
                      </div>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-slate-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-12 text-right text-xs text-slate-500">{n}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="未处理告警"
            description="最近 5 条"
            action={
              <Link href="/alarms" className="text-xs text-sky-600 hover:underline">
                查看全部 →
              </Link>
            }
          />
          <CardBody>
            {recentAlarmsQ.isLoading ? (
              <div className="text-sm text-slate-400">加载中…</div>
            ) : !recentAlarmsQ.data?.items.length ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <CheckCircle2 size={16} className="text-emerald-500" /> 暂无告警，一切正常
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentAlarmsQ.data.items.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-2.5">
                    <AlertCircle
                      size={16}
                      className={
                        a.severity === 'critical'
                          ? 'mt-0.5 text-red-500'
                          : a.severity === 'warning'
                            ? 'mt-0.5 text-amber-500'
                            : 'mt-0.5 text-sky-500'
                      }
                    />
                    <div className="flex-1">
                      <div className="text-sm">{a.message}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <Link
                          href={`/devices/${a.deviceId}`}
                          className="font-mono text-sky-600 hover:underline"
                        >
                          {a.lockId ?? a.deviceId}
                        </Link>
                        <span className="ml-2">
                          {new Date(a.triggeredAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="最近活跃设备"
          description="按最后上报时间排序"
          action={
            <Link href="/devices" className="text-xs text-sky-600 hover:underline">
              查看全部 →
            </Link>
          }
        />
        <CardBody>
          {!s?.recentDevices.length ? (
            <div className="text-sm text-slate-400">暂无</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.recentDevices.map((d) => (
                <Link
                  key={d.id}
                  href={`/devices/${d.id}`}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 hover:border-sky-400 hover:bg-sky-50"
                >
                  <div>
                    <div className="font-mono text-sm">{d.lockId}</div>
                    <div className="text-xs text-slate-500">
                      {d.lastSeenAt
                        ? new Date(d.lastSeenAt).toLocaleString('zh-CN')
                        : '尚未上报'}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge tone={d.lastState === 'opened' ? 'amber' : 'green'}>
                      {d.lastState === 'opened' ? '开锁' : d.lastState === 'closed' ? '关锁' : d.lastState}
                    </Badge>
                    {d.lastBattery != null ? (
                      <div className="mt-1 text-xs text-slate-500">{d.lastBattery}%</div>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-center gap-2 text-slate-500">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <div className={`mt-2 text-2xl font-semibold ${accent ?? 'text-slate-900'}`}>
          {value}
        </div>
        {sub ? <div className="mt-1 text-xs text-slate-400">{sub}</div> : null}
      </CardBody>
    </Card>
  );
}
