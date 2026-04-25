import { clsx } from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        'block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm transition-colors',
        'focus:outline-none focus:ring-2',
        invalid
          ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
          : 'border-slate-300 focus:border-slate-500 focus:ring-slate-200',
        className,
      )}
      {...rest}
    />
  );
});
