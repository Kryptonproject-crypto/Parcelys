'use client';

import { useEffect, type ReactNode } from 'react';

/** Boîte de dialogue modale : fermeture par Échap, par le fond ou par le bouton. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    // `items-start` et non `items-center`, y compris sur grand écran.
    //
    // Avec `items-center`, un dialogue plus haut que la fenêtre déborde des
    // deux côtés à parts égales, et **le haut devient inatteignable** : le
    // défilement ne remonte pas au-dessus de son origine. Mesuré sur le
    // formulaire de traitement phytosanitaire, sur un écran d'ordinateur
    // portable de 768 px : dialogue de 1 003 px, haut à −117 px, et il y
    // restait même après avoir remonté le défilement à fond. Le titre et les
    // premiers champs étaient perdus.
    //
    // Le défaut ne se voyait pas sur téléphone, où `items-start` s'appliquait
    // déjà — d'où un contrôle de mise en page qui mesurait les largeurs
    // mobiles sans jamais rien trouver.
    //
    // Le centrage vertical est rendu par `my-auto` sur le dialogue : des
    // marges automatiques répartissent l'espace quand il y en a, et se
    // réduisent à zéro quand il n'y en a pas, sans jamais rogner.
    <div className="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto p-4">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="fixed inset-0 bg-ardoise-900/50"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // `max-h` + `flex-col` : le titre reste visible et c'est le
        // formulaire qui défile, plutôt que le dialogue entier. Sur un
        // formulaire long — le traitement phytosanitaire en compte une
        // quinzaine de champs —, faire défiler le tout fait perdre de vue ce
        // qu'on est en train de remplir et sur quelle parcelle.
        className={`relative my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col animate-fade-in rounded-xl border border-line bg-surface shadow-xl ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-ink-3">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-ink-3 transition hover:bg-surface-3 hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* `min-h-0` : sans lui, un enfant de flex refuse de se rétrécir
            sous sa hauteur de contenu, et le `overflow-y-auto` ne sert à
            rien — le dialogue déborderait à nouveau. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
