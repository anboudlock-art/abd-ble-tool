'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiRequest, ApiClientError, type CompanyListResp, type ShipResponse } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface Props {
  selectedDeviceIds: string[];
  onClose: () => void;
  onShipped: () => void;
}

export function ShipDialog({ selectedDeviceIds, onClose, onShipped }: Props) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string>('');
  const [shipmentNo, setShipmentNo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const companiesQ = useQuery({
    queryKey: ['companies', { all: true }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', { query: { pageSize: 200 } }),
  });

  const ship = useMutation({
    mutationFn: () =>
      apiRequest<ShipResponse>('/api/v1/devices/ship', {
        method: 'POST',
        body: {
          deviceIds: selectedDeviceIds.map((s) => Number(s)),
          toCompanyId: Number(companyId),
          shipmentNo: shipmentNo || undefined,
          reason: reason || undefined,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      onShipped();
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.body.message : '发货失败'),
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
          <h2 className="text-base font-semibold">发货到客户公司</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            将 <span className="font-semibold text-slate-900">{selectedDeviceIds.length}</span>{' '}
            台设备发货
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              目标公司
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— 选择公司 —</option>
              {companiesQ.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.shortCode ? ` (${c.shortCode})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              发货单号（选填）
            </label>
            <Input value={shipmentNo} onChange={(e) => setShipmentNo(e.target.value)} placeholder="SHIP-20260425-001" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              备注（选填）
            </label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
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
            disabled={!companyId || selectedDeviceIds.length === 0}
            loading={ship.isPending}
            onClick={() => {
              setError(null);
              ship.mutate();
            }}
          >
            确认发货
          </Button>
        </div>
      </div>
    </div>
  );
}
