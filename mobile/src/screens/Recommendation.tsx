import { useState } from 'react';
import type { AppContext } from '../App';
import { enqueue } from '../lib/db';
import {
  RECOMMENDATION_KIND_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type CachedRecommendation,
} from '../lib/types';
import {
  ActionBar,
  Badge,
  Banner,
  Button,
  Card,
  Header,
  Textarea,
  formatDateFr,
} from '../components/ui';
import { statusTone } from './Recommendations';

/**
 * Une préconisation, telle qu'elle a été écrite.
 *
 * L'écran affiche le raisonnement de l'expert en entier — c'est lui qui
 * justifie la décision, et le tronquer serait le trahir — puis la provenance du
 * produit cité. « Vérifié au catalogue » ou « saisi par l'expert » : Parcelys ne
 * complète, ne corrige et ne devine rien.
 *
 * Accepter n'enregistre aucune intervention. Le registre réglementaire ne se
 * remplit que d'interventions réellement faites, saisies par l'exploitant.
 */
export function RecommendationScreen({
  context,
  recommendation,
}: {
  context: AppContext;
  recommendation: CachedRecommendation;
}) {
  const { back, refreshPending, online, isExpert, readOnly } = context;
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);

  const canRespond =
    !isExpert && !readOnly && recommendation.status === 'PROPOSED' && !queued;

  async function respond(decision: 'ACCEPTED' | 'DECLINED'): Promise<void> {
    setSaving(true);
    try {
      await enqueue({
        clientId: crypto.randomUUID(),
        kind: 'recommendation.respond',
        targetId: recommendation.id,
        farmId: recommendation.farmId,
        label: `${decision === 'ACCEPTED' ? 'Acceptation' : 'Refus'} — ${recommendation.title}`,
        capturedAt: new Date().toISOString(),
        attempts: 0,
        payload: {
          decision,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      await refreshPending();
      setQueued(true);
    } finally {
      setSaving(false);
    }
  }

  const window =
    recommendation.windowStart || recommendation.windowEnd
      ? `${recommendation.windowStart ? formatDateFr(recommendation.windowStart) : '…'} → ${
          recommendation.windowEnd ? formatDateFr(recommendation.windowEnd) : '…'
        }`
      : null;

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title={recommendation.title}
        subtitle={RECOMMENDATION_KIND_LABELS[recommendation.kind]}
        onBack={back}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {queued ? (
          <Banner tone="success">
            Votre réponse est enregistrée. Elle partira à la prochaine
            synchronisation.
          </Banner>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(recommendation.status)}>
            {RECOMMENDATION_STATUS_LABELS[recommendation.status]}
          </Badge>
          {recommendation.priority === 'HIGH' ? <Badge tone="red">Urgent</Badge> : null}
          {recommendation.parcelName ? (
            <Badge>{recommendation.parcelName}</Badge>
          ) : (
            <Badge>Toute l&apos;exploitation</Badge>
          )}
        </div>

        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Pourquoi
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {recommendation.rationale}
          </p>
          <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink-3">
            {recommendation.author.name}
            {recommendation.author.organization
              ? ` · ${recommendation.author.organization}`
              : ''}
            {' · '}
            {formatDateFr(recommendation.createdAt)}
          </p>
        </Card>

        {recommendation.productName ? (
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Produit conseillé
            </p>
            <p className="mt-1 font-semibold text-ink">{recommendation.productName}</p>
            <dl className="mt-2 space-y-1.5 text-[13.5px]">
              {recommendation.amm ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">N° AMM</dt>
                  <dd className="text-ink">{recommendation.amm}</dd>
                </div>
              ) : null}
              {recommendation.dose != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Dose conseillée</dt>
                  <dd className="tabular-nums text-ink">
                    {recommendation.dose} {recommendation.doseUnit ?? ''}
                  </dd>
                </div>
              ) : null}
              {recommendation.targetLabel ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Cible</dt>
                  <dd className="text-ink">{recommendation.targetLabel}</dd>
                </div>
              ) : null}
              {window ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Fenêtre</dt>
                  <dd className="text-ink">{window}</dd>
                </div>
              ) : null}
            </dl>

            <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-3">
              {recommendation.productSource === 'catalogue'
                ? 'AMM retrouvée dans le catalogue officiel E-Phy. Vérifiez toujours l’étiquette et l’usage autorisé avant application.'
                : 'Produit saisi par l’expert, sans correspondance au catalogue officiel E-Phy. Vérifiez l’AMM, l’usage et la dose sur l’étiquette avant application.'}
            </p>
          </Card>
        ) : null}

        {recommendation.responseNote ? (
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Réponse de l&apos;exploitation
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">
              {recommendation.responseNote}
            </p>
          </Card>
        ) : null}

        {canRespond ? (
          <>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Remarque à l'attention de votre conseiller (facultatif)"
              aria-label="Remarque"
            />
            {!online ? (
              <Banner tone="warning">
                Hors réseau. Votre réponse est conservée sur le téléphone et
                partira à la reconnexion.
              </Banner>
            ) : null}
            <Banner tone="info">
              Accepter ne remplit aucun registre : enregistrez le traitement
              depuis la parcelle une fois l&apos;intervention réellement faite.
            </Banner>
          </>
        ) : null}
      </div>

      {canRespond ? (
        <ActionBar>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              loading={saving}
              onClick={() => void respond('DECLINED')}
            >
              Écarter
            </Button>
            <Button loading={saving} onClick={() => void respond('ACCEPTED')}>
              Accepter
            </Button>
          </div>
        </ActionBar>
      ) : null}
    </div>
  );
}
