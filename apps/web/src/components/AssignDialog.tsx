'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type AssignResponse,
  type CompanyDetail,
  type CompanyListResp,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

interface Props {
  selectedDeviceIds: string[];
  /** When set, lock the company picker to this id (e.g. when caller already filtered by company). */
  fixedCompanyId?: string;
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignDialog({ selectedDeviceIds, fixedCompanyId, onClose, onAssigned }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor_admin';

  const [companyId, setCompanyId] = useState(fixedCompanyId ?? user?.companyId ?? '');
  const [teamId, setTeamId] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const companiesQ = useQuery({
    queryKey: ['companies', { all: true }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', { query: { pageSize: 200 } }),
    enabled: isVendor && !fixedCompanyId,
  });

  const companyDetailQ = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => apiRequest<CompanyDetail>(`/api/v1/companies/${companyId}`),
    enabled: !!companyId,
  });

  const teamOptions = useMemo(() => {
    const out: Array<{ id: string; label: string }> = [];
    for (const d of companyDetailQ.data?.departments ?? []) {
      for (const t of d.teams) out.push({ id: t.id, label: `${d.name} / ${t.name}` });
    }
    return out;
  }, [companyDetailQ.data]);

  const teamMembersQ = useQuery<{
    items: Array<{ userId: string; name: string; phone: string; roleInTeam: string }>;
  }>({
    queryKey: ['team-members', teamId],
    queryFn: () => apiRequest(`/api/v1/teams/${teamId}/members`),
    enabled: !!teamId,
  });

  const assign = useMutation({
    mutationFn: () =>
      apiRequest<AssignResponse>('/api/v1/devices/assign', {
        method: 'POST',
        body: {
          deviceIds: selectedDeviceIds.map((s) => Number(s)),
          teamId: Number(teamId),
          ...(userId ? { userId: Number(userId) } : {}),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      onAssigned();
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.body.message : '分配失败'),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">分配设备到班组</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            将 <span className="font-semibold text-slate-900">{selectedDeviceIds.length}</span>{' '}
            台设备分配
          </div>

          {isVendor && !fixedCompanyId ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">公司</label>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setTeamId('');
                }}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— 选择公司 —</option>
                {companiesQ.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">班组</label>
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setUserId('');
              }}
              disabled={!companyId}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">— 选择班组 —</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {companyId && teamOptions.length === 0 && !companyDetailQ.isLoading ? (
              <p className="mt-1 text-xs text-amber-600">
                该公司暂无班组，请先在公司详情页创建
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              指派给人员 <span className="text-slate-400">（可选，不选则给整个班组）</span>
            </label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={!teamId}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">— 整个班组 —</option>
              {teamMembersQ.data?.items.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.phone}){m.roleInTeam === 'leader' ? ' · 组长' : ''}
                </option>
              ))}
            </select>
            {teamId &&
            !teamMembersQ.isLoading &&
            (teamMembersQ.data?.items.length ?? 0) === 0 ? (
              <p className="mt-1 text-xs text-amber-600">
                该班组暂无成员，请先在班组管理处添加
              </p>
            ) : null}
          </div>

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!teamId || selectedDeviceIds.length === 0}
            loading={assign.isPending}
            onClick={() => {
              setError(null);
              assign.mutate();
            }}
          >
            确认分配
          </Button>
        </div>
      </div>
    </div>
  );
}
