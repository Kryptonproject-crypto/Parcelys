import { useState } from 'react';
import type { AppContext } from '../App';
import { formatDateFr } from '../components/ui';
import { Banner, Button, Card, Header } from '../components/ui';

/** Réglages : état de la session, du cache, et déconnexion. */
export function SettingsScreen({ context }: { context: AppContext }) {
  const { back, session, snapshot, online, pending, logout, refreshSnapshot, isExpert } =
    context;
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title="Réglages" onBack={back} />

      <div className="flex-1 space-y-4 px-4 py-4">
        <Card>
          <p className="font-semibold text-ink">
            {session.firstName} {session.lastName}
          </p>
          <p className="text-[13.5px] text-ink-3">{session.email}</p>
          <dl className="mt-3 space-y-2 border-t border-line pt-3 text-[13.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Serveur</dt>
              <dd className="truncate text-right text-ink">{session.serverUrl}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Compte</dt>
              <dd className="text-right text-ink">
                {isExpert ? 'Expert agronomique' : 'Exploitation'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">
                {isExpert ? 'Domaine ouvert' : 'Exploitation'}
              </dt>
              <dd className="truncate text-right text-ink">
                {snapshot?.farm.name ?? '—'}
              </dd>
            </div>
            {isExpert ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Portefeuille</dt>
                <dd className="text-right text-ink">
                  {snapshot?.farms.length ?? 0} domaine(s)
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Réseau</dt>
              <dd className="text-right text-ink">
                {online ? 'connecté' : 'hors ligne'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Données en cache</dt>
              <dd className="text-right text-ink">
                {snapshot
                  ? `${snapshot.parcels.length} parcelle(s), au ${formatDateFr(snapshot.syncedAt)}`
                  : 'aucune'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Saisies en attente</dt>
              <dd className="text-right text-ink">{pending}</dd>
            </div>
          </dl>
        </Card>

        <Button
          variant="secondary"
          full
          loading={refreshing}
          disabled={!online}
          onClick={() => {
            setRefreshing(true);
            void refreshSnapshot().finally(() => setRefreshing(false));
          }}
        >
          Rafraîchir les données
        </Button>

        {pending > 0 ? (
          <Banner tone="warning">
            {pending} saisie(s) ne sont pas encore parties. Envoyez-les avant de
            vous déconnecter : la déconnexion vide la file d&apos;attente.
          </Banner>
        ) : null}

        <Button
          variant="danger"
          full
          loading={loggingOut}
          onClick={() => {
            setLoggingOut(true);
            void logout().finally(() => setLoggingOut(false));
          }}
        >
          Se déconnecter
        </Button>

        <p className="px-1 text-center text-[12.5px] leading-relaxed text-ink-3">
          Parcelys au champ — les données réglementaires proviennent de votre
          instance. Aucune information phytosanitaire n&apos;est produite par
          l&apos;application.
        </p>
      </div>
    </div>
  );
}
