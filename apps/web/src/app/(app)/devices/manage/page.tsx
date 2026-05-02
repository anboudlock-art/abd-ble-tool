'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, KeyRound, ShieldOff } from 'lucide-react';
import { clsx } from 'clsx';
import {
  apiRequest,
  ApiClientError,
  type BatchListResp,
  type CompanyListResp,
  type DeviceListResp,
  type OrgTree,
  type OrgNodeSelection,
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge, deviceStatusLabel, deviceStatusTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { OrgTree as OrgTreeComponent } from '@/components/OrgTree';
import { AuthorizeDialog } from '@/components/AuthorizeDialog';
import { useAuth } from '@/providers/AuthProvider';

/**
 * 设备管理 (v2.7 task 4) — 左树右表。点公司/部门/班组节点对应过滤设备列表，
 * 支持批量授权 + 取消授权。Vendor 顶部可切换客户公司。
 */
export default function DeviceManagePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isVendor = user?.role === 'vendor_admin';

  const [companyId, setCompanyId] = useState<string>(user?.companyId ?? '');
  const [selected, setSelected] = useState<OrgNodeSelection | null>(null);
  const [search, setSearch] = useState('');
  const [batchId, setBatchId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showAuthorize, setShowAuthorize] = useState(false);
  const pageSize = 30;

  // -------- companies (vendor only) --------
  const companiesQ = useQuery({
    queryKey: ['companies', { all: true }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', { query: { pageSize: 200 } }),
    enabled: isVendor,
  });

  // Auto-select the first company for vendor on first load
  useEffect(() => {
    if (isVendor && !companyId && companiesQ.data?.items.length) {
      setCompanyId(companiesQ.data.items[0]!.id);
    }
  }, [isVendor, companyId, companiesQ.data]);

  // -------- org tree --------
  const treeQ = useQuery({
    queryKey: ['device-tree', companyId],
    queryFn: () =>
      apiRequest<OrgTree>('/api/v1/device-tree', {
        query: isVendor ? { companyId } : {},
      }),
    enabled: !!companyId || !isVendor,
  });

  // Default selection: pin the company root once the tree loads
  useEffect(() => {
    if (!selected && treeQ.data) {
      setSelected({ type: 'company', id: treeQ.data.id, name: treeQ.data.name });
    }
  }, [treeQ.data, selected]);

  // Reset selection when switching company
  useEffect(() => {
    setSelected(null);
    setCheckedIds(new Set());
    setPage(1);
  }, [companyId]);

  // -------- batches for filter --------
  const batchesQ = useQuery({
    queryKey: ['production-batches', { all: true }],
    queryFn: () =>
      apiRequest<BatchListResp>('/api/v1/production/batches', {
        query: { pageSize: 200 },
      }),
  });

  // -------- devices (filtered by selection) --------
  const filterQuery = useMemo(() => {
    const q: Record<string, string | number | undefined> = {
      page,
      pageSize,
      search: search || undefined,
      batchId: batchId || undefined,
      status: status || undefined,
    };
    if (selected?.type === 'team') q.currentTeamId = selected.id;
    else if (selected?.type === 'department') q.currentDepartmentId = selected.id;
    else if (selected?.type === 'company') {
      // company-scoped: vendor needs to pass ownerCompanyId, else
      // backend would return *all* devices vendor-wide
      if (isVendor) q.ownerCompanyId = selected.id;
    }
    return q;
  }, [page, search, batchId, status, selected, isVendor]);

  const devicesQ = useQuery({
    queryKey: ['devices', 'manage', filterQuery],
    queryFn: () =>
      apiRequest<DeviceListResp>('/api/v1/devices', { query: filterQuery }),
    enabled: !!selected,
  });

  // -------- revoke-on-selection --------
  const revoke = useMutation({
    mutationFn: async (deviceIds: string[]) => {
      // For each selected device, find its open assignment and revoke it
      const results = await Promise.allSettled(
        deviceIds.map(async (deviceId) => {
          const a = await apiRequest<{
            current: { id: string } | null;
          }>(`/api/v1/devices/${deviceId}/assignment`);
          if (!a.current) return { deviceId, skipped: true };
          await apiRequest(`/api/v1/authorizations/${a.current.id}/revoke`, {
            method: 'POST',
          });
          return { deviceId, skipped: false };
        }),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const skipped = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as { skipped: boolean }).skipped,
      ).length;
      return { ok, skipped, total: deviceIds.length };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['devices', 'manage'] });
      qc.invalidateQueries({ queryKey: ['device-tree'] });
      qc.invalidateQueries({ queryKey: ['authorizations'] });
      setCheckedIds(new Set());
      alert(`已撤销 ${r.ok - r.skipped} 条 / 共 ${r.total} 个设备 (${r.skipped} 个未授权,跳过)`);
    },
    onError: (e) =>
      alert(e instanceof ApiClientError ? e.body.message : '撤销失败'),
  });

  // -------- helpers --------
  const data = devicesQ.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const allIds = (data?.items ?? []).map((d) => d.id);
  const allChecked = allIds.length > 0 && allIds.every((id) => checkedIds.has(id));

  function toggleAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(allIds));
  }
  function toggleOne(id: string) {
    setCheckedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fixedTeamId = selected?.type === 'team' ? selected.id : undefined;
  const breadcrumbs: Array<{ label: string }> = [];
  if (treeQ.data) breadcrumbs.push({ label: treeQ.data.name });
  if (selected?.type === 'department') breadcrumbs.push({ label: selected.name });
  if (selected?.type === 'team') {
    const dept = treeQ.data?.departments.find((d) =>
      d.teams.some((t) => t.id === selected.id),
    );
    if (dept) breadcrumbs.push({ label: dept.name });
    breadcrumbs.push({ label: selected.name });
  }

  // For vendor: show an empty state when no companies exist, instead of a
  // useless tree shell (and avoid the 409 from /device-tree the user reported).
  const noCompanies =
    isVendor && companiesQ.isFetched && (companiesQ.data?.items.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">设备管理</h1>
        {isVendor && (companiesQ.data?.items.length ?? 0) > 0 ? (
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {/* No empty option: with at least one company, vendor must have
                one selected so the tree query never fires without a
                companyId (which the backend rejects with 409). */}
            {companiesQ.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {noCompanies ? (
        <Card>
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            还没有客户公司。请先去
            <a href="/companies/new" className="ml-1 text-sky-600 hover:underline">
              创建一个
            </a>
            。
          </div>
        </Card>
      ) : null}

      {!noCompanies ? (
      <div className="grid grid-cols-12 gap-4">
        {/* Left: org tree */}
        <Card className="col-span-12 p-3 md:col-span-3">
          <OrgTreeComponent
            tree={treeQ.data ?? null}
            selected={selected}
            onSelect={(n) => {
              setSelected(n);
              setCheckedIds(new Set());
              setPage(1);
            }}
          />
        </Card>

        {/* Right: device panel */}
        <Card className="col-span-12 md:col-span-9">
          {/* Header: breadcrumb + actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight size={14} className="text-slate-300" /> : null}
                  <span className={i === breadcrumbs.length - 1 ? 'font-semibold text-slate-900' : ''}>
                    {b.label}
                  </span>
                </span>
              ))}
              {data ? (
                <span className="ml-3 text-xs text-slate-400">共 {data.total} 台</span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={checkedIds.size === 0}
                onClick={() => setShowAuthorize(true)}
              >
                <KeyRound size={14} /> 授权({checkedIds.size})
              </Button>
              <Button
                variant="secondary"
                disabled={checkedIds.size === 0 || revoke.isPending}
                loading={revoke.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `撤销选中 ${checkedIds.size} 台设备的当前授权？未授权的将被跳过。`,
                    )
                  ) {
                    revoke.mutate(Array.from(checkedIds));
                  }
                }}
              >
                <ShieldOff size={14} /> 撤销
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="搜锁号 / MAC / IMEI / 门号"
              className="w-64"
            />
            <select
              value={batchId}
              onChange={(e) => {
                setBatchId(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">全部批次</option>
              {batchesQ.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} · {b.quantity} 台
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">全部状态</option>
              {Object.keys(deviceStatusLabel).map((s) => (
                <option key={s} value={s}>
                  {deviceStatusLabel[s]}
                </option>
              ))}
            </select>
            {(search || batchId || status) ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setBatchId('');
                  setStatus('');
                  setPage(1);
                }}
              >
                重置
              </Button>
            ) : null}
          </div>

          {/* Device table */}
          {!selected ? (
            <EmptyState message="点击左侧组织树节点查看设备" />
          ) : devicesQ.isLoading ? (
            <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
          ) : !data?.items.length ? (
            <EmptyState message="该范围下暂无设备" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-8">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                    />
                  </Th>
                  <Th>锁号</Th>
                  <Th>门号</Th>
                  <Th>MAC</Th>
                  <Th>所属</Th>
                  <Th>状态</Th>
                  <Th>电量</Th>
                  <Th>最近上报</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(d.id)}
                        onChange={() => toggleOne(d.id)}
                      />
                    </Td>
                    <Td>
                      <Link
                        href={`/devices/${d.id}`}
                        className="font-mono text-sky-600 hover:underline"
                      >
                        {d.lockId}
                      </Link>
                    </Td>
                    <Td>{d.doorLabel ?? '—'}</Td>
                    <Td className="font-mono text-xs">{d.bleMac}</Td>
                    <Td className="text-xs">
                      {d.currentTeamName ?? <span className="text-slate-400">未分配</span>}
                    </Td>
                    <Td>
                      <Badge tone={deviceStatusTone(d.status)}>
                        {deviceStatusLabel[d.status] ?? d.status}
                      </Badge>
                    </Td>
                    <Td>
                      {d.lastBattery == null ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span
                          className={clsx(
                            'text-xs font-medium',
                            d.lastBattery < 20
                              ? 'text-rose-500'
                              : d.lastBattery < 50
                                ? 'text-amber-500'
                                : 'text-emerald-600',
                          )}
                        >
                          {d.lastBattery}%
                        </span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {d.lastSeenAt
                        ? new Date(d.lastSeenAt).toLocaleString('zh-CN')
                        : '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          {/* Pagination */}
          {data && data.total > pageSize ? (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
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
      ) : null}

      {showAuthorize ? (
        <AuthorizeDialog
          selectedDeviceIds={Array.from(checkedIds)}
          fixedCompanyId={companyId}
          fixedTeamId={fixedTeamId}
          onClose={() => setShowAuthorize(false)}
          onSuccess={() => {
            setShowAuthorize(false);
            setCheckedIds(new Set());
          }}
        />
      ) : null}
    </div>
  );
}
