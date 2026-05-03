'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { CreateTestDeviceSchema, type CreateTestDeviceInput } from '@abd/shared';
import {
  apiRequest,
  ApiClientError,
  type CompanyListResp,
  type DeviceModel,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface Props {
  onClose: () => void;
  onCreated: (deviceId: string) => void;
}

/**
 * Test-mode device creation. Skips the production-scan / batch /
 * ship / deliver / assign workflow and lands a device directly in
 * `active` so you can immediately exercise BLE / LoRa / remote
 * commands. Vendor-admin only.
 */
export function TestDeviceDialog({ onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const modelsQ = useQuery({
    queryKey: ['device-models'],
    queryFn: () => apiRequest<{ items: DeviceModel[] }>('/api/v1/device-models'),
  });
  const companiesQ = useQuery({
    queryKey: ['companies', { all: true }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', { query: { pageSize: 100 } }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<CreateTestDeviceInput>({
    resolver: zodResolver(CreateTestDeviceSchema),
    defaultValues: {
      lockId: '',
      bleMac: '',
      modelId: 0,
      activate: true,
    },
  });
  const modelId = watch('modelId');
  const activate = watch('activate');

  const m = useMutation({
    mutationFn: (input: CreateTestDeviceInput) =>
      apiRequest<{ id: string; lockId: string; status: string }>(
        '/api/v1/devices/test-create',
        { method: 'POST', body: input },
      ),
    onSuccess: (resp) => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      onCreated(resp.id);
    },
    onError: (e) =>
      setServerError(e instanceof ApiClientError ? e.body.message : '创建失败'),
  });

  const selectedModel = modelsQ.data?.items.find((mm) => mm.id === String(modelId));
  const showLora = selectedModel?.hasLora === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">添加测试设备</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            const cleaned: CreateTestDeviceInput = {
              ...v,
              bleMac: v.bleMac.toUpperCase(),
              imei: v.imei?.trim() || undefined,
              firmwareVersion: v.firmwareVersion?.trim() || undefined,
              doorLabel: v.doorLabel?.trim() || undefined,
              modelId: Number(v.modelId),
              ownerCompanyId: v.ownerCompanyId ? Number(v.ownerCompanyId) : undefined,
              gatewayId: v.gatewayId ? Number(v.gatewayId) : undefined,
              loraE220Addr: v.loraE220Addr ? Number(v.loraE220Addr) : undefined,
              loraChannel: v.loraChannel ? Number(v.loraChannel) : undefined,
            };
            m.mutate(cleaned);
          })}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
          <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ 测试模式：跳过批次/发货/签收/分配，设备直接落到所选公司并激活，仅供调试用。生产线上请用 <code>手动登记</code> 或 Android APP 扫码。
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">设备型号</label>
            <select
              {...register('modelId', { valueAsNumber: true })}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value={0}>— 选择型号 —</option>
              {modelsQ.data?.items.map((mm) => (
                <option key={mm.id} value={mm.id}>
                  {mm.code} · {mm.name}
                </option>
              ))}
            </select>
            {errors.modelId ? (
              <p className="mt-1 text-xs text-red-500">{errors.modelId.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">锁号 (8 位)</label>
            <Input placeholder="60806001" invalid={!!errors.lockId} {...register('lockId')} />
            {errors.lockId ? (
              <p className="mt-1 text-xs text-red-500">{errors.lockId.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">BLE MAC</label>
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
            <label className="mb-1 block text-xs font-medium text-slate-700">IMEI (可选)</label>
            <Input invalid={!!errors.imei} {...register('imei')} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">固件版本</label>
            <Input placeholder="V10.0" {...register('firmwareVersion')} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">归属公司 (可选，留空=厂商)</label>
            <select
              {...register('ownerCompanyId', { setValueAs: (v) => (v ? Number(v) : undefined) })}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— 厂商自留 —</option>
              {companiesQ.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">门号/位置 (可选)</label>
            <Input placeholder="如：测试-机房A东门" {...register('doorLabel')} />
          </div>

          {showLora ? (
            <div className="space-y-4 rounded border border-sky-200 bg-sky-50 p-3">
              <div className="text-xs font-medium text-sky-800">
                LoRa 路由 (用于测试远程开/关锁)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-700">LoRa 地址</label>
                  <Input
                    type="number"
                    placeholder="8"
                    {...register('loraE220Addr', { setValueAs: (v) => (v ? Number(v) : undefined) })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-700">LoRa 信道</label>
                  <Input
                    type="number"
                    placeholder="6"
                    {...register('loraChannel', { setValueAs: (v) => (v ? Number(v) : undefined) })}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-700">关联网关 ID (可选)</label>
                <Input
                  type="number"
                  placeholder="例如 1"
                  {...register('gatewayId', { setValueAs: (v) => (v ? Number(v) : undefined) })}
                />
                <p className="mt-1 text-xs text-slate-500">
                  关联后才能在设备详情页测试远程开/关锁；网关需为 active+online
                </p>
              </div>
            </div>
          ) : null}

          <div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register('activate')} />
              <span>立即激活（跳到 active 状态）</span>
            </label>
            {!activate ? (
              <p className="mt-1 text-xs text-amber-600">
                未勾选时设备状态为 <code>已入库</code>；后续仍需走发货/签收/分配才能远程控制
              </p>
            ) : null}
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
              创建
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
