'use client';

import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

interface Props {
  lat: number | null | undefined;
  lng: number | null | undefined;
  doorLabel?: string | null;
}

/**
 * Render a small AMap (高德) embed when both NEXT_PUBLIC_AMAP_KEY and a
 * coordinate are available; otherwise fall back to plain text + a click-
 * through link that opens the location in 高德 / amap.com.
 *
 * AMap's free embed is plain HTML/CSS — no JS SDK needed for a simple
 * marker view. We use the static URL form: `uri.amap.com/marker?...` and
 * display it in an iframe.
 */
export function DeviceMap({ lat, lng, doorLabel }: Props) {
  if (lat == null || lng == null) {
    return (
      <Card>
        <CardHeader title="位置" />
        <CardBody className="text-sm text-slate-400">设备尚未上报位置</CardBody>
      </Card>
    );
  }

  const amapKey = process.env.NEXT_PUBLIC_AMAP_KEY;
  // uri.amap.com works without a key for end-user redirects (used in fallback)
  const amapUrl = `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(doorLabel ?? '设备位置')}`;

  // For an embedded iframe map you need an API key. Without one, we surface
  // a plain card with the click-through plus a static raster preview.
  const tilesUrl = amapKey
    ? `https://m.amap.com/picker/?keywords=${encodeURIComponent(doorLabel ?? '')}&center=${lng},${lat}&zoom=16&radius=1000&key=${amapKey}`
    : null;

  return (
    <Card>
      <CardHeader
        title="位置"
        description={`经度 ${lng.toFixed(6)} · 纬度 ${lat.toFixed(6)}`}
        action={
          <Link
            href={amapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-600 hover:underline"
          >
            在高德地图打开 →
          </Link>
        }
      />
      <CardBody className="p-0">
        {tilesUrl ? (
          <iframe
            src={tilesUrl}
            title="设备位置"
            loading="lazy"
            className="block h-72 w-full border-0"
          />
        ) : (
          <div className="px-6 py-4 text-xs text-slate-500">
            未配置 NEXT_PUBLIC_AMAP_KEY，无法内嵌地图。点击右上角"在高德地图打开"查看。
          </div>
        )}
      </CardBody>
    </Card>
  );
}
