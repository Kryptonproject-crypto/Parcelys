'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  IconClose,
  IconError,
  IconInfo,
  IconSuccess,
  IconWarning,
} from '@/components/ui/icons';
import { cn } from '@/components/ui';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
};

type ToastContextValue = {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { ring: string; icon: typeof IconSuccess; color: string }> = {
  success: {
    ring: 'ring-champ-500/30',
    icon: IconSuccess,
    color: 'text-champ-600 dark:text-champ-400',
  },
  error: {
    ring: 'ring-brique-500/30',
    icon: IconError,
    color: 'text-brique-500',
  },
  warning: {
    ring: 'ring-ble-500/40',
    icon: IconWarning,
    color: 'text-ble-600 dark:text-ble-400',
  },
  info: {
    ring: 'ring-ciel-500/30',
    icon: IconInfo,
    color: 'text-ciel-500',
  },
};

const AUTO_DISMISS_MS = 5000;

/**
 * Notifications éphémères.
 *
 * Remplace `window.alert` : le message ne bloque pas l'interface, reste lisible
 * et disparaît seul. Les erreurs persistent plus longtemps que les succès.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      const delay = toast.tone === 'error' ? AUTO_DISMISS_MS * 1.8 : AUTO_DISMISS_MS;
      setTimeout(() => dismiss(id), delay);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:bottom-6 sm:right-6"
      >
        {toasts.map((toast) => {
          const style = TONE_STYLES[toast.tone];
          const Icon = style.icon;
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'pointer-events-auto flex animate-rise items-start gap-3 rounded-xl border border-line',
                'bg-surface p-3.5 shadow-float ring-1',
                style.ring,
              )}
            >
              <Icon size={18} className={cn('mt-0.5 shrink-0', style.color)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">
                    {toast.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Fermer la notification"
                className="-m-1 shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <IconClose size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast doit être utilisé à l’intérieur de <ToastProvider>.');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Thème clair / sombre
// ---------------------------------------------------------------------------

export type Theme = 'light' | 'dark';

const THEME_KEY = 'parcelys-theme';

/** Lit et applique le thème ; la valeur initiale est posée par le script du layout. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Stockage indisponible (navigation privée) : le choix vaut pour la session.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
