'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Pencil, ShieldOff, Trash2, Wrench } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type Device,
  type DeviceTransfer,
} from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge, deviceStatusLabel, deviceStatusTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RemoteControl } from '@/components/RemoteControl';
import { EditDeviceDialog } from '@/components/EditDeviceDialog';
import { DeployDialog } from '@/components/DeployDialog';
import { DeviceEventLog } from '@/components/DeviceEventLog';
import { RepairIntakeDialog } from '@/components/RepairIntakeDialog';
import { DeviceMap } from '@/components/DeviceMap';
import { useAuth } from '@/providers/AuthProvider';

interface AssignmentResp {
  current: {
    id: string;
    scope: 'company' | 'team' | 'user';
    teamId: string | null;
    teamName: string | null;
    userId: string | null;
    userName: string | null;
    userPhone: string | null;
    validFrom: string | null;
    validUntil: string | null;
    createdAt: string;
  } | null;
}

export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user: me } = useAuth();
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showRepair, setShowRepair] = useState(false);
  const isVendor = me?.role === 'vendor_admin';
  const canEdit = isVendor || me?.role === 'company_admin';

  const deviceQ = useQuery({
    queryKey: ['device', id],
    queryFn: () => apiRequest<Device>(`/api/v1/devices/${id}`),
  });

  const transfersQ = useQuery({
    queryKey: ['device', id, 'transfers'],
    queryFn: () =>
      apiRequest<{ items: DeviceTransfer[] }>(`/api/v1/devices/${id}/transfers`),
  });

  const assignmentQ = useQuery({
    queryKey: ['device', id, 'assignment'],
    queryFn: () => apiRequest<AssignmentResp>(`/api/v1/devices/${id}/assignment`),
  });

  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: (assignmentId: string) =>
      apiRequest(`/api/v1/authorizations/${assignmentId}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', id, 'assignment'] });
      qc.invalidateQueries({ queryKey: ['authorizations'] });
    },
    onError: (e) =>
      alert(e instanceof ApiClientError ? e.body.message : '撤销失败'),
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
        <CardHeader
          title="基本信息"
          action={
            canEdit ? (
              <div className="flex gap-2">
                {(d.status === 'assigned' || d.status === 'active') ? (
                  <Button variant="secondary" onClick={() => setShowDeploy(true)}>
                    <MapPin size={14} />{' '}
                    {d.status === 'active' ? '更新部署位置' : '现场部署'}
                  </Button>
                ) : null}
                {d.status !== 'repairing' && d.status !== 'retired' ? (
                  <Button variant="secondary" onClick={() => setShowRepair(true)}>
                    <Wrench size={14} /> 退修
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => setShowEdit(true)}>
                  <Pencil size={14} /> 编辑
                </Button>
                {isVendor ? (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (
                        !confirm(`确定删除设备 ${d.lockId}？仅在已入库/已回收/已报废状态可删`)
                      )
                        return;
                      try {
                        await apiRequest(`/api/v1/devices/${d.id}`, {
                          method: 'DELETE',
                        });
                        router.push('/devices');
                      } catch (e) {
                        alert(
                          e instanceof Error ? e.message : '删除失败',
                        );
                      }
                    }}
                  >
                    <Trash2 size={14} /> 删除
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Item label="型号">{d.model?.code ?? '—'}</Item>
            <Item label="名称">{d.model?.name ?? '—'}</Item>
            <Item label="批次">{d.batchNo ?? '—'}</Item>
            <Item label="IMEI">
              <span className="font-mono text-xs">{d.imei ?? '—'}</span>
            </Item>
            <Item label="ICCID">
              <span className="font-mono text-xs">{d.iccid ?? '—'}</span>
            </Item>
            <Item label="4G MAC">
              <span className="font-mono text-xs">{d.fourgMac ?? '—'}</span>
            </Item>
            <Item label="固件版本">{d.firmwareVersion ?? '—'}</Item>
            <Item label="硬件版本">{d.hardwareVersion ?? '—'}</Item>
            <Item label="质检">{d.qcStatus}</Item>
            <Item label="归属">
              {d.ownerCompanyName ?? (d.ownerType === 'vendor' ? '厂商' : '—')}
            </Item>
            <Item label="当前班组">
              {d.currentTeamName ?? '—'}
            </Item>
            <Item label="电量">
              {d.lastBattery == null ? (
                '—'
              ) : (
                <span
                  className={
                    d.lastBattery < 20
                      ? 'text-rose-500'
                      : d.lastBattery < 50
                        ? 'text-amber-500'
                        : 'text-emerald-600'
                  }
                >
                  {d.lastBattery}%
                </span>
              )}
            </Item>
            <Item label="锁状态">
              <Badge tone={lockStateTone(d.lastState)}>
                {lockStateLabel[d.lastState] ?? d.lastState ?? '—'}
              </Badge>
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
            {(d.loraE220Addr !== null ||
              d.loraDevAddr ||
              d.loraDevEui) ? (
              <>
                <Item label="LoRa 地址">
                  {d.loraE220Addr !== null
                    ? `${d.loraE220Addr} / ch ${d.loraChannel ?? '—'}`
                    : '—'}
                </Item>
                <Item label="DevAddr">
                  <span className="font-mono text-xs">{d.loraDevAddr ?? '—'}</span>
                </Item>
                <Item label="DevEUI">
                  <span className="font-mono text-xs">{d.loraDevEui ?? '—'}</span>
                </Item>
              </>
            ) : null}
            {d.notes ? <Item label="备注">{d.notes}</Item> : null}
          </dl>
        </CardBody>
      </Card>

      {showEdit ? (
        <EditDeviceDialog
          device={d}
          onClose={() => setShowEdit(false)}
          onSaved={() => setShowEdit(false)}
        />
      ) : null}

      {showDeploy ? (
        <DeployDialog
          deviceId={d.id}
          initialDoorLabel={d.doorLabel}
          onClose={() => setShowDeploy(false)}
          onDeployed={() => setShowDeploy(false)}
        />
      ) : null}

      {showRepair ? (
        <RepairIntakeDialog
          deviceId={d.id}
          lockId={d.lockId}
          onClose={() => setShowRepair(false)}
          onIntake={() => setShowRepair(false)}
        />
      ) : null}

      {assignmentQ.data?.current ? (
        <Card>
          <CardHeader
            title="当前授权"
            action={
              canEdit ? (
                <Button
                  variant="ghost"
                  loading={revoke.isPending}
                  onClick={() => {
                    const a = assignmentQ.data?.current;
                    if (!a) return;
                    if (confirm(`撤销当前授权？(${a.userName ?? a.teamName ?? a.scope})`)) {
                      revoke.mutate(a.id);
                    }
                  }}
                >
                  <ShieldOff size={14} /> 撤销授权
                </Button>
              ) : null
            }
          />
          <CardBody>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-slate-400">范围：</span>
                <Badge tone={assignmentQ.data.current.scope === 'user' ? 'blue' : 'gray'}>
                  {assignmentQ.data.current.scope === 'user'
                    ? '指定人员'
                    : assignmentQ.data.current.scope === 'team'
                      ? '整个班组'
                      : '公司级'}
                </Badge>
              </div>
              {assignmentQ.data.current.teamName ? (
                <div>
                  <span className="text-slate-400">班组：</span>
                  <span className="font-medium">{assignmentQ.data.current.teamName}</span>
                </div>
              ) : null}
              {assignmentQ.data.current.userName ? (
                <div>
                  <span className="text-slate-400">人员：</span>
                  <span className="font-medium">{assignmentQ.data.current.userName}</span>
                  {assignmentQ.data.current.userPhone ? (
                    <span className="ml-2 font-mono text-xs text-slate-500">
                      {assignmentQ.data.current.userPhone}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {(assignmentQ.data.current.validFrom || assignmentQ.data.current.validUntil) ? (
                <div>
                  <span className="text-slate-400">时段：</span>
                  <span className="font-mono text-xs">
                    {assignmentQ.data.current.validFrom
                      ? new Date(assignmentQ.data.current.validFrom).toLocaleString('zh-CN')
                      : '不限'}
                    {' — '}
                    {assignmentQ.data.current.validUntil
                      ? new Date(assignmentQ.data.current.validUntil).toLocaleString('zh-CN')
                      : '不限'}
                  </span>
                </div>
              ) : null}
              <div className="text-xs text-slate-500">
                自 {new Date(assignmentQ.data.current.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {(d.locationLat != null || d.locationLng != null) && d.model?.code !== 'ESEAL-LOGI-01' ? (
        <DeviceMap lat={d.locationLat} lng={d.locationLng} doorLabel={d.doorLabel} />
      ) : null}

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

      <DeviceEventLog deviceId={id} />
    </div>
  );
}

/** v2.8 — Chinese label + colour tone for the LockState enum. */
const lockStateLabel: Record<string, string> = {
  opened: '开锁',
  closed: '关锁',
  tampered: '剪断报警',
  unknown: '未知',
};
function lockStateTone(s: string | null | undefined): 'green' | 'amber' | 'red' | 'gray' {
  switch (s) {
    case 'opened':
      return 'amber';
    case 'closed':
      return 'green';
    case 'tampered':
      return 'red';
    default:
      return 'gray';
  }
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children}</dd>
    </div>
  );
}
