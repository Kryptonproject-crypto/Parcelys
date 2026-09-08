import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

/**
 * Briques d'interface de l'application de terrain.
 *
 * Deux contraintes dictent ces choix, et elles ne sont pas cosmétiques : on
 * utilise ce téléphone debout dans un champ, souvent d'une seule main et avec
 * des gants. D'où des cibles tactiles d'au moins 48 px, un contraste élevé, et
 * des actions principales placées en bas de l'écran, à portée du pouce.
 */

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white active:bg-champ-700 disabled:opacity-50',
  secondary: 'bg-surface-2 text-ink active:bg-line disabled:opacity-50',
  danger: 'bg-brique-500 text-white active:bg-brique-600 disabled:opacity-50',
  ghost: 'text-ink-2 active:bg-surface-2 disabled:opacity-40',
};

export function Button({
  variant = 'primary',
  full = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  full?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5',
        'font-semibold transition-transform active:scale-[0.98]',
        VARIANTS[variant],
        full && 'w-full',
        className,
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-label="Chargement"
      role="status"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const base = cn(
    'rounded-2xl border border-line bg-surface p-4',
    onClick && 'w-full text-left active:bg-surface-2',
    className,
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={base}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-ink-2">
        {label}
        {required ? <span className="ml-0.5 text-brique-500">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-[13px] font-medium text-brique-500">{error}</span>
      ) : hint ? (
        <span className="block text-[13px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

const FIELD_CLASS =
  'w-full min-h-[48px] rounded-xl border border-line bg-surface px-3.5 text-ink ' +
  'outline-none focus:border-accent focus:ring-2 focus:ring-accent/25';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(FIELD_CLASS, className)} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(FIELD_CLASS, 'appearance-none', className)}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={cn(FIELD_CLASS, 'min-h-[96px] py-2.5', className)} />
  );
}

type BannerTone = 'info' | 'warning' | 'danger' | 'success';

const BANNER_TONES: Record<BannerTone, string> = {
  info: 'border-ciel-500/40 bg-ciel-500/10 text-ciel-600 dark:text-ciel-500',
  warning: 'border-ble-500/40 bg-ble-500/10 text-ble-600 dark:text-ble-400',
  danger: 'border-brique-500/40 bg-brique-500/10 text-brique-600 dark:text-brique-500',
  success: 'border-champ-500/40 bg-champ-500/10 text-champ-700 dark:text-champ-400',
};

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: BannerTone;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3 text-[14px] leading-relaxed',
        BANNER_TONES[tone],
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    green: 'bg-champ-500/15 text-champ-700 dark:text-champ-400',
    amber: 'bg-ble-500/20 text-ble-600 dark:text-ble-400',
    red: 'bg-brique-500/15 text-brique-600 dark:text-brique-500',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** En-tête d'écran, avec retour éventuel. */
export function Header({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2.5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-2 active:bg-surface-2"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 19l-7-7 7-7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold text-ink">{title}</h1>
          {subtitle ? (
            <p className="truncate text-[13px] text-ink-3">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Barre d'action fixée en bas, dans la zone atteignable au pouce. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="safe-bottom sticky bottom-0 z-20 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
      {children}
    </div>
  );
}

export const formatDateFr = (value: string | Date): string =>
  new Date(value).toLocaleDateString('fr-FR');

/** Date du jour au format `aaaa-mm-jj`, pour les champs `<input type="date">`. */
export const today = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};
