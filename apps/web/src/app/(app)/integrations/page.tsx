'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X, Copy } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type IntegrationApp,
  type IntegrationAppCreated,
} from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const ALL_SCOPES = ['device:read', 'device:command', 'event:read', 'event:webhook'];

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<IntegrationAppCreated | null>(null);

  const q = useQuery({
    queryKey: ['integrations', 'apps'],
    queryFn: () => apiRequest<{ items: IntegrationApp[] }>('/api/v1/integrations/apps'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/integrations/apps/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'apps'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">对接 API</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} /> 新建 API 应用
        </Button>
      </div>

      <Card>
        <CardHeader title="已注册应用" description="App Key + Secret 用于 HMAC 签名访问 /openapi/v1/*" />
        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !q.data?.items.length ? (
          <EmptyState message="暂无应用" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>名称</Th>
                <Th>App Key</Th>
                <Th>权限</Th>
                <Th>Webhook</Th>
                <Th>状态</Th>
                <Th>创建时间</Th>
                <Th></Th>
              </Tr>
            </THead>
            <TBody>
              {q.data.items.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-medium">
                    <Link href={`/integrations/${a.id}`} className="text-sky-600 hover:underline">
                      {a.name}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs">{a.appKey}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {a.scopes.map((s) => (
                        <Badge key={s} tone="blue">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>{a.webhookCount}</Td>
                  <Td>
                    <Badge tone={a.status === 'active' ? 'green' : 'gray'}>{a.status}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {new Date(a.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <button
                      className="text-slate-400 hover:text-red-500"
                      onClick={() => {
                        if (confirm(`撤销 "${a.name}"？`)) revoke.mutate(a.id);
                      }}
                      title="撤销"
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

      {showCreate ? (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            setCreated(c);
            void qc.invalidateQueries({ queryKey: ['integrations', 'apps'] });
          }}
        />
      ) : null}

      {created ? <SecretRevealDialog created={created} onClose={() => setCreated(null)} /> : null}
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (a: IntegrationAppCreated) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set(['device:read', 'event:read']));
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      apiRequest<IntegrationAppCreated>('/api/v1/integrations/apps', {
        method: 'POST',
        body: { name, scopes: Array.from(scopes) },
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof ApiClientError ? e.body.message : '创建失败'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">新建 API 应用</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">应用名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：客户 WMS 系统" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">权限范围</label>
            <div className="space-y-1">
              {ALL_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scopes.has(s)}
                    onChange={(e) => {
                      const next = new Set(scopes);
                      if (e.target.checked) next.add(s);
                      else next.delete(s);
                      setScopes(next);
                    }}
                  />
                  <code className="text-xs">{s}</code>
                </label>
              ))}
            </div>
          </div>
          {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            disabled={!name.trim() || scopes.size === 0}
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

function SecretRevealDialog({ created, onClose }: { created: IntegrationAppCreated; onClose: () => void }) {
  const copy = (s: string) => navigator.clipboard?.writeText(s);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">应用已创建：{created.name}</h2>
          <p className="mt-1 text-xs text-amber-600">
            ⚠️ App Secret 仅本次显示，请立即保存到安全的地方
          </p>
        </div>
        <div className="space-y-4 px-5 py-5">
          <KvRow label="App Key" value={created.appKey} onCopy={copy} />
          <KvRow label="App Secret" value={created.appSecret} onCopy={copy} highlight />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button onClick={onClose}>我已保存</Button>
        </div>
      </div>
    </div>
  );
}

function KvRow({
  label,
  value,
  onCopy,
  highlight,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  highlight?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      <div
        className={
          'flex items-center gap-2 rounded border px-3 py-2 ' +
          (highlight ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50')
        }
      >
        <code className="flex-1 break-all font-mono text-xs">{value}</code>
        <button onClick={() => onCopy(value)} className="text-slate-500 hover:text-slate-900" title="复制">
          <Copy size={14} />
        </button>
      </div>
    </div>
  );
}
