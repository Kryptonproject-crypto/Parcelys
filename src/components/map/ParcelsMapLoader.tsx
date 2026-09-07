'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { ParcelsMap as ParcelsMapType } from '@/components/map/ParcelsMap';

/**
 * Chargeur de la carte de consultation.
 *
 * Leaflet lit `window` dès son import : le composant doit donc être exclu du
 * rendu serveur. `next/dynamic` avec `ssr: false` n'étant utilisable que depuis
 * un composant client, ce fichier sert d'intermédiaire entre les pages (rendues
 * côté serveur) et la carte.
 */
const ParcelsMapClient = dynamic(
  () => import('@/components/map/ParcelsMap').then((m) => m.ParcelsMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] w-full items-center justify-center rounded-xl border border-ardoise-200 bg-ardoise-50">
        <span className="text-sm text-ardoise-500">Chargement de la carte…</span>
      </div>
    ),
  },
);

export type ParcelsMapLoaderProps = ComponentProps<typeof ParcelsMapType>;

export function ParcelsMapLoader(props: ParcelsMapLoaderProps) {
  return <ParcelsMapClient {...props} />;
}
