import Image from 'next/image';
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
    <div className="relative flex min-h-screen flex-col bg-canvas">
      {/* Halo discret : donne du relief sans image ni requête. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_-5%,var(--color-champ-200)_0%,transparent_60%)] opacity-70 dark:opacity-20"
      />

      <header className="relative px-4 py-6 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-ink"
        >
          <Image
            src="/icone.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
            priority
            unoptimized
          />
          Parcelys
        </Link>
      </header>

      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 sm:items-center">
        <div className="w-full max-w-md animate-rise">
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-raised sm:p-8">
            <h1 className="text-[21px] font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle ? (
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">{subtitle}</p>
            ) : null}
            <div className="mt-7">{children}</div>
          </div>

          {footer ? (
            <div className="mt-5 text-center text-[13.5px] text-ink-3">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
