import Link from 'next/link';
import { Card } from '@/components/ui';
import { GroupeConstats, TONS_CONSTAT as TONS } from '@/components/regulatory/GroupeConstats';
import { regrouperConstats } from '@/lib/regulatory/regrouper-constats';
import type { ComplianceReport } from '@/lib/regulatory/compliance';

/**
 * Carte de conformité, ajoutée au tableau de bord existant.
 *
 * ## La couleur ne ment pas
 *
 * Trois niveaux, trois traitements visuels, et surtout : **`INDETERMINE` n'est
 * jamais vert**. C'est la tentation de tous les tableaux de bord de conformité —
 * afficher au vert ce qui n'a pas pu être vérifié, parce qu'il n'y a rien à
 * signaler. Or « rien à signaler » et « rien vérifié » ne se ressemblent que
 * pour qui ne lit pas.
 *
 * Un indéterminé s'affiche donc en gris, avec sa raison. Un exploitant qui voit
 * huit gris sait qu'il n'a rien vérifié du tout ; un exploitant qui verrait huit
 * verts croirait le contraire.
 */

export function ComplianceCard({ report }: { report: ComplianceReport }) {
  const { counts } = report;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold text-ink">
          Conformité — campagne {report.campaignYear}
        </h2>
        <Link
          href="/conformite"
          className="text-[13px] text-champ-700 hover:underline dark:text-champ-400"
        >
          Tout voir
        </Link>
      </div>

      {/*
        La phrase de synthèse vient du moteur, pas de l'interface. Reformulée
        ici, elle finirait par affirmer la conformité — c'est toujours la
        reformulation qui la promet.
      */}
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{report.summary}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {(['ANOMALIE', 'VERIFICATION', 'INDETERMINE'] as const).map((niveau) => (
          <div
            key={niveau}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2.5"
          >
            <p className="text-[22px] font-semibold tabular-nums text-ink">
              {counts[niveau]}
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">{TONS[niveau]?.libelle}</p>
          </div>
        ))}
      </div>

      {report.missingReferentials.length > 0 ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-[13px] font-medium text-ink-2">
            {report.missingReferentials.length} référentiel
            {report.missingReferentials.length > 1 ? 's' : ''} non importé
            {report.missingReferentials.length > 1 ? 's' : ''}
          </p>
          <ul className="mt-1.5 space-y-1">
            {report.missingReferentials.slice(0, 3).map((ref) => (
              <li key={ref.code} className="text-[12.5px] leading-relaxed text-ink-3">
                <span className="text-ink-2">{ref.name}</span> — {ref.degradedWithout}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        Les constats identiques réunis : « Parcelle en zone vulnérable — 120
        parcelles » une fois, au lieu de cent vingt cartes qui noyaient
        l'anomalie unique.
      */}
      {report.findings.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {regrouperConstats(
            report.findings.filter((f) => f.level === 'ANOMALIE' || f.level === 'VERIFICATION'),
          )
            .slice(0, 4)
            .map((groupe) => (
              <GroupeConstats key={groupe.cle} groupe={groupe} detailDeplie={false} />
            ))}
        </ul>
      ) : null}
    </Card>
  );
}
