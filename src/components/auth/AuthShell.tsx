import Link from 'next/link';
import type { ReactNode } from 'react';

/** Gabarit commun aux pages d'authentification. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-champ-50 to-ardoise-50">
      <header className="px-4 py-6 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-lg font-bold text-champ-700"
        >
          <span aria-hidden>🌾</span> Parcelys
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-ardoise-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-xl font-semibold text-ardoise-900">{title}</h1>
            {subtitle ? (
              <p className="mt-1.5 text-sm leading-relaxed text-ardoise-500">{subtitle}</p>
            ) : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? (
            <div className="mt-4 text-center text-sm text-ardoise-500">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
