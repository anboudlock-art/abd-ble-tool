'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search, Truck, UsersRound } from 'lucide-react';
import { apiRequest, type DeviceListResp, type DeviceModel } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge, deviceStatusLabel, deviceStatusTone } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ShipDialog } from '@/components/ShipDialog';
import { AssignDialog } from '@/components/AssignDialog';
import { useAuth } from '@/providers/AuthProvider';

const STATUS_OPTIONS = [
  '',
  'manufactured',
  'in_warehouse',
  'shipped',
  'delivered',
  'assigned',
  'active',
  'returned',
  'retired',
];

export default function DevicesPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modelId, setModelId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showShipDialog, setShowShipDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const pageSize = 20;

  const isVendor = user?.role === 'vendor_admin';
  const canAssign =
    user?.role === 'vendor_admin' ||
    user?.role === 'company_admin' ||
    user?.role === 'dept_admin';

  const modelsQ = useQuery({
    queryKey: ['device-models'],
    queryFn: () => apiRequest<{ items: DeviceModel[] }>('/api/v1/device-models'),
  });

  const devicesQ = useQuery({
    queryKey: ['devices', { search, status, modelId, page }],
    queryFn: () =>
      apiRequest<DeviceListResp>('/api/v1/devices', {
        query: {
          page,
          pageSize,
          search: search || undefined,
          status: status || undefined,
          modelId: modelId || undefined,
        },
      }),
  });

  const data = devicesQ.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  // Selection rules differ by role:
  //   vendor_admin: in_warehouse devices (for shipping)
  //   company_admin / dept_admin: delivered devices (for assigning)
  const selectableIds = useMemo(() => {
    const items = data?.items ?? [];
    if (isVendor) return items.filter((d) => d.status === 'in_warehouse').map((d) => d.id);
    if (canAssign)
      return items.filter((d) => d.status === 'delivered' || d.status === 'assigned').map((d) => d.id);
    return [];
  }, [data, isVendor, canAssign]);

  const selectedShippable = useMemo(
    () =>
      Array.from(selected).filter((id) =>
        (data?.items ?? []).some((d) => d.id === id && d.status === 'in_warehouse'),
      ),
    [selected, data],
  );

  const selectedAssignable = useMemo(
    () =>
      Array.from(selected).filter((id) =>
        (data?.items ?? []).some(
          (d) => d.id === id && (d.status === 'delivered' || d.status === 'assigned'),
        ),
      ),
    [selected, data],
  );

  const toggleAll = () => {
    if (selected.size === selectableIds.length && selectableIds.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">设备</h1>
        <div className="flex items-center gap-3">
          {isVendor && selectedShippable.length > 0 ? (
            <Button onClick={() => setShowShipDialog(true)}>
              <Truck size={14} /> 发货 ({selectedShippable.length})
            </Button>
          ) : null}
          {canAssign && selectedAssignable.length > 0 ? (
            <Button variant="secondary" onClick={() => setShowAssignDialog(true)}>
              <UsersRound size={14} /> 分配到班组 ({selectedAssignable.length})
            </Button>
          ) : null}
          <div className="text-sm text-slate-500">
            共 <span className="font-semibold text-slate-700">{data?.total ?? '—'}</span> 台
          </div>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-7 w-72"
              placeholder="按锁号 / MAC / IMEI / 门号搜索"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {deviceStatusLabel[s] ?? s}
              </option>
            ))}
          </select>
          <select
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">全部型号</option>
            {modelsQ.data?.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} · {m.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setStatus('');
              setModelId('');
              setPage(1);
              setSelected(new Set());
            }}
          >
            重置
          </Button>
        </div>

        {devicesQ.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : devicesQ.isError ? (
          <div className="px-6 py-8 text-sm text-red-500">
            加载失败：{(devicesQ.error as Error).message}
          </div>
        ) : !data?.items.length ? (
          <EmptyState message="没有匹配的设备" />
        ) : (
          <Table>
            <THead>
              <Tr>
                {isVendor || canAssign ? (
                  <Th className="w-8">
                    <input
                      type="checkbox"
                      checked={
                        selectableIds.length > 0 &&
                        selected.size === selectableIds.length
                      }
                      onChange={toggleAll}
                      title="选中本页所有可操作设备"
                    />
                  </Th>
                ) : null}
                <Th>锁号</Th>
                <Th>BLE MAC</Th>
                <Th>IMEI</Th>
                <Th>型号</Th>
                <Th>状态</Th>
                <Th>归属</Th>
                <Th>电量</Th>
                <Th>最近上报</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((d) => {
                const canSelect = selectableIds.includes(d.id);
                return (
                  <Tr key={d.id}>
                    {isVendor || canAssign ? (
                      <Td>
                        <input
                          type="checkbox"
                          disabled={!canSelect}
                          checked={selected.has(d.id)}
                          onChange={() => toggleOne(d.id)}
                          title={
                            canSelect
                              ? undefined
                              : isVendor
                                ? '仅"已入库"状态可发货'
                                : '仅"已签收/已分配"状态可分配'
                          }
                        />
                      </Td>
                    ) : null}
                    <Td>
                      <Link href={`/devices/${d.id}`} className="font-mono text-sky-600 hover:underline">
                        {d.lockId}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{d.bleMac}</Td>
                    <Td className="font-mono text-xs">{d.imei ?? '—'}</Td>
                    <Td>
                      {d.model ? (
                        <span>
                          {d.model.code}
                          <span className="ml-1 text-slate-400">{d.model.name}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <Badge tone={deviceStatusTone(d.status)}>
                        {deviceStatusLabel[d.status] ?? d.status}
                      </Badge>
                    </Td>
                    <Td>{d.ownerCompanyName ?? (d.ownerType === 'vendor' ? '厂商' : '—')}</Td>
                    <Td>{d.lastBattery !== null ? `${d.lastBattery}%` : '—'}</Td>
                    <Td className="text-xs text-slate-500">
                      {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('zh-CN') : '—'}
                    </Td>
                  </Tr>
                );
              })}
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

      {showShipDialog ? (
        <ShipDialog
          selectedDeviceIds={selectedShippable}
          onClose={() => setShowShipDialog(false)}
          onShipped={() => {
            setShowShipDialog(false);
            setSelected(new Set());
          }}
        />
      ) : null}

      {showAssignDialog ? (
        <AssignDialog
          selectedDeviceIds={selectedAssignable}
          onClose={() => setShowAssignDialog(false)}
          onAssigned={() => {
            setShowAssignDialog(false);
            setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}
