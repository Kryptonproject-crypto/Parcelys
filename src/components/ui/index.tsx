import type {
  ReactNode,
  Ref,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import Link from 'next/link';
import { IconChevronDown, IconSpinner, type LucideIcon } from '@/components/ui/icons';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
  'transition-all duration-150 active:translate-y-px ' +
  'disabled:pointer-events-none disabled:opacity-50';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-champ-600 text-white shadow-card hover:bg-champ-700 hover:shadow-raised ' +
    'dark:bg-champ-500 dark:hover:bg-champ-400 dark:text-champ-950',
  secondary: 'bg-surface-3 text-ink hover:bg-line',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-brique-500 text-white shadow-card hover:bg-brique-600 hover:shadow-raised',
  outline: 'border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-surface-2',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 16, lg: 18 };

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <IconSpinner size={ICON_SIZE[size]} className="animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon size={ICON_SIZE[size]} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
  target?: string;
  download?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...rest}
    >
      {Icon ? <Icon size={ICON_SIZE[size]} aria-hidden /> : null}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  padded = true,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
}) {
  return (
    <section
      className={cn(
        // `min-w-0` : une carte est presque toujours l'enfant d'une grille ou
        // d'un flex, dont le `min-width: auto` par défaut interdit de descendre
        // sous la largeur minimale du contenu. Un seul libellé un peu long —
        // un nom de produit, une carte Leaflet — élargit alors la colonne, donc
        // toute la page, et l'écran d'un téléphone se met à défiler
        // horizontalement.
        'min-w-0 rounded-xl border border-line bg-surface shadow-card',
        padded && 'p-5',
        interactive && 'transition-all hover:border-champ-300 hover:shadow-raised',
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
  icon: Icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <header className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 gap-2.5">
        {Icon ? (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
            <Icon size={15} aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-ink-3">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0 no-print">{action}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  href,
  accent = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  /** Met la carte en avant : utilisé pour la métrique principale. */
  accent?: boolean;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
              accent
                ? 'bg-champ-600/12 text-champ-600 dark:bg-champ-500/18 dark:text-champ-400'
                : 'bg-surface-3 text-ink-3',
            )}
          >
            <Icon size={16} aria-hidden />
          </span>
        ) : null}
      </div>

      <p className="mt-3 flex items-baseline gap-1 text-[28px] font-semibold leading-none tracking-tight text-ink">
        <span className="tabular-nums">{value}</span>
        {unit ? <span className="text-sm font-normal text-ink-3">{unit}</span> : null}
      </p>

      {hint ? <div className="mt-2 text-xs text-ink-3">{hint}</div> : null}
    </>
  );

  const base = 'block rounded-xl border border-line bg-surface p-4 shadow-card';

  return href ? (
    <Link
      href={href}
      className={cn(
        base,
        'group transition-all hover:-translate-y-0.5 hover:border-champ-300 hover:shadow-raised',
      )}
    >
      {content}
    </Link>
  ) : (
    <div className={base}>{content}</div>
  );
}

// ---------------------------------------------------------------------------
// Badges, alertes, états vides
// ---------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-2 ring-line',
  green: 'bg-champ-50 text-champ-700 ring-champ-200 dark:bg-champ-900/50 dark:text-champ-300 dark:ring-champ-800',
  amber: 'bg-ble-50 text-ble-700 ring-ble-300/60 dark:bg-ble-700/20 dark:text-ble-300 dark:ring-ble-700',
  red: 'bg-brique-50 text-brique-600 ring-brique-100 dark:bg-brique-700/25 dark:text-brique-100 dark:ring-brique-700',
  blue: 'bg-ciel-50 text-ciel-600 ring-ciel-100 dark:bg-ciel-700/25 dark:text-ciel-100 dark:ring-ciel-700',
};

export function Badge({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon size={12} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Pastille de couleur d'une série de graphique, posée à côté d'un libellé. */
export function SeriesDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      {Icon ? (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-3 text-ink-3">
          <Icon size={22} aria-hidden />
        </span>
      ) : null}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

type AlertTone = 'info' | 'warning' | 'danger' | 'success';

const ALERT_TONES: Record<AlertTone, string> = {
  info: 'border-ciel-500/25 bg-ciel-50 text-ciel-700 dark:bg-ciel-700/15 dark:text-ciel-100 dark:border-ciel-600/40',
  warning: 'border-ble-500/35 bg-ble-50 text-ble-700 dark:bg-ble-700/15 dark:text-ble-100 dark:border-ble-600/40',
  danger: 'border-brique-500/25 bg-brique-50 text-brique-700 dark:bg-brique-700/15 dark:text-brique-100 dark:border-brique-600/40',
  success: 'border-champ-500/25 bg-champ-50 text-champ-700 dark:bg-champ-800/40 dark:text-champ-200 dark:border-champ-600/40',
};

export function Alert({
  tone = 'info',
  title,
  icon: Icon,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed',
        ALERT_TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon size={17} className="mt-0.5 shrink-0" aria-hidden /> : null}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------

const FIELD_BASE =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink ' +
  'placeholder:text-ink-3/70 transition-colors ' +
  'focus:border-champ-500 focus:outline-none focus:ring-2 focus:ring-champ-500/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3';

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
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2">
          {label}
          {required ? <span className="ml-0.5 text-brique-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-brique-500">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

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
    <div className="relative">
      <select
        ref={ref}
        className={cn(FIELD_BASE, 'h-10 appearance-none pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <IconChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
    </div>
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
      className={cn(FIELD_BASE, 'py-2 leading-relaxed', className)}
      rows={rows}
      {...props}
    />
  );
}

export function Checkbox({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'h-4 w-4 rounded border-line-strong bg-surface text-champ-600 transition-colors',
        'focus:ring-2 focus:ring-champ-500/25 focus:ring-offset-0',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

export function TableWrapper({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-xl border border-line bg-surface shadow-card',
        className,
      )}
    >
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
        'sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2.5',
        'text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3',
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
        'border-b border-line/70 px-3 py-2.5 text-ink-2',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn('transition-colors hover:bg-surface-2', className)}>{children}</tr>
  );
}

// ---------------------------------------------------------------------------
// Mise en page
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6 animate-rise">
      {breadcrumb ? (
        <div className="mb-2.5 text-[13px] text-ink-3 no-print">{breadcrumb}</div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
              <Icon size={19} aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">
              {title}
            </h1>
            {description ? (
              <div className="mt-1 text-sm text-ink-3">{description}</div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2 no-print">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Spinner({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <IconSpinner
      size={size}
      role="status"
      aria-label="Chargement"
      className={cn('animate-spin', className)}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

export function formatDateFr(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

export function formatDateLongFr(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

/** Nombre compact, sans décimale superflue (12,5 ha plutôt que 12,50 ha). */
export function formatCompactFr(value: unknown, maxDigits = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: maxDigits });
}
