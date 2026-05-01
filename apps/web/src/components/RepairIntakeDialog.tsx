'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiRequest, ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface Props {
  deviceId: string;
  lockId: string;
  onClose: () => void;
  onIntake: () => void;
}

/** 退回维修弹窗 — 故障描述 + 备注. */
export function RepairIntakeDialog({ deviceId, lockId, onClose, onIntake }: Props) {
  const qc = useQueryClient();
  const [faultReason, setFaultReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const intake = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/devices/${deviceId}/repair-intake`, {
        method: 'POST',
        body: { faultReason, notes: notes || undefined },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['device', deviceId] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['repairs'] });
      onIntake();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '退修失败'),
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
          <h3 className="text-base font-semibold">退回维修 · 锁号 {lockId}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              故障原因 <span className="text-red-500">*</span>
            </label>
            <Input
              value={faultReason}
              onChange={(e) => setFaultReason(e.target.value)}
              placeholder="例如：4G 模块无响应 / 锁体卡死 / 电池虚焊"
              maxLength={255}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
          <p className="text-xs text-slate-400">
            退修后设备状态变为「维修中」，从在用 / 在库列表中隐藏；
            维修完成后可恢复到入修前状态或报废。
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!faultReason.trim()}
            loading={intake.isPending}
            onClick={() => {
              setError(null);
              intake.mutate();
            }}
          >
            确认退修
          </Button>
        </div>
      </div>
    </div>
  );
}
