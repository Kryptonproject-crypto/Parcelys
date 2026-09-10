import type { Metadata } from 'next';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { computeFarmIft } from '@/lib/regulatory/ift';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { Badge, Card, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conformité' };

/**
 * Synthèse de conformité d'une campagne.
 *
 * L'un des trois seuls écrans ajoutés par le socle réglementaire : tout le
 * reste s'insère dans des pages existantes. Celui-ci n'a pas d'équivalent —
 * c'est la vue transversale qu'un exploitant ouvre avant un contrôle.
 *
 * Il ne dit jamais « vous êtes conforme ». Voir `buildComplianceReport`.
 */

const TONS: Record<string, { badge: 'green' | 'neutral' | 'amber' | 'red'; libelle: string }> = {
  OK: { badge: 'green', libelle: 'Vérifié' },
  INDETERMINE: { badge: 'neutral', libelle: 'Non vérifiable' },
  VERIFICATION: { badge: 'amber', libelle: 'À vérifier' },
  ANOMALIE: { badge: 'red', libelle: 'Anomalie' },
};

const DOMAINES: Record<string, string> = {
  ZONAGE: 'Zonages',
  NITRATES: 'Nitrates et fertilisation',
  GREN: 'Référentiel de calcul',
  IFT: 'IFT',
  PHYTO: 'Phytosanitaire',
  PAC: 'PAC',
  COUVERTURE: 'Couverture des sols',
};

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>;
}) {
  const ctx = await requirePageFarmAccess('record:read');
  const { annee } = await searchParams;
  const campagne = Number(annee) || currentCampaignYear();

  const [rapport, ift] = await Promise.all([
    buildComplianceReport({ farmId: ctx.farmId, campaignYear: campagne }),
    computeFarmIft({ farmId: ctx.farmId, campaignYear: campagne }),
  ]);

  const parDomaine = new Map<string, typeof rapport.findings>();
  for (const finding of rapport.findings) {
    const liste = parDomaine.get(finding.domain) ?? [];
    liste.push(finding);
    parDomaine.set(finding.domain, liste);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Conformité"
        description={`Campagne ${campagne} — synthèse des vérifications automatiques`}
      />

      <Card className="mb-5">
        <p className="text-[15px] leading-relaxed text-ink">{rapport.summary}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['ANOMALIE', 'VERIFICATION', 'INDETERMINE', 'OK'] as const).map((niveau) => (
            <div key={niveau} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              <p className="text-[24px] font-semibold tabular-nums text-ink">
                {rapport.counts[niveau]}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{TONS[niveau]?.libelle}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-3">
          Parcelys ne se prononce jamais sur la conformité légale d’une
          exploitation : il constate ce que ses données et ses référentiels
          permettent de constater. Une vérification impossible n’est pas une
          vérification réussie.
        </p>
      </Card>

      {/* IFT — affiché même absent, pour que son absence se voie. */}
      <Card className="mb-5">
        <h2 className="text-[16px] font-semibold text-ink">Indicateur de fréquence de traitement</h2>
        {ift.configured ? (
          <>
            <p className="mt-2 text-[28px] font-semibold tabular-nums text-ink">
              {ift.total?.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
            </p>
            <ul className="mt-2 flex flex-wrap gap-3 text-[13.5px] text-ink-2">
              {Object.entries(ift.byCategory).map(([categorie, valeur]) => (
                <li key={categorie}>
                  <span className="text-ink-3">{categorie} : </span>
                  <span className="tabular-nums">
                    {valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-3">
              {ift.source?.sourceLabel} — version {ift.source?.version} ·{' '}
              {ift.computed} traitement(s) pris en compte
            </p>
          </>
        ) : (
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{ift.caveats[0]}</p>
        )}
        {ift.caveats.slice(ift.configured ? 0 : 1).map((c) => (
          <p key={c} className="mt-2 text-[13px] leading-relaxed text-ink-3">{c}</p>
        ))}
      </Card>

      {[...parDomaine.entries()].map(([domaine, findings]) => (
        <Card key={domaine} className="mb-4">
          <h2 className="text-[16px] font-semibold text-ink">
            {DOMAINES[domaine] ?? domaine}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {findings.map((finding, index) => (
              <li
                key={`${finding.code}-${finding.parcelId ?? index}`}
                className="rounded-lg border border-line p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONS[finding.level]?.badge ?? 'neutral'}>
                    {TONS[finding.level]?.libelle}
                  </Badge>
                  <span className="text-[14.5px] font-medium text-ink">{finding.title}</span>
                </div>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{finding.detail}</p>
                {finding.action ? (
                  <p className="mt-1.5 text-[13px] text-ink-3">→ {finding.action}</p>
                ) : null}
                {finding.sourceLabel ? (
                  <p className="mt-1.5 border-t border-line pt-1.5 text-[11.5px] text-ink-3">
                    Règle issue de {finding.sourceLabel}
                    {finding.referentialVersion ? `, version ${finding.referentialVersion}` : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {rapport.findings.length === 0 ? (
        <Card>
          <p className="text-[14px] text-ink-2">
            Aucun point à signaler pour cette campagne, d’après les données et
            référentiels disponibles.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
