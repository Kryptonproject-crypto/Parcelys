'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import type { RecommendationView } from '@/lib/services/advisory.shared';
import { KIND_LABELS } from '@/lib/services/advisory.shared';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  LinkButton,
  Textarea,
} from '@/components/ui';
import { IconCheck, IconClose, IconPlus } from '@/components/ui/icons';

/**
 * Décision de l'exploitant sur une préconisation.
 *
 * Accepter ne remplit aucun registre, et c'est délibéré : un registre
 * phytosanitaire consigne ce qui a été fait, pas ce qui était conseillé.
 * L'écran propose donc, après acceptation, d'ouvrir la saisie **pré-remplie**
 * de l'intervention — que l'exploitant complète et valide lui-même, quand elle
 * a réellement eu lieu.
 */
export function FarmerActions({
  recommendation,
  canRespond,
}: {
  recommendation: RecommendationView;
  canRespond: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'ACCEPTED' | 'DECLINED' | null>(null);

  async function respond(decision: 'ACCEPTED' | 'DECLINED'): Promise<void> {
    setBusy(decision);
    try {
      await apiPost(`/api/recommendations/${recommendation.id}/response`, {
        decision,
        note,
      });
      toast.success(
        decision === 'ACCEPTED'
          ? 'Préconisation acceptée. Enregistrez l’intervention lorsqu’elle aura eu lieu.'
          : 'Préconisation écartée. L’expert en est informé.',
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Action impossible.',
      );
    } finally {
      setBusy(null);
    }
  }

  /** Ouvre la saisie de l'intervention, pré-remplie depuis la préconisation. */
  function entryHref(): string | null {
    if (!recommendation.parcelId) return null;

    const params = new URLSearchParams({ preconisation: recommendation.id });
    if (recommendation.kind === 'PHYTO') {
      params.set('onglet', 'phytosanitaire');
      if (recommendation.productName) params.set('produit', recommendation.productName);
      if (recommendation.amm) params.set('amm', recommendation.amm);
      if (recommendation.dose !== null) params.set('dose', String(recommendation.dose));
      if (recommendation.doseUnit) params.set('unite', recommendation.doseUnit);
      if (recommendation.targetLabel) params.set('cible', recommendation.targetLabel);
    } else if (recommendation.kind === 'FERTILIZATION') {
      params.set('onglet', 'apports');
      if (recommendation.productName) params.set('produit', recommendation.productName);
      if (recommendation.dose !== null) params.set('dose', String(recommendation.dose));
      if (recommendation.doseUnit) params.set('unite', recommendation.doseUnit);
    } else {
      params.set('onglet', 'travaux');
    }

    return `/parcelles/${recommendation.parcelId}?${params.toString()}`;
  }

  if (recommendation.status === 'APPLIED') {
    return (
      <Alert tone="success" icon={IconCheck}>
        Cette préconisation a été réalisée : l&apos;intervention correspondante
        figure à votre registre.
      </Alert>
    );
  }

  if (recommendation.status === 'WITHDRAWN') {
    return (
      <Alert tone="warning">
        L&apos;expert a retiré cette préconisation. Elle reste consultable pour
        mémoire.
      </Alert>
    );
  }

  if (recommendation.status === 'ACCEPTED') {
    const href = entryHref();
    return (
      <Card>
        <CardHeader
          title="Préconisation acceptée"
          description="Enregistrez l'intervention lorsqu'elle aura été réalisée."
        />
        <div className="flex flex-wrap items-center gap-3">
          {href ? (
            <LinkButton href={href} icon={IconPlus}>
              Saisir l&apos;intervention
            </LinkButton>
          ) : (
            <p className="text-sm text-ink-3">
              Cette préconisation ne vise pas une parcelle précise : enregistrez
              l&apos;intervention depuis la parcelle concernée.
            </p>
          )}
          <p className="text-[13px] text-ink-3">
            Le formulaire s&apos;ouvrira pré-rempli. Vérifiez chaque valeur avant
            d&apos;enregistrer : c&apos;est votre registre qui fait foi.
          </p>
        </div>
      </Card>
    );
  }

  if (recommendation.status === 'DECLINED') {
    return (
      <Alert tone="info">
        Vous avez écarté cette préconisation
        {recommendation.responseNote ? ` : « ${recommendation.responseNote} »` : '.'}
      </Alert>
    );
  }

  // PROPOSED — en attente de décision.
  if (!canRespond) {
    return (
      <Alert tone="info">
        Cette préconisation attend une décision. Votre rôle ne permet pas d&apos;y
        répondre : un propriétaire, un administrateur ou un salarié de
        l&apos;exploitation doit se prononcer.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Votre décision"
        description={`${KIND_LABELS[recommendation.kind]} proposé par ${recommendation.author.name}.`}
      />

      <div className="space-y-4">
        <Field
          label="Commentaire"
          htmlFor="response-note"
          hint="Facultatif, transmis à l'expert. Utile pour expliquer un refus."
        >
          <Textarea
            id="response-note"
            value={note}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Parcelle déjà traitée la semaine dernière…"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button
            icon={IconCheck}
            loading={busy === 'ACCEPTED'}
            disabled={busy !== null}
            onClick={() => void respond('ACCEPTED')}
          >
            Accepter
          </Button>
          <Button
            variant="outline"
            icon={IconClose}
            loading={busy === 'DECLINED'}
            disabled={busy !== null}
            onClick={() => void respond('DECLINED')}
          >
            Écarter
          </Button>
        </div>
      </div>
    </Card>
  );
}
