import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { roleHasPermission } from '@/lib/auth/rbac';
import { requirePageParcelAccess } from '@/lib/auth/page-guards';
import { calculEnregistre } from '@/lib/regulatory/gren';
import { saisieGrenSchema } from '@/lib/regulatory/gren-calcul';
import { CalculGrenView } from '@/components/regulatory/CalculGren';
import { Card, CardHeader, PageHeader } from '@/components/ui';
import { PlanFumureForm } from '@/app/(app)/parcelles/[id]/fumure/[cropYearId]/PlanFumureForm';
import { JustificationEcart } from '@/app/(app)/parcelles/[id]/fumure/[cropYearId]/JustificationEcart';
import { comparePlanToActual } from '@/lib/regulatory/nitrogen';
import { lireRegles } from '@/lib/regulatory/regles';
import { territoiresDeLaParcelle } from '@/lib/regulatory/geography';
import { RegleTrace } from '@/components/regulatory/RegleTrace';

export const metadata: Metadata = { title: 'Plan prévisionnel de fumure' };
export const dynamic = 'force-dynamic';

/**
 * Le plan prévisionnel de fumure d'une culture.
 *
 * En haut, le plan enregistré tel qu'il a été calculé — c'est ce qu'on montre
 * en contrôle, même si le référentiel a changé depuis. En dessous, la saisie
 * pour l'établir ou le recalculer.
 */
export default async function PlanFumurePage({
  params,
}: {
  params: Promise<{ id: string; cropYearId: string }>;
}) {
  const { id, cropYearId } = await params;
  const { ctx, parcel } = await requirePageParcelAccess(id, 'record:read');

  const cropYear = await prisma.cropYear.findFirst({
    where: { id: cropYearId, parcelId: id },
    select: {
      id: true,
      campaignYear: true,
      crop: { select: { name: true } },
      nitrogenPlan: {
        select: {
          id: true,
          grenInputs: true,
          computation: true,
          openedOn: true,
          lockedAt: true,
          deviations: { orderBy: { createdAt: 'desc' }, select: { id: true, deviationKgHa: true, cause: true, occurredOn: true, tool: true, comment: true, createdAt: true } },
        },
      },
    },
  });
  if (!cropYear) notFound();

  const produits = await prisma.organicInput.findMany({
    where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    orderBy: [{ farmId: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, defaultUnit: true },
  });

  const enregistre = calculEnregistre(cropYear.nitrogenPlan?.computation ?? null);
  const comparaison = cropYear.nitrogenPlan ? await comparePlanToActual(cropYear.nitrogenPlan.id) : null;
  // Les motifs de justification d'un dépassement, tels que le texte les donne.
  const depassement = comparaison?.exceeds
    ? await lireRegles({
        referentiel: 'gren',
        territoires: await territoiresDeLaParcelle(id),
        at: new Date(),
        codes: ['gren-depassement-dose'],
      })
    : null;
  const regleDepassement = depassement?.regles[0] ?? null;
  const motifs = Array.isArray(regleDepassement?.valeur.justifications)
    ? (regleDepassement.valeur.justifications as string[])
    : [];
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const saisie = saisieGrenSchema.partial().safeParse(cropYear.nitrogenPlan?.grenInputs ?? {});

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Plan prévisionnel de fumure"
        description={`${parcel.name} — ${cropYear.crop.name}, campagne ${cropYear.campaignYear}`}
      />
      <p className="-mt-3 mb-5 text-sm">
        <Link href={`/parcelles/${id}?onglet=apports`} className="text-champ-700 hover:underline dark:text-champ-400">
          ← Retour aux apports de la parcelle
        </Link>
      </p>

      <div className="space-y-5">
        {enregistre ? (
          <Card>
            <CardHeader
              title="Plan enregistré"
              description={`Calculé le ${new Date(enregistre.calculeLe).toLocaleDateString('fr-FR')}`}
            />
            <CalculGrenView
              calcul={enregistre.calcul}
              traces={enregistre.traces}
              referentiel={enregistre.referentiel}
              lueLe={enregistre.lueLe}
            />
          </Card>
        ) : null}

        {comparaison ? (
          <Card>
            <CardHeader
              title="Prévu et réalisé"
              description={
                comparaison.perimetre === 'engrais-mineraux'
                  ? 'Engrais minéraux : les produits organiques sont déjà déduits de la dose (Xpro).'
                  : 'Tous les apports enregistrés sur la culture.'
              }
            />
            <p className="text-sm text-ink">
              Réalisé : <strong>{fmt(comparaison.actualKgHa)} kg N/ha</strong> pour{' '}
              {fmt(comparaison.plannedKgHa)} kg N/ha prévus
              {comparaison.exceeds ? ` — dépassement de ${fmt(comparaison.deviationKgHa)} kg N/ha.` : '.'}
            </p>
            {comparaison.remarques.map((r) => (
              <p key={r} className="mt-1 text-[13px] text-ink-3">
                {r}
              </p>
            ))}
            {cropYear.nitrogenPlan && cropYear.nitrogenPlan.deviations.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {cropYear.nitrogenPlan.deviations.map((d) => (
                  <li key={d.id} className="rounded-md border border-line p-2.5 text-[13px] text-ink-2">
                    Justifié le {d.createdAt.toLocaleDateString('fr-FR')} ({fmt(Number(d.deviationKgHa))} kg N/ha) : {d.cause}
                    {d.occurredOn ? ` — survenu le ${d.occurredOn.toLocaleDateString('fr-FR')}` : ''}
                    {d.tool ? ` — outil : ${d.tool}` : ''}
                    {d.comment ? <span className="block text-ink-3">{d.comment}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {comparaison.exceeds && !comparaison.justified && roleHasPermission(ctx.role, 'record:write') ? (
              <div className="mt-4 border-t border-line pt-4">
                {regleDepassement ? (
                  <>
                    <JustificationEcart cropYearId={cropYear.id} motifs={motifs} />
                    <RegleTrace trace={regleDepassement.trace} />
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">
                    {depassement?.raison ?? 'Règle de justification non disponible.'}
                  </p>
                )}
              </div>
            ) : null}
          </Card>
        ) : null}

        <PlanFumureForm
          cropYearId={cropYear.id}
          saisieInitiale={saisie.success ? saisie.data : null}
          ouvertureInitiale={cropYear.nitrogenPlan?.openedOn?.toISOString().slice(0, 10) ?? null}
          produits={produits}
          canWrite={roleHasPermission(ctx.role, 'record:write')}
          verrouille={Boolean(cropYear.nitrogenPlan?.lockedAt)}
        />
      </div>
    </div>
  );
}
