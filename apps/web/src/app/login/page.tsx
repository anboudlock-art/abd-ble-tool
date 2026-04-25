'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@abd/shared';
import { useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiClientError } from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { phone: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.phone, values.password);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setServerError(err.body.message ?? '登录失败');
      } else {
        setServerError('网络错误，请稍后重试');
      }
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">登录</h1>
          <p className="mt-1 text-sm text-slate-500">
            Anboud 智能锁管理平台
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              手机号
            </label>
            <Input
              type="tel"
              autoComplete="username"
              placeholder="13800000000"
              invalid={!!errors.phone}
              {...register('phone')}
            />
            {errors.phone ? (
              <p className="mt-1 text-xs text-red-500">{errors.phone.message}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              密码
            </label>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="********"
              invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password ? (
              <p className="mt-1 text-xs text-red-500">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          {serverError ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {serverError}
            </div>
          ) : null}

          <Button type="submit" className="w-full" loading={isSubmitting}>
            登录
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          首次使用请联系管理员开通账号
        </p>
      </div>
    </main>
  );
}
