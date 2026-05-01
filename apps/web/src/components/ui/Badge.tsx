import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-sky-100 text-sky-700',
  purple: 'bg-violet-100 text-violet-700',
};

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'gray', className, ...rest }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}

export function deviceStatusTone(status: string): Tone {
  switch (status) {
    case 'manufactured':
      return 'gray';
    case 'in_warehouse':
      return 'blue';
    case 'shipped':
      return 'amber';
    case 'delivered':
      return 'purple';
    case 'assigned':
      return 'purple';
    case 'active':
      return 'green';
    case 'repairing':
      return 'amber';
    case 'returned':
      return 'amber';
    case 'retired':
      return 'red';
    default:
      return 'gray';
  }
}

export const deviceStatusLabel: Record<string, string> = {
  manufactured: '已下线',
  in_warehouse: '已入库',
  shipped: '已发货',
  delivered: '已签收',
  assigned: '已分配',
  active: '在用',
  repairing: '维修中',
  returned: '已回收',
  retired: '已报废',
};
