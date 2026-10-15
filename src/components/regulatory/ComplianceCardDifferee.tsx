import { Card } from '@/components/ui';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { ComplianceCard } from '@/components/regulatory/ComplianceCard';

/**
 * La carte de conformité, calculée **après** le reste de la page.
 *
 * La synthèse relit toute la campagne : parcelles, zonages, apports,
 * traitements, couverts, distances aux cours d'eau. Sur un Raspberry Pi, cela
 * se compte en secondes — et le tableau de bord attendait la fin du calcul
 * pour afficher quoi que ce soit, y compris ce qui était prêt depuis
 * longtemps. Posée dans un `<Suspense>`, elle arrive quand elle est prête :
 * le contenu est le même, seul l'ordre d'arrivée change.
 */
export async function ComplianceCardDifferee({
  farmId,
  campaignYear,
}: {
  farmId: string;
  campaignYear: number;
}) {
  const report = await buildComplianceReport({ farmId, campaignYear });
  return <ComplianceCard report={report} />;
}

/** Ce qui s'affiche le temps du calcul : rien n'y est encore conclu. */
export function ComplianceCardEnAttente({ campaignYear }: { campaignYear: number }) {
  return (
    <Card>
      <h2 className="text-[16px] font-semibold text-ink">Conformité — campagne {campaignYear}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-3" role="status">
        Analyse de la campagne en cours…
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[62px] animate-pulse rounded-lg border border-line bg-surface-2" />
        ))}
      </div>
    </Card>
  );
}
