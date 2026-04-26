'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, X, Copy } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type IntegrationApp,
  type WebhookSubscription,
  type WebhookSubscriptionCreated,
} from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const ALL_EVENTS = [
  'lock.opened',
  'lock.closed',
  'lock.tampered',
  'lock.low_battery',
  'lock.offline',
  'lock.online',
  'device.delivered',
  'device.assigned',
  'command.acked',
  'command.timeout',
];

export default function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [revealed, setRevealed] = useState<WebhookSubscriptionCreated | null>(null);

  const appsQ = useQuery({
    queryKey: ['integrations', 'apps'],
    queryFn: () => apiRequest<{ items: IntegrationApp[] }>('/api/v1/integrations/apps'),
  });
  const app = appsQ.data?.items.find((a) => a.id === id);

  const subsQ = useQuery({
    queryKey: ['integrations', 'apps', id, 'webhooks'],
    queryFn: () =>
      apiRequest<{ items: WebhookSubscription[] }>(
        `/api/v1/integrations/apps/${id}/webhooks`,
      ),
  });

  const remove = useMutation({
    mutationFn: (subId: string) =>
      apiRequest(`/api/v1/integrations/webhooks/${subId}`, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['integrations', 'apps', id, 'webhooks'] }),
  });

  return (
    <div className="space-y-6">
      <Link
        href="/integrations"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={14} /> 返回应用列表
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{app?.name ?? '加载中…'}</h1>
        {app ? (
          <div className="mt-1 flex items-center gap-2">
            <code className="font-mono text-xs text-slate-500">{app.appKey}</code>
            <div className="flex gap-1">
              {app.scopes.map((s) => (
                <Badge key={s} tone="blue">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader
          title="Webhook 订阅"
          description="平台事件触发时，按 URL POST JSON，X-Abd-Signature 头携带 HMAC 签名"
          action={
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={14} /> 新建订阅
            </Button>
          }
        />
        {subsQ.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !subsQ.data?.items.length ? (
          <EmptyState message="暂无订阅" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>URL</Th>
                <Th>事件类型</Th>
                <Th>状态</Th>
                <Th>最近成功</Th>
                <Th>失败次数</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {subsQ.data.items.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-mono text-xs">{s.url}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {s.eventTypes.map((e) => (
                        <Badge key={e} tone="gray">
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={s.active ? 'green' : 'gray'}>
                      {s.active ? '启用' : '停用'}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString('zh-CN') : '—'}
                  </Td>
                  <Td>{s.failureCount}</Td>
                  <Td>
                    <button
                      onClick={() => {
                        if (confirm('删除该订阅？')) remove.mutate(s.id);
                      }}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {showAdd ? (
        <AddSubDialog
          appId={id}
          onClose={() => setShowAdd(false)}
          onCreated={(c) => {
            setShowAdd(false);
            setRevealed(c);
            void qc.invalidateQueries({ queryKey: ['integrations', 'apps', id, 'webhooks'] });
          }}
        />
      ) : null}

      {revealed ? <SecretReveal sub={revealed} onClose={() => setRevealed(null)} /> : null}
    </div>
  );
}

function AddSubDialog({
  appId,
  onClose,
  onCreated,
}: {
  appId: string;
  onClose: () => void;
  onCreated: (c: WebhookSubscriptionCreated) => void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(new Set(['lock.opened', 'lock.closed']));
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      apiRequest<WebhookSubscriptionCreated>(`/api/v1/integrations/apps/${appId}/webhooks`, {
        method: 'POST',
        body: { url, eventTypes: Array.from(events) },
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '创建失败'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">新建 Webhook 订阅</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">回调 URL</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-domain.com/abd-events" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">事件类型</label>
            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
              {ALL_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={events.has(e)}
                    onChange={(ev) => {
                      const next = new Set(events);
                      if (ev.target.checked) next.add(e);
                      else next.delete(e);
                      setEvents(next);
                    }}
                  />
                  <code className="text-xs">{e}</code>
                </label>
              ))}
            </div>
          </div>
          {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            disabled={!url.startsWith('http') || events.size === 0}
            loading={m.isPending}
            onClick={() => {
              setError(null);
              m.mutate();
            }}
          >
            创建
          </Button>
        </div>
      </div>
    </div>
  );
}

function SecretReveal({ sub, onClose }: { sub: WebhookSubscriptionCreated; onClose: () => void }) {
  const copy = (s: string) => navigator.clipboard?.writeText(s);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">订阅已创建</h2>
          <p className="mt-1 text-xs text-amber-600">
            ⚠️ Webhook Secret 仅本次显示，用于校验回调签名（HMAC-SHA256），请立即保存
          </p>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">URL</label>
            <code className="block rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs">
              {sub.url}
            </code>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Secret</label>
            <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
              <code className="flex-1 break-all font-mono text-xs">{sub.secret}</code>
              <button onClick={() => copy(sub.secret)} className="text-slate-500 hover:text-slate-900">
                <Copy size={14} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button onClick={onClose}>我已保存</Button>
        </div>
      </div>
    </div>
  );
}
