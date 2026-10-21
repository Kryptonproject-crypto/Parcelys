import { useEffect, useState } from 'react';
import type { AppContext } from '../App';
import { fetchVersion, type VersionInfo } from '../lib/api';
import { compareVersions } from '../lib/version';
import { formatDateFr } from '../components/ui';
import { Banner, Button, Card, Header } from '../components/ui';

/** Réglages : état de la session, du cache, mises à jour et déconnexion. */
export function SettingsScreen({ context }: { context: AppContext }) {
  const { back, navigate, session, snapshot, online, pending, logout, refreshSnapshot, isExpert } =
    context;
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  /**
   * Saisies en attente : la déconnexion vide la file, et une saisie de
   * registre perdue est un traitement qui n'a jamais existé aux yeux d'un
   * contrôle. Il faut alors confirmer, en sachant ce que l'on perd.
   */
  const [confirmerPerte, setConfirmerPerte] = useState(false);
  const pageLegale = (chemin: string) => `${session.serverUrl.replace(/\/$/, '')}${chemin}`;
  const [version, setVersion] = useState<VersionInfo | null>(null);

  // La vérification passe par l'instance, jamais par un hôte tiers : c'est le
  // serveur de l'exploitation qui sait où regarder, et lui seul.
  useEffect(() => {
    if (!online) return;
    void fetchVersion(session).then(setVersion);
  }, [session, online]);

  const newer =
    version?.latest && compareVersions(version.latest.version, __APP_VERSION__) > 0
      ? version.latest
      : null;

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title="Réglages" onBack={back} />

      <div className="flex-1 space-y-4 px-4 py-4">
        {newer ? (
          <div className="rounded-xl border border-ble-500/40 bg-ble-500/10 p-3.5">
            <p className="font-semibold text-ble-600 dark:text-ble-400">
              Version {newer.version} disponible
            </p>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">
              Vous utilisez la version {__APP_VERSION__}. La mise à jour
              s&apos;installe en ouvrant le fichier téléchargé — Android vous
              demandera de confirmer.
            </p>
            {newer.apkUrl ? (
              <a
                href={newer.apkUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-accent px-4 font-semibold text-white active:bg-champ-700"
              >
                Télécharger l&apos;APK
              </a>
            ) : (
              <a
                href={newer.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-surface-2 px-4 font-semibold text-ink active:bg-line"
              >
                Voir la publication
              </a>
            )}
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
              Synchronisez vos saisies en attente avant de mettre à jour.
            </p>
          </div>
        ) : null}

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
              <dt className="text-ink-3">Numéro client</dt>
              <dd className="text-right font-mono text-ink">
                {(isExpert ? snapshot?.technicianNumber : snapshot?.farm.customerNumber) ?? '—'}
              </dd>
            </div>
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
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Version</dt>
              <dd className="text-right text-ink">
                {__APP_VERSION__}
                {version ? ` · serveur ${version.server}` : ''}
              </dd>
            </div>
          </dl>
        </Card>

        <Button
          variant="secondary"
          full
          onClick={() => navigate({ name: 'security' })}
        >
          Compte et sécurité
        </Button>

        <Button variant="secondary" full onClick={() => navigate({ name: 'aide' })}>
          Aide et contact
        </Button>

        <Button variant="secondary" full onClick={() => navigate({ name: 'demandes' })}>
          Mes demandes
        </Button>

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
            if (pending > 0 && !confirmerPerte) {
              setConfirmerPerte(true);
              return;
            }
            setLoggingOut(true);
            void logout().finally(() => setLoggingOut(false));
          }}
        >
          {pending > 0 && confirmerPerte
            ? `Confirmer : perdre ${pending} saisie(s) et se déconnecter`
            : 'Se déconnecter'}
        </Button>
        {confirmerPerte ? (
          <Button variant="secondary" full onClick={() => setConfirmerPerte(false)}>
            Annuler — garder mes saisies
          </Button>
        ) : null}

        <nav aria-label="Informations légales" className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1 text-[12.5px]">
          {[
            ['/confidentialite', 'Données personnelles'],
            ['/cookies', 'Cookies et traceurs'],
            ['/mentions-legales', 'Mentions légales'],
            ['/cgu', 'Conditions générales'],
          ].map(([chemin, libelle]) => (
            <a
              key={chemin}
              href={pageLegale(chemin as string)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink-3 underline"
            >
              {libelle}
            </a>
          ))}
        </nav>

        <p className="px-1 text-center text-[12.5px] leading-relaxed text-ink-3">
          Parcelys au champ — les données réglementaires proviennent de votre
          serveur. Aucune information phytosanitaire n&apos;est produite par
          l&apos;application.
        </p>
      </div>
    </div>
  );
}
