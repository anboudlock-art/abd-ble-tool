'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiRequest, ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

interface Props {
  selectedDeviceIds: string[];
  onClose: () => void;
  onDelivered: () => void;
}

/**
 * Company admin confirms receipt of shipped devices.
 * Transitions each device: shipped → delivered.
 */
export function DeliverDialog({ selectedDeviceIds, onClose, onDelivered }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const deliver = useMutation({
    mutationFn: () =>
      apiRequest<{ deliveredCount: number; devices: Array<{ id: string; lockId: string; status: string }> }>(
        '/api/v1/devices/deliver',
        {
          method: 'POST',
          body: { deviceIds: selectedDeviceIds.map((s) => Number(s)) },
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      onDelivered();
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.body.message : '确认入库失败'),
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
          <h2 className="text-base font-semibold">确认设备入库</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-600">
            {selectedDeviceIds.length === 1
              ? '即将确认 1 台设备已验收，移入仓库。'
              : `即将确认 ${selectedDeviceIds.length} 台设备已验收，移入仓库。`}
          </p>

          {error ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button loading={deliver.isPending} onClick={() => deliver.mutate()}>
              确认入库
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
