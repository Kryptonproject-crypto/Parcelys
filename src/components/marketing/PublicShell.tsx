import Image from 'next/image';
import Link from 'next/link';
import { PARCELYS } from '@/lib/constants/identity';
import { LinkButton } from '@/components/ui';

/**
 * Coque des pages publiques : contact, confidentialité, CGU.
 *
 * Ces pages se ressemblaient de loin sans jamais se ressembler tout à fait —
 * un lien de retour ici, rien là, un pied de page nulle part. Un visiteur qui
 * ouvre les conditions générales depuis l'accueil doit pouvoir revenir, et
 * atteindre le contact sans repasser par la page d'accueil.
 *
 * L'accueil garde sa propre mise en page : c'est une page de présentation, pas
 * un document.
 */
export function PublicShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-ink"
          >
            <Image
              src="/icone.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
              unoptimized
            />
            {PARCELYS.nom}
          </Link>
          <LinkButton href="/connexion" variant="ghost" size="sm">
            Se connecter
          </LinkButton>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-[28px] font-semibold tracking-tight text-ink sm:text-[34px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{description}</p>
        ) : null}
        <div className="mt-8">{children}</div>
      </main>

      <PublicFooter />
    </div>
  );
}

/** Pied de page commun, y compris à l'accueil. */
export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13.5px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          {PARCELYS.nom} — édité par {PARCELYS.editeur.nom}, {PARCELYS.editeur.qualite}.
        </p>
        <nav className="flex flex-wrap gap-5">
          <Link href="/contact" className="transition-colors hover:text-ink">
            Contact
          </Link>
          <Link href="/confidentialite" className="transition-colors hover:text-ink">
            Confidentialité
          </Link>
          <Link href="/cgu" className="transition-colors hover:text-ink">
            Conditions générales
          </Link>
          <Link href="/connexion" className="transition-colors hover:text-ink">
            Se connecter
          </Link>
        </nav>
      </div>
    </footer>
  );
}
