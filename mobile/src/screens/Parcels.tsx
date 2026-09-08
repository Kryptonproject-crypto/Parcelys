import { useMemo, useState } from 'react';
import type { AppContext } from '../App';
import { formatAreaHa } from '../lib/geo';
import { Badge, Button, Card, EmptyState, Header, Input, cn } from '../components/ui';

/**
 * Écran d'accueil : les parcelles de l'exploitation.
 *
 * C'est la liste cachée localement, donc toujours disponible. Un bandeau
 * indique franchement quand elle date d'avant la dernière sortie hors réseau,
 * plutôt que de laisser croire qu'elle est à jour.
 */
export function ParcelsScreen({ context }: { context: AppContext }) {
  const { snapshot, online, pending, navigate } = context;
  const [search, setSearch] = useState('');

  const parcels = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = snapshot?.parcels ?? [];
    if (!term) return all;
    return all.filter((parcel) =>
      [parcel.name, parcel.internalNumber, parcel.commune, parcel.cropName]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    );
  }, [snapshot, search]);

  const totalArea = (snapshot?.parcels ?? []).reduce(
    (sum, parcel) => sum + parcel.areaHa,
    0,
  );

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title={snapshot?.farm.name ?? 'Parcelys'}
        subtitle={
          snapshot
            ? `${snapshot.parcels.length} parcelle(s) · ${formatAreaHa(totalArea)}`
            : 'Aucune donnée en cache'
        }
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate({ name: 'queue' })}
              aria-label={`File d'attente${pending > 0 ? ` — ${pending} en attente` : ''}`}
              className="relative flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-surface-2"
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M21 12a9 9 0 11-3-6.7M21 3v6h-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {pending > 0 ? (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ble-500 px-1 text-[10px] font-bold text-white">
                  {pending > 9 ? '9+' : pending}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: 'settings' })}
              aria-label="Réglages"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-surface-2"
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008 3.68 1.65 1.65 0 009 2.17V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.32 8c.14.35.4.65.74.83H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        }
      />

      <div className="flex-1 space-y-3 px-4 py-4">
        {!online ? (
          <div className="flex items-center gap-2 rounded-xl border border-ble-500/40 bg-ble-500/10 px-3.5 py-2.5 text-[13.5px] text-ble-600 dark:text-ble-400">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-current" />
            Hors réseau — vos saisies partiront à la reconnexion.
          </div>
        ) : null}

        {snapshot ? (
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher une parcelle"
            inputMode="search"
            autoCapitalize="none"
          />
        ) : null}

        {!snapshot ? (
          <EmptyState
            title="Rien en cache"
            description="Connectez-vous au réseau une première fois pour télécharger vos parcelles. Elles resteront ensuite disponibles hors ligne."
          />
        ) : parcels.length === 0 ? (
          <EmptyState
            title={search ? 'Aucun résultat' : 'Aucune parcelle'}
            description={
              search
                ? 'Aucune parcelle ne correspond à cette recherche.'
                : 'Relevez votre première parcelle en marchant son contour.'
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {parcels.map((parcel) => (
              <li key={parcel.id}>
                <Card onClick={() => navigate({ name: 'parcel', parcelId: parcel.id })}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{parcel.name}</p>
                      <p className="truncate text-[13.5px] text-ink-3">
                        {[parcel.internalNumber, parcel.commune]
                          .filter(Boolean)
                          .join(' · ') || 'Sans référence'}
                      </p>
                    </div>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-ink">
                        {formatAreaHa(parcel.areaHa)}
                      </span>
                      {parcel.cropName ? (
                        <Badge tone="green">{parcel.cropName}</Badge>
                      ) : null}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={cn(
          'safe-bottom sticky bottom-0 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur',
        )}
      >
        <Button full onClick={() => navigate({ name: 'new-parcel' })}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          Relever une parcelle
        </Button>
      </div>
    </div>
  );
}
