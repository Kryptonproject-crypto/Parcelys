import type { AppContext } from '../App';
import {
  RECOMMENDATION_KIND_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type CachedRecommendation,
} from '../lib/types';
import { ActionBar, Badge, Button, Card, EmptyState, Header } from '../components/ui';

/** Couleur d'état : l'attente ressort, le reste est neutre. */
export function statusTone(
  status: CachedRecommendation['status'],
): 'neutral' | 'green' | 'amber' | 'red' {
  if (status === 'PROPOSED') return 'amber';
  if (status === 'ACCEPTED' || status === 'APPLIED') return 'green';
  if (status === 'DECLINED') return 'red';
  return 'neutral';
}

/**
 * Préconisations de l'exploitation ouverte.
 *
 * Le même écran sert aux deux métiers, avec la même liste : l'exploitant y voit
 * ce qu'on lui propose, l'expert ce qu'il a transmis — et ses brouillons, que
 * lui seul voit. Rien n'est reformulé d'un côté ou de l'autre.
 */
export function RecommendationsScreen({ context }: { context: AppContext }) {
  const { snapshot, back, navigate, isExpert, readOnly } = context;
  const recommendations = snapshot?.recommendations ?? [];

  const waiting = recommendations.filter((item) => item.status === 'PROPOSED');
  const others = recommendations.filter((item) => item.status !== 'PROPOSED');

  const renderItem = (item: CachedRecommendation) => (
    <li key={item.id}>
      <Card onClick={() => navigate({ name: 'recommendation', recommendationId: item.id })}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{item.title}</p>
            <p className="truncate text-[13px] text-ink-3">
              {RECOMMENDATION_KIND_LABELS[item.kind]}
              {item.parcelName ? ` · ${item.parcelName}` : ' · toute l’exploitation'}
            </p>
            <p className="truncate text-[12.5px] text-ink-3">
              {isExpert ? 'Vous' : item.author.name}
              {item.author.organization && !isExpert ? ` · ${item.author.organization}` : ''}
            </p>
          </div>
          <span className="shrink-0 space-y-1 text-right">
            <Badge tone={statusTone(item.status)}>
              {RECOMMENDATION_STATUS_LABELS[item.status]}
            </Badge>
            {item.priority === 'HIGH' ? (
              <span className="block">
                <Badge tone="red">Urgent</Badge>
              </span>
            ) : null}
          </span>
        </div>
      </Card>
    </li>
  );

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Préconisations"
        subtitle={snapshot?.farm.name}
        onBack={back}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {recommendations.length === 0 ? (
          <EmptyState
            title="Aucune préconisation"
            description={
              isExpert
                ? 'Rédigez-en une depuis une parcelle : elle partira à la prochaine synchronisation.'
                : 'Votre conseiller n’a transmis aucune préconisation pour cette campagne.'
            }
          />
        ) : (
          <>
            {waiting.length > 0 ? (
              <section>
                <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
                  En attente de décision ({waiting.length})
                </h2>
                <ul className="space-y-2.5">{waiting.map(renderItem)}</ul>
              </section>
            ) : null}

            {others.length > 0 ? (
              <section>
                <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
                  Historique
                </h2>
                <ul className="space-y-2.5">{others.map(renderItem)}</ul>
              </section>
            ) : null}
          </>
        )}
      </div>

      {/* Rédiger est réservé à l'expert missionné : la même règle qu'en ligne. */}
      {isExpert && readOnly ? (
        <ActionBar>
          <Button full onClick={() => navigate({ name: 'new-recommendation' })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            Rédiger une préconisation
          </Button>
        </ActionBar>
      ) : null}
    </div>
  );
}
