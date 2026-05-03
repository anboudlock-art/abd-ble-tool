'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { CreateBatchSchema, type CreateBatchInput } from '@abd/shared';
import { apiRequest, ApiClientError, type DeviceModel, type ProductionBatch } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function NewBatchPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const modelsQ = useQuery({
    queryKey: ['device-models'],
    queryFn: () => apiRequest<{ items: DeviceModel[] }>('/api/v1/device-models'),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateBatchInput>({
    resolver: zodResolver(CreateBatchSchema),
    defaultValues: { batchNo: '', modelId: 0, quantity: 100 },
  });

  const createMut = useMutation({
    mutationFn: (input: CreateBatchInput) =>
      apiRequest<ProductionBatch>('/api/v1/production/batches', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (b) => router.push(`/batches/${b.id}`),
    onError: (err) => {
      setServerError(err instanceof ApiClientError ? err.body.message : '创建失败');
    },
  });

  return (
    <div className="space-y-6">
      <Link
        href="/batches"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={14} /> 返回批次列表
      </Link>

      <h1 className="text-2xl font-semibold text-slate-900">新建生产批次</h1>

      <Card className="max-w-xl">
        <CardHeader title="批次信息" />
        <CardBody>
          <form
            onSubmit={handleSubmit((v) => {
              setServerError(null);
              createMut.mutate(v);
            })}
            className="space-y-4"
          >
            <Field label="批号" error={errors.batchNo?.message} hint="如 B-2026-001（大写字母数字短横线）">
              <Input
                placeholder="B-2026-001"
                invalid={!!errors.batchNo}
                {...register('batchNo')}
              />
            </Field>

            <Field label="设备型号" error={errors.modelId?.message}>
              <select
                {...register('modelId', { valueAsNumber: true })}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value={0}>— 选择型号 —</option>
                {modelsQ.data?.items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="计划数量" error={errors.quantity?.message}>
              <Input
                type="number"
                min={1}
                invalid={!!errors.quantity}
                {...register('quantity', { valueAsNumber: true })}
              />
            </Field>

            <Field label="生产日期" error={errors.producedAt?.message}>
              <Input type="date" {...register('producedAt')} />
            </Field>

            <Field label="备注" error={errors.remark?.message}>
              <Input placeholder="可选" {...register('remark')} />
            </Field>

            {serverError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {serverError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/batches')}
              >
                取消
              </Button>
              <Button type="submit" loading={createMut.isPending}>
                创建批次
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
