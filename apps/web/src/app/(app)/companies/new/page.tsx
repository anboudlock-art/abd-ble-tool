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

interface CreatedCompanyResp {
  id: string;
  name: string;
  shortCode: string | null;
  adminAccount: {
    id: string;
    name: string;
    phone: string;
    initialPassword: string;
  } | null;
}

export default function NewCompanyPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCompanyResp | null>(null);

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
      apiRequest<CreatedCompanyResp>('/api/v1/companies', { method: 'POST', body: input }),
    onSuccess: (c) => {
      // If we created an admin too, show the credentials before navigating
      // away — the password is shown ONCE and never again.
      if (c.adminAccount) setCreated(c);
      else router.push(`/companies/${c.id}`);
    },
    onError: (err) => setServerError(err instanceof ApiClientError ? err.body.message : '创建失败'),
  });

  if (created?.adminAccount) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">公司已创建</h1>
        <Card className="max-w-xl border-amber-300">
          <CardHeader
            title="管理员账户(请复制，密码只显示一次)"
            description="把以下信息发给客户。客户首次登录会被强制改密。"
          />
          <CardBody className="space-y-3">
            <Field label="公司"><div>{created.name}</div></Field>
            <Field label="管理员姓名"><div>{created.adminAccount.name}</div></Field>
            <Field label="登录手机号">
              <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm">
                {created.adminAccount.phone}
              </code>
            </Field>
            <Field label="临时密码">
              <code className="rounded bg-amber-100 px-2 py-1 font-mono text-sm text-amber-800">
                {created.adminAccount.initialPassword}
              </code>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => router.push(`/companies/${created.id}`)}>
                进入公司详情
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

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

            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="mb-3 text-xs font-medium text-amber-800">
                顺便创建公司管理员账号(可选,留空则不创建,客户后续无法登录)
              </p>
              <div className="space-y-3">
                <Field label="管理员手机号" error={errors.adminPhone?.message}>
                  <Input
                    invalid={!!errors.adminPhone}
                    placeholder="13800000000"
                    {...register('adminPhone')}
                  />
                </Field>
                <Field label="管理员姓名" error={errors.adminName?.message}>
                  <Input invalid={!!errors.adminName} {...register('adminName')} />
                </Field>
                <Field
                  label="管理员密码"
                  hint="留空则系统自动生成临时密码,管理员首次登录强制修改"
                  error={errors.adminPassword?.message}
                >
                  <Input
                    type="text"
                    invalid={!!errors.adminPassword}
                    {...register('adminPassword')}
                  />
                </Field>
              </div>
            </div>

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
