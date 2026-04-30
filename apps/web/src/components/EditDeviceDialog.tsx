'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { UpdateDeviceSchema, type UpdateDeviceInput } from '@abd/shared';
import { apiRequest, ApiClientError, type Device } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/providers/AuthProvider';

interface Props {
  device: Device;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Edit a device's mutable fields. Identity (lockId, bleMac) and lifecycle
 * (status, owner) are read-only here. Vendor-only fields (LoRa keys,
 * secure chip SN) are surfaced when caller is vendor_admin.
 */
export function EditDeviceDialog({ device, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const isVendor = me?.role === 'vendor_admin';
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateDeviceInput>({
    resolver: zodResolver(UpdateDeviceSchema),
    defaultValues: {
      imei: device.imei ?? undefined,
      firmwareVersion: device.firmwareVersion ?? undefined,
      hardwareVersion: device.hardwareVersion ?? undefined,
      doorLabel: device.doorLabel ?? undefined,
      notes: device.notes ?? undefined,
      iccid: device.iccid ?? undefined,
      fourgMac: device.fourgMac ?? undefined,
      loraE220Addr: device.loraE220Addr ?? undefined,
      loraChannel: device.loraChannel ?? undefined,
      loraDevAddr: device.loraDevAddr ?? undefined,
      loraDevEui: device.loraDevEui ?? undefined,
    },
  });

  const m = useMutation({
    mutationFn: (input: UpdateDeviceInput) =>
      apiRequest<Device>(`/api/v1/devices/${device.id}`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devices'] });
      void qc.invalidateQueries({ queryKey: ['device', device.id] });
      onSaved();
    },
    onError: (e) =>
      setServerError(e instanceof ApiClientError ? e.body.message : '保存失败'),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">
            编辑设备 · <span className="font-mono text-sm">{device.lockId}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            // Strip empty strings to undefined so server doesn't try to set ""
            const cleaned = Object.fromEntries(
              Object.entries(v).map(([k, val]) => [
                k,
                typeof val === 'string' && val.trim() === '' ? null : val,
              ]),
            );
            m.mutate(cleaned as UpdateDeviceInput);
          })}
          className="flex-1 space-y-3 overflow-y-auto px-5 py-5"
        >
          <div className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
            锁号 / BLE MAC 不可修改。状态需通过发货/签收/分配流转。
          </div>

          <Field label="门号 / 位置" error={errors.doorLabel?.message}>
            <Input {...register('doorLabel')} />
          </Field>

          <Field label="IMEI" error={errors.imei?.message}>
            <Input placeholder="15 位数字" {...register('imei')} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="固件版本" error={errors.firmwareVersion?.message}>
              <Input placeholder="V10.0" {...register('firmwareVersion')} />
            </Field>
            <Field label="硬件版本" error={errors.hardwareVersion?.message}>
              <Input placeholder="HW1.2" {...register('hardwareVersion')} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="ICCID" error={errors.iccid?.message}>
              <Input placeholder="19-20 位数字" {...register('iccid')} />
            </Field>
            <Field label="4G MAC" error={errors.fourgMac?.message}>
              <Input placeholder="AA:BB:CC:DD:EE:FF" {...register('fourgMac')} />
            </Field>
          </div>

          <div className="border-t pt-3 text-xs font-medium text-slate-500">
            LoRa
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="LoRa 地址" error={errors.loraE220Addr?.message}>
              <Input
                type="number"
                {...register('loraE220Addr', {
                  setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                })}
              />
            </Field>
            <Field label="LoRa 信道" error={errors.loraChannel?.message}>
              <Input
                type="number"
                {...register('loraChannel', {
                  setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="DevAddr (8 hex)" error={errors.loraDevAddr?.message}>
              <Input
                placeholder="DEADBEEF"
                {...register('loraDevAddr')}
                style={{ fontFamily: 'ui-monospace, monospace' }}
              />
            </Field>
            <Field label="DevEUI (16 hex)" error={errors.loraDevEui?.message}>
              <Input
                placeholder="0011223344556677"
                {...register('loraDevEui')}
                style={{ fontFamily: 'ui-monospace, monospace' }}
              />
            </Field>
          </div>

          {isVendor ? (
            <>
              <div className="border-t pt-3 text-xs font-medium text-slate-500">
                LoRa 密钥（仅厂商可见 / 可改）
              </div>
              <Field label="AppKey (32 hex)" error={errors.loraAppKey?.message}>
                <Input
                  placeholder="00000000000000000000000000000000"
                  {...register('loraAppKey')}
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="AppSKey" error={errors.loraAppSKey?.message}>
                  <Input
                    {...register('loraAppSKey')}
                    style={{ fontFamily: 'ui-monospace, monospace' }}
                  />
                </Field>
                <Field label="NwkSKey" error={errors.loraNwkSKey?.message}>
                  <Input
                    {...register('loraNwkSKey')}
                    style={{ fontFamily: 'ui-monospace, monospace' }}
                  />
                </Field>
              </div>
              <Field label="加密芯片 SN" error={errors.secureChipSn?.message}>
                <Input {...register('secureChipSn')} />
              </Field>
            </>
          ) : null}

          <Field label="备注" error={errors.notes?.message}>
            <Input {...register('notes')} />
          </Field>

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
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
