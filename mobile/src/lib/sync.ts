import { ApiError, OfflineError, fetchSnapshot, pushOperations } from './api';
import { dequeue, readOutbox, updateQueued, writeSnapshot } from './db';
import type { QueuedOperation, Session } from './types';

/**
 * Moteur de synchronisation.
 *
 * Trois points méritent une explication :
 *
 * 1. **Les identifiants locaux.** Une parcelle créée au champ n'a pas encore
 *    d'identifiant serveur ; les traitements saisis dans la foulée la désignent
 *    par son identifiant local. À la synchronisation, la réponse du serveur
 *    donne le vrai identifiant, qui est immédiatement reporté sur les
 *    opérations suivantes — dans ce lot comme dans la file.
 *
 * 2. **Le lot ne s'arrête pas au premier refus.** Une saisie invalide reste
 *    dans la file avec son message d'erreur ; les autres passent. Rien n'est
 *    plus décourageant qu'une synchronisation qui échoue en bloc au retour du
 *    champ.
 *
 * 3. **Rien n'est supprimé avant confirmation.** Une opération ne quitte la
 *    file que si le serveur l'a acceptée — ou l'avait déjà acceptée lors d'un
 *    envoi dont la réponse s'était perdue.
 */

/** Taille de lot : assez grand pour limiter les allers-retours, assez petit
 *  pour qu'une connexion de campagne aille au bout. */
const BATCH_SIZE = 20;

export type SyncReport = {
  applied: number;
  rejected: number;
  remaining: number;
  offline: boolean;
  /** Messages des saisies refusées, pour affichage. */
  errors: Array<{ label: string; message: string }>;
  snapshotRefreshed: boolean;
};

/** Une opération dont la parcelle n'est pas encore connue du serveur. */
function isPending(operation: QueuedOperation, resolved: Map<string, string>): boolean {
  if (!operation.parcelId) return false;
  // Un identifiant serveur est un cuid ; un identifiant local est un UUID
  // généré par l'appareil, qui figure comme clé dans la file d'attente.
  return operation.parcelId.includes('-') && !resolved.has(operation.parcelId);
}

export async function synchronize(session: Session): Promise<SyncReport> {
  const report: SyncReport = {
    applied: 0,
    rejected: 0,
    remaining: 0,
    offline: false,
    errors: [],
    snapshotRefreshed: false,
  };

  const queue = await readOutbox();
  const resolved = new Map<string, string>();

  for (let index = 0; index < queue.length; index += BATCH_SIZE) {
    const batch = queue.slice(index, index + BATCH_SIZE);

    // Les opérations dont la parcelle a été créée dans un lot précédent
    // reçoivent ici son identifiant serveur.
    const payloadBatch = batch.map((operation) => ({
      clientId: operation.clientId,
      kind: operation.kind,
      ...(operation.parcelId
        ? { parcelId: resolved.get(operation.parcelId) ?? operation.parcelId }
        : {}),
      capturedAt: operation.capturedAt,
      payload: operation.payload,
    }));

    let response;
    try {
      response = await pushOperations(session, payloadBatch);
    } catch (error) {
      if (error instanceof OfflineError) {
        report.offline = true;
        break;
      }
      if (error instanceof ApiError && error.status === 401) {
        // Session expirée : inutile d'insister, l'utilisateur doit se
        // reconnecter. La file reste intacte.
        report.errors.push({
          label: 'Session',
          message: 'Session expirée, reconnectez-vous pour synchroniser.',
        });
        break;
      }
      throw error;
    }

    for (const result of response.results) {
      const operation = batch.find((item) => item.clientId === result.clientId);
      if (!operation) continue;

      if (result.status === 'rejected') {
        report.rejected += 1;
        const message = result.fieldErrors?.length
          ? result.fieldErrors.map((f) => `${f.field} : ${f.message}`).join(' · ')
          : (result.message ?? `Erreur ${result.httpStatus}`);
        report.errors.push({ label: operation.label, message });
        await updateQueued(operation.clientId, {
          lastError: message,
          attempts: operation.attempts + 1,
        });
        continue;
      }

      report.applied += 1;
      if (result.entityId) resolved.set(operation.clientId, result.entityId);
      await dequeue(operation.clientId);
    }
  }

  // Rafraîchit l'instantané, sauf si le réseau vient de faire défaut.
  if (!report.offline) {
    try {
      writeSnapshot(await fetchSnapshot(session));
      report.snapshotRefreshed = true;
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;
      report.offline = true;
    }
  }

  const rest = await readOutbox();
  report.remaining = rest.length;

  // Les opérations restées en attente parce que leur parcelle n'était pas
  // encore créée ne sont pas des erreurs : elles partiront au prochain essai.
  for (const operation of rest) {
    if (isPending(operation, resolved) && !operation.lastError) {
      report.errors.push({
        label: operation.label,
        message: 'En attente de la création de sa parcelle.',
      });
    }
  }

  return report;
}
