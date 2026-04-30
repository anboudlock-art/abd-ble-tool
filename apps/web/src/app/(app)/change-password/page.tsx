'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, type ChangePasswordInput } from '@abd/shared';
import { apiRequest, ApiClientError } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, refresh, logout } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: { oldPassword: '', newPassword: '' },
  });

  const m = useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiRequest('/api/v1/auth/change-password', { method: 'POST', body: input }),
    onSuccess: async () => {
      await refresh();
      router.replace('/devices');
    },
    onError: (err) =>
      setServerError(err instanceof ApiClientError ? err.body.message : '修改失败'),
  });

  const forced = user?.mustChangePassword === true;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">修改密码</h1>
      {forced ? (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          首次登录或管理员重置后必须修改密码
        </p>
      ) : null}

      <Card>
        <CardHeader title={`账号: ${user?.phone ?? ''}`} />
        <CardBody>
          <form
            onSubmit={handleSubmit((v) => {
              setServerError(null);
              m.mutate(v);
            })}
            className="space-y-4"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                {forced ? '初始/临时密码' : '当前密码'}
              </label>
              <Input
                type="password"
                autoComplete="current-password"
                invalid={!!errors.oldPassword}
                {...register('oldPassword')}
              />
              {errors.oldPassword ? (
                <p className="mt-1 text-xs text-red-500">{errors.oldPassword.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">新密码</label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="至少 6 位"
                invalid={!!errors.newPassword}
                {...register('newPassword')}
              />
              {errors.newPassword ? (
                <p className="mt-1 text-xs text-red-500">{errors.newPassword.message}</p>
              ) : null}
            </div>

            {serverError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {serverError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              {!forced ? (
                <Button type="button" variant="ghost" onClick={() => router.back()}>
                  取消
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => logout()}>
                  退出登录
                </Button>
              )}
              <Button type="submit" loading={m.isPending}>
                修改并继续
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
