import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const base =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'secondary' | 'outline'
}

export function Button({ variant = 'default', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        base,
        variant === 'ghost'
          ? 'border-transparent hover:bg-primary/10'
          : variant === 'secondary'
            ? 'border-border hover:bg-[color-mix(in_oklch,var(--foreground)_7%,transparent)]'
            : variant === 'outline'
              ? 'border-primary bg-transparent text-primary hover:bg-primary/10'
              : 'bg-primary text-primary-foreground hover:bg-primary/80',
        className,
      )}
      {...props}
    />
  )
}