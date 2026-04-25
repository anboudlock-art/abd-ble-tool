'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { CreateCompanySchema, type CreateCompanyInput } from '@abd/shared';
import { apiRequest, ApiClientError } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function NewCompanyPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateCompanyInput>({
    resolver: zodResolver(CreateCompanySchema),
    defaultValues: { name: '', industry: 'security' },
  });

  const m = useMutation({
    mutationFn: (input: CreateCompanyInput) =>
      apiRequest<{ id: string }>('/api/v1/companies', { method: 'POST', body: input }),
    onSuccess: (c) => router.push(`/companies/${c.id}`),
    onError: (err) => setServerError(err instanceof ApiClientError ? err.body.message : '创建失败'),
  });

  return (
    <div className="space-y-6">
      <Link href="/companies" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft size={14} /> 返回公司列表
      </Link>

      <h1 className="text-2xl font-semibold text-slate-900">新建客户公司</h1>

      <Card className="max-w-xl">
        <CardHeader title="基本信息" />
        <CardBody>
          <form
            onSubmit={handleSubmit((v) => {
              setServerError(null);
              m.mutate(v);
            })}
            className="space-y-4"
          >
            <Field label="公司名称" error={errors.name?.message}>
              <Input invalid={!!errors.name} {...register('name')} />
            </Field>
            <Field label="短编码" hint="对接 API 用，小写字母数字下划线" error={errors.shortCode?.message}>
              <Input invalid={!!errors.shortCode} placeholder="cust-a" {...register('shortCode')} />
            </Field>
            <Field label="行业" error={errors.industry?.message}>
              <select
                {...register('industry')}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="security">安防监管</option>
                <option value="logistics">物流</option>
                <option value="other">其它</option>
              </select>
            </Field>
            <Field label="联系人" error={errors.contactName?.message}>
              <Input {...register('contactName')} />
            </Field>
            <Field label="联系电话" error={errors.contactPhone?.message}>
              <Input invalid={!!errors.contactPhone} {...register('contactPhone')} />
            </Field>

            {serverError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {serverError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => router.push('/companies')}>
                取消
              </Button>
              <Button type="submit" loading={m.isPending}>创建</Button>
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
