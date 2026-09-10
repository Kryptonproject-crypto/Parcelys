import { useCallback, useEffect, useState } from 'react';
import type { AppContext } from '../App';
import { dequeue, readOutbox } from '../lib/db';
import { synchronize, type SyncReport } from '../lib/sync';
import { OPERATION_LABELS, type QueuedOperation } from '../lib/types';
import {
  ActionBar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Header,
  formatDateFr,
} from '../components/ui';

/**
 * File d'attente et synchronisation.
 *
 * L'écran est délibérément explicite : on doit pouvoir vérifier d'un coup d'œil
 * que rien n'est resté au fond du téléphone. Une saisie refusée reste visible,
 * avec le motif du refus, jusqu'à ce que l'utilisateur la supprime — la faire
 * disparaître silencieusement serait le pire des comportements pour un registre
 * réglementaire.
 */
export function QueueScreen({ context }: { context: AppContext }) {
  const { back, session, online, refreshPending, refreshSnapshot, activeFarmId } =
    context;

  const [operations, setOperations] = useState<QueuedOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setOperations(await readOutbox());
    await refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function sync(): Promise<void> {
    setSyncing(true);
    setError(null);
    setReport(null);
    try {
      const result = await synchronize(session, activeFarmId);
      setReport(result);
      await reload();
      if (result.snapshotRefreshed) await refreshSnapshot();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Synchronisation impossible.',
      );
    } finally {
      setSyncing(false);
    }
  }

  async function remove(clientId: string): Promise<void> {
    await dequeue(clientId);
    await reload();
  }

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Synchronisation"
        subtitle={
          operations.length === 0
            ? 'Tout est envoyé'
            : `${operations.length} saisie(s) en attente`
        }
        onBack={back}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {!online ? (
          <Banner tone="warning">
            Hors réseau. La synchronisation démarrera dès que la connexion
            reviendra.
          </Banner>
        ) : null}

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {report ? (
          <Banner
            tone={
              report.rejected > 0 ? 'warning' : report.offline ? 'warning' : 'success'
            }
          >
            {report.applied} saisie(s) envoyée(s)
            {report.rejected > 0 ? `, ${report.rejected} refusée(s)` : ''}
            {report.offline ? ' — connexion perdue en cours d’envoi.' : '.'}
            {report.errors.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[13px]">
                {report.errors.map((entry, index) => (
                  <li key={`${entry.label}-${index}`}>
                    <strong>{entry.label}</strong> : {entry.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Banner>
        ) : null}

        {/*
          Avertissements des saisies acceptées : surdosage, produit retiré, sol
          drainé. Séparés des erreurs parce qu'ils ne demandent pas de renvoyer
          quoi que ce soit — la saisie est passée, et c'est le registre qui
          porte désormais l'annotation. Mais une saisie faite hors réseau n'a
          pas pu être contrôlée à la frappe : c'est ici qu'on l'apprend.
        */}
        {report && report.warnings.length > 0 ? (
          <Banner tone="warning">
            <strong>
              {report.warnings.length} point
              {report.warnings.length > 1 ? 's' : ''} à vérifier au catalogue
              officiel
            </strong>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {report.warnings.map((entry, index) => (
                <li key={`${entry.label}-${index}`}>
                  <strong>{entry.label}</strong> : {entry.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px]">
              Ces saisies sont enregistrées. L’étiquette du produit fait foi.
            </p>
          </Banner>
        ) : null}

        {operations.length === 0 ? (
          <EmptyState
            title="Aucune saisie en attente"
            description="Tout ce qui a été enregistré sur ce téléphone a bien été transmis au serveur."
          />
        ) : (
          <ul className="space-y-2.5">
            {operations.map((operation) => (
              <li key={operation.clientId}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{operation.label}</p>
                      <p className="mt-0.5 text-[13px] text-ink-3">
                        {OPERATION_LABELS[operation.kind]} ·{' '}
                        {formatDateFr(operation.capturedAt)}
                      </p>
                      {operation.lastError ? (
                        <p className="mt-2 rounded-lg bg-brique-500/10 px-2.5 py-1.5 text-[13px] text-brique-600 dark:text-brique-500">
                          {operation.lastError}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      {operation.attempts > 0 ? (
                        <Badge tone="amber">{operation.attempts} essai(s)</Badge>
                      ) : (
                        <Badge>En attente</Badge>
                      )}
                    </div>
                  </div>

                  {operation.lastError ? (
                    <button
                      type="button"
                      onClick={() => void remove(operation.clientId)}
                      className="mt-3 w-full rounded-lg border border-line py-2 text-[13.5px] font-medium text-brique-500 active:bg-surface-2"
                    >
                      Supprimer cette saisie
                    </button>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ActionBar>
        <Button
          full
          onClick={() => void sync()}
          loading={syncing}
          disabled={!online || operations.length === 0}
        >
          {syncing
            ? 'Envoi en cours…'
            : operations.length === 0
              ? 'Rien à envoyer'
              : `Envoyer ${operations.length} saisie(s)`}
        </Button>
      </ActionBar>
    </div>
  );
}
