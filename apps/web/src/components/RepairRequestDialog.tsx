'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiRequest, ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface FaultCategory {
  id: string;
  label: string;
  displayOrder: number;
}

interface Props {
  deviceId: string;
  lockId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

/**
 * v2.8.1 Task 6 — customer-facing 报修 form. Pulls fault categories
 * from /fault-categories and posts to /devices/:id/repair-intake. The
 * device flips to status='repairing' and shows up in the customer's
 * 维修中库 view (auto-scoped per role).
 */
export function RepairRequestDialog({
  deviceId,
  lockId,
  onClose,
  onSubmitted,
}: Props) {
  const qc = useQueryClient();
  const [faultCategoryId, setFaultCategoryId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const categoriesQ = useQuery({
    queryKey: ['fault-categories'],
    queryFn: () =>
      apiRequest<{ items: FaultCategory[] }>('/api/v1/fault-categories'),
  });

  const submit = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/devices/${deviceId}/repair-intake`, {
        method: 'POST',
        body: {
          faultCategoryId: Number(faultCategoryId),
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['device', deviceId] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['repairs'] });
      onSubmitted();
    },
    onError: (e) =>
      setError(e instanceof ApiClientError ? e.body.message : '报修失败'),
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
          <h3 className="text-base font-semibold">设备报修 · {lockId}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              故障类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={faultCategoryId}
              onChange={(e) => setFaultCategoryId(e.target.value)}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— 请选择 —</option>
              {categoriesQ.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {categoriesQ.isError ? (
              <p className="mt-1 text-xs text-red-500">
                故障分类加载失败，可手动联系厂商客服
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              备注 <span className="text-slate-400">(可选)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="描述故障细节、出现频率、复现步骤等"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          <p className="text-xs text-slate-400">
            提交后设备进入「维修中」状态。请将设备寄回厂商，厂商修好后
            将自动出库回到您的待移交区。
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!faultCategoryId}
            loading={submit.isPending}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
          >
            提交报修
          </Button>
        </div>
      </div>
    </div>
  );
}
