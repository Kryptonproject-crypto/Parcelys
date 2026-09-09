import Link from 'next/link';
import type { RecommendationView } from '@/lib/services/advisory.shared';
import {
  KIND_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from '@/lib/services/advisory.shared';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  formatDateLongFr,
  formatNumberFr,
} from '@/components/ui';
import {
  IconPhyto,
  IconRegistry,
  IconSecurity,
  IconWarning,
} from '@/components/ui/icons';

const STATUS_TONES = {
  DRAFT: 'neutral',
  PROPOSED: 'amber',
  ACCEPTED: 'green',
  DECLINED: 'red',
  APPLIED: 'blue',
  WITHDRAWN: 'neutral',
} as const;

/**
 * Fiche complète d'une préconisation, identique des deux côtés.
 *
 * Volontairement identique : l'exploitant et l'expert doivent lire exactement
 * la même chose, y compris la mention de provenance du produit. Une interface
 * qui présenterait le conseil différemment selon le lecteur serait une source
 * de malentendus dans un domaine réglementé.
 */
export function RecommendationDetail({
  recommendation,
  farmLink,
}: {
  recommendation: RecommendationView;
  /** Lien vers la parcelle, propre à l'espace du lecteur. */
  farmLink?: { parcelHref: string } | null;
}) {
  const item = recommendation;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-tight text-ink">
              {item.title}
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-3">
              {KIND_LABELS[item.kind]} ·{' '}
              {item.parcelName ? (
                farmLink ? (
                  <Link
                    href={farmLink.parcelHref}
                    className="text-champ-700 hover:underline dark:text-champ-400"
                  >
                    {item.parcelName}
                  </Link>
                ) : (
                  item.parcelName
                )
              ) : (
                "toute l'exploitation"
              )}
              {item.parcelAreaHa !== null
                ? ` (${formatNumberFr(item.parcelAreaHa, 2)} ha)`
                : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Badge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
            {item.priority !== 'NORMAL' ? (
              <Badge
                tone={item.priority === 'HIGH' ? 'red' : 'neutral'}
                icon={item.priority === 'HIGH' ? IconWarning : undefined}
              >
                Priorité {PRIORITY_LABELS[item.priority].toLowerCase()}
              </Badge>
            ) : null}
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Expert
            </dt>
            <dd className="mt-0.5 text-sm text-ink">
              {item.author.name}
              {item.author.organization ? (
                <span className="block text-[12.5px] text-ink-3">
                  {item.author.organization}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Exploitation
            </dt>
            <dd className="mt-0.5 text-sm text-ink">{item.farmName}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {item.status === 'DRAFT' ? 'Créée le' : 'Transmise le'}
            </dt>
            <dd className="mt-0.5 text-sm text-ink">
              {formatDateLongFr(item.createdAt)}
            </dd>
          </div>
          {item.windowStart || item.windowEnd ? (
            <div>
              <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Fenêtre d&apos;intervention
              </dt>
              <dd className="mt-0.5 text-sm text-ink">
                {item.windowStart ? formatDateLongFr(item.windowStart) : '…'} →{' '}
                {item.windowEnd ? formatDateLongFr(item.windowEnd) : '…'}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {item.productName ? (
        <Card>
          <CardHeader
            icon={IconPhyto}
            title={item.kind === 'PHYTO' ? 'Produit préconisé' : 'Fertilisant préconisé'}
          />

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Produit
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">{item.productName}</dd>
            </div>
            {item.dose !== null ? (
              <div>
                <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Dose conseillée
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-ink">
                  {formatNumberFr(item.dose, 2)} {item.doseUnit}
                </dd>
              </div>
            ) : null}
            {item.targetLabel ? (
              <div>
                <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Cible
                </dt>
                <dd className="mt-0.5 text-sm text-ink">{item.targetLabel}</dd>
              </div>
            ) : null}
            {item.amm ? (
              <div>
                <dt className="text-[12.5px] sm:text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Numéro d&apos;AMM
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-ink">{item.amm}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-4">
            {item.productSource === 'catalogue' ? (
              <Alert tone="success" icon={IconSecurity}>
                Produit retrouvé dans le catalogue officiel <strong>E-Phy</strong>{' '}
                importé sur cette instance
                {item.ephyProduct?.status
                  ? ` — état d'autorisation : ${item.ephyProduct.status}.`
                  : '.'}{' '}
                La dose reste celle décidée par l&apos;expert : Parcelys n&apos;en
                propose aucune.
              </Alert>
            ) : (
              <Alert tone="warning" icon={IconWarning}>
                <strong>Produit non vérifié au catalogue.</strong> Aucun numéro
                d&apos;AMM n&apos;a pu être rapproché du catalogue officiel E-Phy
                importé sur cette instance. Vérifiez l&apos;autorisation, l&apos;usage
                et la dose auprès de la source officielle avant toute application.
              </Alert>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader icon={IconRegistry} title="Justification de l'expert" />
        <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-ink-2">
          {item.rationale}
        </p>
      </Card>

      {item.respondedAt ? (
        <Card>
          <CardHeader
            title="Réponse de l'exploitation"
            description={`${item.respondedBy ?? 'Exploitation'} · ${formatDateLongFr(item.respondedAt)}`}
          />
          <div className="space-y-3">
            <Badge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
            {item.responseNote ? (
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">
                {item.responseNote}
              </p>
            ) : null}
            {item.status === 'APPLIED' ? (
              <Alert tone="info">
                Cette préconisation a été mise en œuvre : l&apos;intervention
                correspondante figure au registre de l&apos;exploitation.
              </Alert>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
