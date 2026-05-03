'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { ProductionScanSchema, type ProductionScanInput } from '@abd/shared';
import {
  apiRequest,
  ApiClientError,
  type BatchListResp,
  type ProductionBatch,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface Props {
  onClose: () => void;
  onRegistered: () => void;
}

/**
 * Manual device registration. Internally calls POST /production/scans
 * so the resulting device gets the same production_scan + transfer
 * audit rows as one captured by the Android factory APP.
 */
export function ManualRegisterDialog({ onClose, onRegistered }: Props) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const batchesQ = useQuery({
    queryKey: ['batches', { all: true }],
    queryFn: () =>
      apiRequest<BatchListResp>('/api/v1/production/batches', {
        query: { pageSize: 100 },
      }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<ProductionScanInput>({
    resolver: zodResolver(ProductionScanSchema),
    defaultValues: {
      batchId: 0,
      lockId: '',
      bleMac: '',
      qcResult: 'passed',
    },
  });
  const batchId = watch('batchId');

  const m = useMutation({
    mutationFn: (input: ProductionScanInput) =>
      apiRequest<{ scanId: string; firstScan: boolean; device: { id: string } }>(
        '/api/v1/production/scans',
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['batches'] });
      onRegistered();
    },
    onError: (err) =>
      setServerError(err instanceof ApiClientError ? err.body.message : '登记失败'),
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    const cleaned: ProductionScanInput = {
      ...values,
      bleMac: values.bleMac.toUpperCase(),
      imei: values.imei?.trim() || undefined,
      firmwareVersion: values.firmwareVersion?.trim() || undefined,
      qcRemark: values.qcRemark?.trim() || undefined,
    };
    m.mutate(cleaned);
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
          <h2 className="text-base font-semibold">手动登记设备</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">所属批次</label>
            <select
              value={batchId || ''}
              onChange={(e) => setValue('batchId', Number(e.target.value))}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— 选择批次 —</option>
              {batchesQ.data?.items.map((b: ProductionBatch) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} · {b.modelCode ?? ''}
                </option>
              ))}
            </select>
            {errors.batchId ? (
              <p className="mt-1 text-xs text-red-500">{errors.batchId.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              锁号 (8 位 QR 码)
            </label>
            <Input
              placeholder="60806001"
              invalid={!!errors.lockId}
              {...register('lockId')}
            />
            {errors.lockId ? (
              <p className="mt-1 text-xs text-red-500">{errors.lockId.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              BLE MAC
            </label>
            <Input
              placeholder="E1:6A:9C:F1:F8:7E"
              invalid={!!errors.bleMac}
              {...register('bleMac')}
            />
            {errors.bleMac ? (
              <p className="mt-1 text-xs text-red-500">{errors.bleMac.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              IMEI (可选)
            </label>
            <Input
              placeholder="860041068503363"
              invalid={!!errors.imei}
              {...register('imei')}
            />
            <p className="mt-1 text-xs text-slate-400">仅 4G/GPS 锁需要，电子铅封留空</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              固件版本 (可选)
            </label>
            <Input placeholder="V10.0" {...register('firmwareVersion')} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">质检</label>
            <select
              {...register('qcResult')}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="passed">通过</option>
              <option value="failed">未通过</option>
              <option value="pending">待检</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              备注 (可选)
            </label>
            <Input placeholder="如：手动补录，无 IMEI" {...register('qcRemark')} />
          </div>

          {serverError ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {serverError}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={m.isPending}>
              登记
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
