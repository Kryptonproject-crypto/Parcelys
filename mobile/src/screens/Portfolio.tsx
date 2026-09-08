import { useState } from 'react';
import type { AppContext } from '../App';
import { OfflineError } from '../lib/api';
import { Badge, Banner, Card, EmptyState, Header } from '../components/ui';

/**
 * Portefeuille de l'expert agronomique.
 *
 * La liste des domaines suivis vient de l'instantané, donc reste lisible hors
 * réseau. En revanche, ouvrir un domaine qui n'est pas celui en cache réclame
 * du réseau : le téléphone ne conserve qu'une exploitation à la fois, et le
 * dire franchement vaut mieux qu'un écran vide.
 */
export function PortfolioScreen({ context }: { context: AppContext }) {
  const { snapshot, session, online, pending, navigate, selectFarm } = context;
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const farms = snapshot?.farms ?? [];
  const cachedFarmId = snapshot?.farm.id ?? null;

  async function open(farmId: string): Promise<void> {
    setError(null);
    setOpening(farmId);
    try {
      await selectFarm(farmId);
    } catch (caught) {
      setError(
        caught instanceof OfflineError
          ? 'Hors réseau : seul le domaine déjà téléchargé est consultable.'
          : "Impossible d'ouvrir ce domaine.",
      );
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Mon portefeuille"
        subtitle={`${session.firstName} ${session.lastName}`}
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
          <Banner tone="warning">
            Hors réseau — seul le domaine déjà téléchargé est consultable, et vos
            préconisations partiront à la reconnexion.
          </Banner>
        ) : null}

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {farms.length === 0 ? (
          <EmptyState
            title="Aucun domaine suivi"
            description="Une exploitation vous ouvre l'accès en vous remettant un code, à saisir depuis l'application web. Vos domaines apparaîtront ici."
          />
        ) : (
          <ul className="space-y-2.5">
            {farms.map((farm) => {
              const cached = farm.id === cachedFarmId;
              return (
                <li key={farm.id}>
                  <Card onClick={() => void open(farm.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{farm.name}</p>
                        <p className="text-[13px] text-ink-3">
                          {farm.advisory ? 'Mission de conseil' : 'Membre'}
                          {cached ? ' · téléchargé' : ''}
                        </p>
                      </div>
                      {opening === farm.id ? (
                        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      ) : cached ? (
                        <Badge tone="green">hors ligne</Badge>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <p className="px-1 pt-2 text-[12.5px] leading-relaxed text-ink-3">
          Vos préconisations engagent votre conseil. Parcelys n&apos;en produit
          aucune et ne complète jamais une dose : ce que vous écrivez est ce que
          l&apos;exploitation lit.
        </p>
      </div>
    </div>
  );
}
