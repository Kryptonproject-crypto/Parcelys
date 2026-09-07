import type {
  ReactNode,
  Ref,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import Link from 'next/link';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition ' +
  'disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-champ-600 text-white hover:bg-champ-700 active:bg-champ-800 shadow-sm',
  secondary: 'bg-ardoise-100 text-ardoise-800 hover:bg-ardoise-200',
  ghost: 'text-ardoise-700 hover:bg-ardoise-100',
  danger: 'bg-brique-500 text-white hover:bg-brique-600 shadow-sm',
  outline: 'border border-ardoise-300 bg-white text-ardoise-800 hover:bg-ardoise-50',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
  target?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...rest}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Cartes & conteneurs
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-ardoise-200 bg-white shadow-[0_1px_2px_rgba(31,42,28,0.04)]',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ardoise-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-ardoise-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  href,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  href?: string;
}) {
  const content = (
    <div className="flex items-start gap-3">
      {icon ? (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-champ-50 text-lg">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ardoise-500">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold leading-none text-ardoise-900">
          {value}
          {unit ? (
            <span className="ml-1 text-sm font-normal text-ardoise-500">{unit}</span>
          ) : null}
        </p>
        {hint ? <p className="mt-1 truncate text-xs text-ardoise-500">{hint}</p> : null}
      </div>
    </div>
  );

  const className =
    'block rounded-xl border border-ardoise-200 bg-white p-4 shadow-[0_1px_2px_rgba(31,42,28,0.04)] transition';

  return href ? (
    <Link href={href} className={cn(className, 'hover:border-champ-300 hover:shadow-md')}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

// ---------------------------------------------------------------------------
// Badges & états
// ---------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ardoise-100 text-ardoise-700',
  green: 'bg-champ-100 text-champ-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-brique-100 text-brique-600',
  blue: 'bg-ciel-100 text-ciel-600',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon = '🌾',
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ardoise-300 bg-white/60 px-6 py-12 text-center">
      <span className="mb-3 text-3xl">{icon}</span>
      <h3 className="text-base font-semibold text-ardoise-800">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-ardoise-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-ciel-500/30 bg-ciel-100 text-ciel-600',
    warning: 'border-ble-500/40 bg-amber-50 text-amber-900',
    danger: 'border-brique-500/30 bg-brique-100 text-brique-600',
    success: 'border-champ-500/30 bg-champ-50 text-champ-800',
  } as const;

  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-0.5' : undefined}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------

const FIELD_BASE =
  'w-full rounded-lg border border-ardoise-300 bg-white px-3 text-sm text-ardoise-900 ' +
  'placeholder:text-ardoise-400 transition focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20 ' +
  'disabled:bg-ardoise-50 disabled:text-ardoise-500';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-ardoise-800"
        >
          {label}
          {required ? <span className="ml-0.5 text-brique-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-brique-500">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ardoise-500">{hint}</p>
      ) : null}
    </div>
  );
}

// React 19 accepte `ref` comme prop ordinaire des composants fonction : les
// champs l'exposent pour permettre le focus programmatique (saisie du code, etc.).

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(FIELD_BASE, 'h-10', className)} {...props} />;
}

export function Select({
  className,
  children,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <select ref={ref} className={cn(FIELD_BASE, 'h-10', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  rows = 3,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(FIELD_BASE, 'py-2', className)}
      rows={rows}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

export function TableWrapper({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ardoise-200 bg-white">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={cn(
        'border-b border-ardoise-200 bg-ardoise-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ardoise-600',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td
      className={cn(
        'border-b border-ardoise-100 px-3 py-2.5 text-ardoise-800',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2 text-sm text-ardoise-500">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ardoise-900 sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-ardoise-500">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2 no-print">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

export function formatDateFr(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

/** Accepte aussi les `Decimal` de Prisma, dont `Number()` lit la valeur. */
export function formatNumberFr(value: unknown, digits = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
