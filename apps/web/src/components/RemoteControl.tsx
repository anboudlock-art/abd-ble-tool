'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import {
  apiRequest,
  ApiClientError,
  type Device,
  type DeviceCommand,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, Tr, Th, Td, EmptyState } from '@/components/ui/Table';

interface Props {
  device: Device;
}

const commandTypeLabel: Record<string, string> = {
  unlock: '远程开锁',
  lock: '远程关锁',
  query_status: '查询状态',
};

function commandStatusTone(s: DeviceCommand['status']) {
  switch (s) {
    case 'pending':
    case 'sent':
      return 'amber' as const;
    case 'acked':
      return 'green' as const;
    case 'timeout':
    case 'failed':
      return 'red' as const;
  }
}

export function RemoteControl({ device }: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const supports =
    device.model && device.status &&
    !!device.model.code; // any non-eseal will return correct error from server otherwise

  const isControllable =
    (device.status === 'active' || device.status === 'assigned') && supports;

  const cmdsQ = useQuery({
    queryKey: ['device', device.id, 'commands'],
    queryFn: () =>
      apiRequest<{ items: DeviceCommand[] }>(`/api/v1/devices/${device.id}/commands`),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasPending = items.some(
        (c) => c.status === 'pending' || c.status === 'sent',
      );
      return hasPending ? 1500 : false;
    },
  });

  const issue = useMutation({
    mutationFn: (commandType: 'unlock' | 'lock') =>
      apiRequest<{ commandId: string; status: string }>(
        `/api/v1/devices/${device.id}/commands`,
        { method: 'POST', body: { commandType } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['device', device.id, 'commands'] });
      void qc.invalidateQueries({ queryKey: ['device', device.id] });
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.body.message : '下发失败'),
  });

  // v2.8.1: prompt text picks "LoRa 网关" or "4G 联网" by what the
  // model actually carries. eseal (BLE only) gets a clearer message
  // pointing the operator to the BLE flow on the APP.
  const transport = device.model?.hasLora
    ? 'LoRa 网关'
    : device.model?.has4g
      ? '4G 联网'
      : 'BLE 直连';
  const remoteCapable = !!(device.model?.hasLora || device.model?.has4g);

  return (
    <Card>
      <CardHeader
        title="远程控制"
        description={
          isControllable
            ? `指令通过 ${transport} 下发，10 秒内未收到状态变化视为超时`
            : remoteCapable
              ? `设备需在 assigned/active 状态且通过 ${transport} 才能远程控制`
              : 'BLE-only 型号不支持后台远程开锁，请到 APP 端连接锁后操作'
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={!isControllable || issue.isPending}
            loading={issue.isPending && issue.variables === 'unlock'}
            onClick={() => {
              setError(null);
              issue.mutate('unlock');
            }}
          >
            <LockOpen size={14} /> 远程开锁
          </Button>
          <Button
            variant="secondary"
            disabled={!isControllable || issue.isPending}
            loading={issue.isPending && issue.variables === 'lock'}
            onClick={() => {
              setError(null);
              issue.mutate('lock');
            }}
          >
            <Lock size={14} /> 远程关锁
          </Button>
        </div>
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            指令历史
          </div>
          {cmdsQ.isLoading ? (
            <div className="text-sm text-slate-400">加载中…</div>
          ) : !cmdsQ.data?.items.length ? (
            <EmptyState message="暂无指令" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>时间</Th>
                  <Th>指令</Th>
                  <Th>状态</Th>
                  <Th>下发</Th>
                  <Th>响应</Th>
                  <Th>错误</Th>
                </Tr>
              </THead>
              <TBody>
                {cmdsQ.data.items.map((c) => (
                  <Tr key={c.id}>
                    <Td className="text-xs text-slate-500">
                      {new Date(c.createdAt).toLocaleString('zh-CN')}
                    </Td>
                    <Td>{commandTypeLabel[c.commandType] ?? c.commandType}</Td>
                    <Td>
                      <Badge tone={commandStatusTone(c.status)}>{c.status}</Badge>
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {c.sentAt ? new Date(c.sentAt).toLocaleTimeString('zh-CN') : '—'}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {c.ackedAt ? new Date(c.ackedAt).toLocaleTimeString('zh-CN') : '—'}
                    </Td>
                    <Td className="text-xs text-red-500">{c.errorMessage ?? '—'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
