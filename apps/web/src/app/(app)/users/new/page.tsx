'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { CreateUserSchema, type CreateUserInput } from '@abd/shared';
import { apiRequest, ApiClientError, type CompanyListResp } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function NewUserPage() {
  return (
    <Suspense>
      <Body />
    </Suspense>
  );
}

function Body() {
  const router = useRouter();
  const search = useSearchParams();
  const presetCompany = search?.get('companyId') ?? '';
  const [serverError, setServerError] = useState<string | null>(null);

  const companiesQ = useQuery({
    queryKey: ['companies', { all: true }],
    queryFn: () =>
      apiRequest<CompanyListResp>('/api/v1/companies', { query: { pageSize: 200 } }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: {
      role: 'member',
      companyId: presetCompany ? Number(presetCompany) : undefined,
      phone: '',
      name: '',
    },
  });

  const [revealed, setRevealed] = useState<{
    name: string;
    phone: string;
    initialPassword: string;
  } | null>(null);

  const m = useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiRequest<{
        id: string;
        name: string;
        phone: string;
        initialPassword: string;
      }>('/api/v1/users', { method: 'POST', body: input }),
    onSuccess: (resp) => {
      setRevealed({
        name: resp.name,
        phone: resp.phone,
        initialPassword: resp.initialPassword,
      });
    },
    onError: (err) => setServerError(err instanceof ApiClientError ? err.body.message : '创建失败'),
  });

  return (
    <div className="space-y-6">
      <Link
        href={presetCompany ? `/companies/${presetCompany}` : '/users'}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={14} /> 返回
      </Link>

      <h1 className="text-2xl font-semibold text-slate-900">新建人员</h1>

      <Card className="max-w-xl">
        <CardHeader title="基本信息" />
        <CardBody>
          <form
            onSubmit={handleSubmit((v) => {
              setServerError(null);
              const cleaned = {
                ...v,
                companyId: v.companyId ? Number(v.companyId) : undefined,
                teamId: v.teamId ? Number(v.teamId) : undefined,
              };
              m.mutate(cleaned);
            })}
            className="space-y-4"
          >
            <Field label="所属公司" error={errors.companyId?.message}>
              <select
                {...register('companyId', {
                  setValueAs: (v) => (v ? Number(v) : undefined),
                })}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— 选择公司（厂商员工留空） —</option>
                {companiesQ.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="姓名" error={errors.name?.message}>
              <Input invalid={!!errors.name} {...register('name')} />
            </Field>

            <Field label="手机号" error={errors.phone?.message}>
              <Input invalid={!!errors.phone} placeholder="13800000000" {...register('phone')} />
            </Field>

            <Field label="角色" error={errors.role?.message}>
              <select
                {...register('role')}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="company_admin">公司管理员</option>
                <option value="dept_admin">部门管理员</option>
                <option value="team_leader">班组长</option>
                <option value="member">成员</option>
                <option value="production_operator">生产操作员</option>
                <option value="vendor_admin">厂商管理员</option>
              </select>
            </Field>

            <Field label="工号" error={errors.employeeNo?.message}>
              <Input {...register('employeeNo')} />
            </Field>

            <Field
              label="初始密码（可选）"
              hint="留空则系统自动生成。用户首次登录后必须修改，临时密码失效。"
              error={errors.initialPassword?.message}
            >
              <Input type="text" invalid={!!errors.initialPassword} {...register('initialPassword')} />
            </Field>

            {serverError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {serverError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                取消
              </Button>
              <Button type="submit" loading={m.isPending}>
                创建
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {revealed ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-base font-semibold">用户已创建：{revealed.name}</h2>
              <p className="mt-1 text-xs text-amber-600">
                ⚠️ 初始密码仅本次显示，请告知用户并提示首次登录后必须修改
              </p>
            </div>
            <div className="space-y-3 px-5 py-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">手机号</label>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm">
                  {revealed.phone}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">初始密码</label>
                <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
                  <code className="flex-1 break-all font-mono text-sm">
                    {revealed.initialPassword}
                  </code>
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(revealed.initialPassword)
                    }
                    className="text-slate-500 hover:text-slate-900"
                    title="复制"
                  >
                    复制
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <Button
                onClick={() => {
                  setRevealed(null);
                  if (presetCompany) router.push(`/companies/${presetCompany}`);
                  else router.push('/users');
                }}
              >
                我已记下
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
