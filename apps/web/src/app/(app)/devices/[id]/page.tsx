'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  apiRequest,
  type Device,
  type DeviceTransfer,
} from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge, deviceStatusLabel, deviceStatusTone } from '@/components/ui/Badge';
import { RemoteControl } from '@/components/RemoteControl';

export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const deviceQ = useQuery({
    queryKey: ['device', id],
    queryFn: () => apiRequest<Device>(`/api/v1/devices/${id}`),
  });

  const transfersQ = useQuery({
    queryKey: ['device', id, 'transfers'],
    queryFn: () =>
      apiRequest<{ items: DeviceTransfer[] }>(`/api/v1/devices/${id}/transfers`),
  });

  if (deviceQ.isLoading) {
    return <div className="text-sm text-slate-400">加载中…</div>;
  }
  if (deviceQ.isError || !deviceQ.data) {
    return (
      <div className="text-sm text-red-500">
        加载失败：{(deviceQ.error as Error)?.message}
      </div>
    );
  }
  const d = deviceQ.data;

  return (
    <div className="space-y-6">
      <Link
        href="/devices"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={14} /> 返回设备列表
      </Link>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-slate-900">{d.lockId}</h1>
          <div className="mt-1 text-xs text-slate-500">{d.bleMac}</div>
        </div>
        <Badge tone={deviceStatusTone(d.status)}>
          {deviceStatusLabel[d.status] ?? d.status}
        </Badge>
      </div>

      <Card>
        <CardHeader title="基本信息" />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Item label="型号">{d.model?.code ?? '—'}</Item>
            <Item label="名称">{d.model?.name ?? '—'}</Item>
            <Item label="批次">{d.batchNo ?? '—'}</Item>
            <Item label="IMEI">{d.imei ?? '—'}</Item>
            <Item label="固件版本">{d.firmwareVersion ?? '—'}</Item>
            <Item label="质检">{d.qcStatus}</Item>
            <Item label="归属">
              {d.ownerCompanyName ?? (d.ownerType === 'vendor' ? '厂商' : '—')}
            </Item>
            <Item label="电量">
              {d.lastBattery !== null ? `${d.lastBattery}%` : '—'}
            </Item>
            <Item label="最近上报">
              {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('zh-CN') : '—'}
            </Item>
            <Item label="门号">{d.doorLabel ?? '—'}</Item>
            <Item label="部署时间">
              {d.deployedAt ? new Date(d.deployedAt).toLocaleString('zh-CN') : '—'}
            </Item>
            <Item label="出厂时间">
              {d.producedAt ? new Date(d.producedAt).toLocaleString('zh-CN') : '—'}
            </Item>
          </dl>
        </CardBody>
      </Card>

      <RemoteControl device={d} />

      <Card>
        <CardHeader title="流转历史" description="设备生命周期的每一次状态变更" />
        {transfersQ.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !transfersQ.data?.items.length ? (
          <EmptyState message="暂无流转记录" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>时间</Th>
                <Th>从</Th>
                <Th>到</Th>
                <Th>原因</Th>
                <Th>元数据</Th>
              </Tr>
            </THead>
            <TBody>
              {transfersQ.data.items.map((t) => (
                <Tr key={t.id}>
                  <Td className="text-xs text-slate-500">
                    {new Date(t.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <Badge tone={deviceStatusTone(t.fromStatus)}>
                      {deviceStatusLabel[t.fromStatus] ?? t.fromStatus}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={deviceStatusTone(t.toStatus)}>
                      {deviceStatusLabel[t.toStatus] ?? t.toStatus}
                    </Badge>
                  </Td>
                  <Td>{t.reason ?? '—'}</Td>
                  <Td className="font-mono text-xs text-slate-500">
                    {t.metadata ? JSON.stringify(t.metadata) : '—'}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children}</dd>
    </div>
  );
}
