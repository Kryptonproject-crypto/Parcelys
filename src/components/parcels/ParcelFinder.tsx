'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Input, formatNumberFr } from '@/components/ui';
import { IconSearch } from '@/components/ui/icons';

/**
 * Trouver une parcelle dans une liste qui en compte cent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE COMPOSANT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Une exploitation de 140 parcelles — ce qu'un import TéléPAC produit couramment
 * — donne une liste où retrouver « la Croix Rouge » demande de faire défiler
 * plusieurs écrans. L'espace expert n'offrait aucune recherche du tout : il
 * fallait deviner en tâtonnant.
 *
 * Le filtrage se fait **dans la page**, sans aller-retour au serveur. La
 * différence n'est pas cosmétique : une recherche qui recharge la page coûte
 * une seconde par frappe sur une liaison de campagne, et personne ne s'en sert
 * deux fois. Les parcelles sont déjà toutes chargées — les filtrer côté client
 * ne coûte rien.
 *
 * Ce qui est cherché : le nom, le numéro interne, la commune, le lieu-dit et la
 * culture. Ce sont les cinq façons dont un exploitant désigne une parcelle, et
 * aucune n'est plus légitime que les autres — on ne dit pas « la 12 » au
 * voisin, on dit « celle du haut, en blé ».
 */

export type ParcelleTrouvable = {
  id: string;
  name: string;
  internalNumber?: string | null;
  commune?: string | null;
  lieuDit?: string | null;
  crop?: string | null;
  areaHa: number;
};

/** Comparaison insensible à la casse, aux accents et à la ponctuation. */
function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function ParcelFinder({
  parcels,
  hrefBase,
  /** Au-dessous de ce nombre, le champ ne s'affiche pas : il n'aiderait pas. */
  seuil = 8,
}: {
  parcels: ParcelleTrouvable[];
  /** Préfixe du lien : `/parcelles` ou `/portefeuille/<id>/parcelles`. */
  hrefBase: string;
  seuil?: number;
}) {
  const [terme, setTerme] = useState('');

  const filtrees = useMemo(() => {
    const cherche = normaliser(terme.trim());
    if (!cherche) return parcels;
    return parcels.filter((p) =>
      normaliser(
        [p.name, p.internalNumber, p.commune, p.lieuDit, p.crop]
          .filter(Boolean)
          .join(' '),
      ).includes(cherche),
    );
  }, [parcels, terme]);

  return (
    <div>
      {parcels.length >= seuil ? (
        <div className="relative mb-3">
          <IconSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <Input
            type="search"
            value={terme}
            onChange={(event) => setTerme(event.target.value)}
            placeholder="Nom, n° d’îlot, commune, lieu-dit, culture…"
            aria-label="Rechercher une parcelle"
            className="pl-9"
          />
          <p className="mt-1.5 text-[12.5px] text-ink-3" role="status">
            {terme.trim()
              ? `${filtrees.length} parcelle(s) sur ${parcels.length}`
              : `${parcels.length} parcelle(s)`}
          </p>
        </div>
      ) : null}

      {filtrees.length === 0 ? (
        <p className="rounded-lg border border-line px-3 py-4 text-center text-sm text-ink-3">
          Aucune parcelle ne correspond à «&nbsp;{terme.trim()}&nbsp;».
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {filtrees.map((parcel) => (
            <li key={parcel.id}>
              <Link
                href={`${hrefBase}/${parcel.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 transition-colors hover:border-champ-500/50 hover:bg-surface-2 sm:min-h-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {parcel.name}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-3">
                    {[
                      parcel.internalNumber,
                      parcel.crop ?? 'sans culture déclarée',
                      parcel.commune,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-2">
                  {formatNumberFr(parcel.areaHa, 2)} ha
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
