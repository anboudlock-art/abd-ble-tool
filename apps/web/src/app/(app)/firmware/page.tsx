'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Archive, CheckCircle2 } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type FirmwarePackage,
  type FirmwarePackageListResp,
  type DeviceModel,
} from '@/lib/api';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function statusTone(s: string): 'gray' | 'green' | 'amber' {
  return s === 'released' ? 'green' : s === 'archived' ? 'gray' : 'amber';
}

const statusLabel: Record<string, string> = {
  draft: '草稿',
  released: '已发布',
  archived: '已归档',
};

export default function FirmwarePage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [pushing, setPushing] = useState<FirmwarePackage | null>(null);
  const pageSize = 30;

  const q = useQuery({
    queryKey: ['firmware-packages', { page }],
    queryFn: () =>
      apiRequest<FirmwarePackageListResp>('/api/v1/firmware/packages', {
        query: { page, pageSize },
      }),
  });

  const release = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/firmware/packages/${id}/release`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['firmware-packages'] }),
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '发布失败'),
  });

  const archive = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/firmware/packages/${id}/archive`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['firmware-packages'] }),
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '归档失败'),
  });

  const data = q.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">固件 OTA</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} /> 新建固件包
        </Button>
      </div>

      <Card>
        <CardHeader title="固件版本" description="同型号同版本号唯一；先发布、后推送。" />
        {q.isLoading ? (
          <div className="px-6 py-8 text-sm text-slate-400">加载中…</div>
        ) : !data?.items.length ? (
          <EmptyState message="暂无固件包" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>版本</Th>
                <Th>型号</Th>
                <Th>大小</Th>
                <Th>SHA-256</Th>
                <Th>状态</Th>
                <Th>创建时间</Th>
                <Th>操作</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-mono text-sm">{p.version}</Td>
                  <Td>
                    <div className="text-sm">{p.modelName}</div>
                    <div className="font-mono text-xs text-slate-500">{p.modelCode}</div>
                  </Td>
                  <Td className="text-xs text-slate-600">
                    {(p.sizeBytes / 1024).toFixed(1)} KB
                  </Td>
                  <Td className="font-mono text-xs text-slate-500">
                    {p.sha256.slice(0, 12)}…
                  </Td>
                  <Td>
                    <Badge tone={statusTone(p.status)}>{statusLabel[p.status] ?? p.status}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {new Date(p.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {p.status === 'draft' ? (
                        <button
                          title="发布"
                          onClick={() => release.mutate(p.id)}
                          className="text-slate-400 hover:text-emerald-600"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                      ) : null}
                      {p.status === 'released' ? (
                        <button
                          title="推送到设备"
                          onClick={() => setPushing(p)}
                          className="text-slate-400 hover:text-sky-600"
                        >
                          <Send size={16} />
                        </button>
                      ) : null}
                      {p.status !== 'archived' ? (
                        <button
                          title="归档"
                          onClick={() => {
                            if (confirm(`归档版本 ${p.version} ?`)) archive.mutate(p.id);
                          }}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <Archive size={16} />
                        </button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {data && data.total > pageSize ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {creating ? (
        <CreatePackageDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['firmware-packages'] });
            setCreating(false);
          }}
        />
      ) : null}
      {pushing ? (
        <PushTaskDialog
          pkg={pushing}
          onClose={() => setPushing(null)}
          onSubmitted={() => {
            qc.invalidateQueries({ queryKey: ['firmware-packages'] });
            setPushing(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------- Create dialog ----------

function CreatePackageDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [modelId, setModelId] = useState('');
  const [version, setVersion] = useState('');
  const [url, setUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [sizeBytes, setSizeBytes] = useState('');
  const [changelog, setChangelog] = useState('');

  const models = useQuery({
    queryKey: ['device-models-for-firmware'],
    queryFn: () => apiRequest<{ items: DeviceModel[] }>('/api/v1/device-models'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiRequest('/api/v1/firmware/packages', {
        method: 'POST',
        body: {
          modelId: Number(modelId),
          version,
          url,
          sha256: sha256.toLowerCase(),
          sizeBytes: Number(sizeBytes),
          changelog: changelog || undefined,
        },
      }),
    onSuccess: onCreated,
    onError: (e) => alert(e instanceof ApiClientError ? e.body.message : '创建失败'),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">新建固件包</h3>
        </div>
        <div className="space-y-3 p-6">
          <div>
            <label className="mb-1 block text-xs text-slate-600">设备型号</label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">请选择型号</option>
              {models.data?.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-600">版本号</label>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="例: 1.2.3"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-600">下载 URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://oss.../firmware-1.2.3.bin"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-600">
              SHA-256 (64 位 16 进制)
            </label>
            <Input
              value={sha256}
              onChange={(e) => setSha256(e.target.value)}
              placeholder="abcdef0123…"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-600">文件大小 (字节)</label>
            <Input
              type="number"
              value={sizeBytes}
              onChange={(e) => setSizeBytes(e.target.value)}
              placeholder="例: 245760"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-600">更新说明 (可选)</label>
            <textarea
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              rows={3}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            loading={create.isPending}
            disabled={!modelId || !version || !url || !sha256 || !sizeBytes}
            onClick={() => create.mutate()}
          >
            创建
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Push dialog ----------

function PushTaskDialog({
  pkg,
  onClose,
  onSubmitted,
}: {
  pkg: FirmwarePackage;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [deviceIds, setDeviceIds] = useState('');

  const submit = useMutation({
    mutationFn: () => {
      const ids = deviceIds
        .split(/[\s,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length === 0) throw new Error('请至少输入 1 个设备 ID');
      return apiRequest<{ created: number; requested: number }>('/api/v1/firmware/tasks', {
        method: 'POST',
        body: { packageId: Number(pkg.id), deviceIds: ids },
      });
    },
    onSuccess: (resp) => {
      alert(`已下发 ${resp.created} / ${resp.requested} 个推送任务`);
      onSubmitted();
    },
    onError: (e) =>
      alert(e instanceof ApiClientError ? e.body.message : (e as Error).message),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">推送固件 v{pkg.version}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            目标型号：{pkg.modelName} ({pkg.modelCode})
          </p>
        </div>
        <div className="space-y-3 p-6">
          <div>
            <label className="mb-1 block text-xs text-slate-600">
              设备 ID（数字，按回车 / 空格 / 逗号分隔）
            </label>
            <textarea
              value={deviceIds}
              onChange={(e) => setDeviceIds(e.target.value)}
              rows={6}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs"
              placeholder="123\n124\n125"
            />
          </div>
          <p className="text-xs text-slate-400">
            仅同型号、且属于您可见公司的设备会被纳入；不匹配的会被一并拒绝。
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>
            下发推送
          </Button>
        </div>
      </div>
    </div>
  );
}
