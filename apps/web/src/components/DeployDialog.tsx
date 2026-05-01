'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiRequest, ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface Props {
  deviceId: string;
  initialDoorLabel?: string | null;
  onClose: () => void;
  onDeployed: () => void;
}

/**
 * Field deployment form — operator on-site marks where a device was installed.
 * GPS coords can be filled manually (numeric) or pulled from the browser via
 * navigator.geolocation. There is no map picker yet; we keep it simple so it
 * works on the operator's phone too.
 */
export function DeployDialog({ deviceId, initialDoorLabel, onClose, onDeployed }: Props) {
  const qc = useQueryClient();
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [accuracyM, setAccuracyM] = useState('');
  const [doorLabel, setDoorLabel] = useState(initialDoorLabel ?? '');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function locateMe() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('浏览器不支持地理定位');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        if (pos.coords.accuracy) setAccuracyM(Math.round(pos.coords.accuracy).toString());
        setLocating(false);
      },
      (err) => {
        setError(`定位失败：${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  const deploy = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/devices/${deviceId}/deploy`, {
        method: 'POST',
        body: {
          lat: Number(lat),
          lng: Number(lng),
          accuracyM: accuracyM ? Number(accuracyM) : undefined,
          doorLabel: doorLabel || undefined,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['device', deviceId] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
      onDeployed();
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.body.message : '部署失败'),
  });

  const valid =
    !!lat &&
    !!lng &&
    !Number.isNaN(Number(lat)) &&
    !Number.isNaN(Number(lng)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180;

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
          <h2 className="text-base font-semibold">现场部署</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">纬度</label>
              <Input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="如 23.1273"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">经度</label>
              <Input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="如 113.3528"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              loading={locating}
              onClick={locateMe}
              type="button"
            >
              使用当前位置
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">精度（米）</label>
              <Input
                value={accuracyM}
                onChange={(e) => setAccuracyM(e.target.value)}
                placeholder="可选"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">门号</label>
              <Input
                value={doorLabel}
                onChange={(e) => setDoorLabel(e.target.value)}
                placeholder="如 2 号门"
              />
            </div>
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
            disabled={!valid}
            loading={deploy.isPending}
            onClick={() => {
              setError(null);
              deploy.mutate();
            }}
          >
            确认部署
          </Button>
        </div>
      </div>
    </div>
  );
}
