'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Field, Select, Spinner } from '@/components/ui';

/**
 * Verrouiller un document de campagne.
 *
 * Le contenu figé est produit **côté serveur**, jamais envoyé d'ici : accepter
 * un contenu transmis par le navigateur reviendrait à laisser verrouiller
 * n'importe quoi sous le nom d'un registre officiel.
 *
 * Deux natures seulement pour l'instant, et c'est assumé : verrouiller un
 * document vide sous un nom officiel serait pire que ne pas le proposer.
 */

const NATURES = [
  { value: 'CAHIER_EPANDAGE', label: 'Cahier d’épandage' },
  { value: 'DOSSIER_CONTROLE', label: 'Dossier de contrôle' },
];

export function LockCampaignDocument({ campaignYear }: { campaignYear: number }) {
  const router = useRouter();
  const toast = useToast();
  const [nature, setNature] = useState('CAHIER_EPANDAGE');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function verrouiller(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await apiPost<{ version: number; inchange: boolean }>(
        '/api/regulatory/control-file',
        { campaignYear, kind: nature },
      );
      if (resultat.inchange) {
        // Ne pas empiler des versions identiques : un historique de copies
        // conformes ne se lit plus.
        toast.info(
          'Aucune nouvelle version',
          `Le contenu est identique à la version ${resultat.version} déjà verrouillée.`,
        );
      } else {
        toast.success(
          `Verrouillé en version ${resultat.version}`,
          'Cette copie ne bougera plus, quelles que soient les saisies à venir.',
        );
      }
      router.refresh();
    } catch (err) {
      setErreur(
        err instanceof ApiRequestError ? err.message : 'Impossible de contacter le serveur.',
      );
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
      {erreur ? (
        <Alert tone="danger" className="mb-3">
          {erreur}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Document à figer" htmlFor="kind" className="min-w-[240px] flex-1">
          <Select
            id="kind"
            value={nature}
            onChange={(e) => setNature(e.target.value)}
          >
            {NATURES.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </Select>
        </Field>

        <Button onClick={verrouiller} disabled={enCours}>
          {enCours ? <Spinner /> : null}
          {enCours ? 'Verrouillage…' : `Verrouiller pour ${campaignYear}`}
        </Button>
      </div>
    </div>
  );
}
