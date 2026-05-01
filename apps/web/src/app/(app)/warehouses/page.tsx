'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Factory, Wrench } from 'lucide-react';
import { apiRequest, type DashboardSummary } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

/**
 * 厂商三库总览 (v2.6 §3.2). 从 dashboard summary 拉 byStatus，
 * 把三个仓的体量直接亮出来 + 引导到对应详细页。
 */
export default function WarehousesPage() {
  const q = useQuery({
    queryKey: ['dashboard-summary', { warehouses: true }],
    queryFn: () => apiRequest<DashboardSummary>('/api/v1/dashboard/summary'),
    refetchInterval: 30_000,
  });

  const byStatus = q.data?.deviceCounts.byStatus ?? {};
  const newCount = byStatus.manufactured ?? 0;
  const stockCount = byStatus.in_warehouse ?? 0;
  const repairCount = byStatus.repairing ?? 0;
  const total = q.data?.deviceCounts.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">三库总览</h1>
        <span className="text-sm text-slate-500">
          全平台共 <span className="font-semibold text-slate-700">{total}</span> 台
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <WarehouseCard
          title="新生产库"
          count={newCount}
          tone="amber"
          icon={<Factory size={18} />}
          href="/devices?status=manufactured"
          subtitle="待移入待移交 / 退修"
        />
        <WarehouseCard
          title="待移交库"
          count={stockCount}
          tone="blue"
          icon={<Boxes size={18} />}
          href="/devices?status=in_warehouse"
          subtitle="可发货到客户公司"
        />
        <WarehouseCard
          title="维修中库"
          count={repairCount}
          tone="red"
          icon={<Wrench size={18} />}
          href="/repairs"
          subtitle="维修单 + 状态推进"
        />
      </div>

      <Card>
        <CardHeader title="库存明细" description="按状态聚合" />
        <CardBody>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-2 text-left">状态</th>
                <th className="py-2 text-right">数量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(byStatus).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-2">{k}</td>
                  <td className="py-2 text-right font-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

function WarehouseCard({
  title,
  count,
  tone,
  icon,
  href,
  subtitle,
}: {
  title: string;
  count: number;
  tone: 'amber' | 'blue' | 'red';
  icon: React.ReactNode;
  href: string;
  subtitle: string;
}) {
  const ring =
    tone === 'amber'
      ? 'ring-amber-200 bg-amber-50'
      : tone === 'blue'
        ? 'ring-sky-200 bg-sky-50'
        : 'ring-red-200 bg-red-50';
  const numColor =
    tone === 'amber'
      ? 'text-amber-700'
      : tone === 'blue'
        ? 'text-sky-700'
        : 'text-red-700';
  return (
    <Link href={href} className={`block rounded-lg p-5 ring-1 ${ring} hover:shadow`}>
      <div className="mb-2 flex items-center gap-2 text-sm text-slate-700">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <div className={`text-3xl font-semibold ${numColor}`}>{count}</div>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </Link>
  );
}
