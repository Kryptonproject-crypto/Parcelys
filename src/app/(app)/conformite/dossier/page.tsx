import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import {
  assemblerDossier,
  documentsVerrouilles,
} from '@/lib/regulatory/control-file';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import {
  Alert,
  Badge,
  Card,
  PageHeader,
  Td,
  Th,
  Tr,
  TableWrapper,
  formatDateFr,
} from '@/components/ui';
import { LockCampaignDocument } from '@/app/(app)/conformite/dossier/LockCampaignDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dossier de contrôle' };

/**
 * Dossier de contrôle d'une campagne.
 *
 * Une page à part, et non un onglet de la synthèse de conformité : les deux
 * répondent à des questions différentes. La synthèse dit « qu'est-ce qui cloche
 * dans mes données » ; le dossier dit « qu'est-ce que je sors si on sonne
 * demain ».
 *
 * L'avertissement est en tête et il est important. Ce dossier n'est pas la
 * liste des pièces exigibles : c'est ce que Parcelys sait assembler. Un
 * exploitant qui croirait le contraire arriverait au contrôle sans une pièce
 * que Parcelys ignore.
 */

const TONS = {
  presente: { badge: 'green' as const, libelle: 'Présente' },
  incomplete: { badge: 'amber' as const, libelle: 'Incomplète' },
  perimee: { badge: 'amber' as const, libelle: 'Périmée' },
  absente: { badge: 'red' as const, libelle: 'Absente' },
};

const NATURES: Record<string, string> = {
  REGISTRE_PHYTO: 'Registre phytosanitaire',
  CAHIER_EPANDAGE: 'Cahier d’épandage',
  CEP: 'Cahier d’enregistrement des pratiques',
  PPF: 'Plan prévisionnel de fumure',
  DOSSIER_CONTROLE: 'Dossier de contrôle',
};

export default async function ControlFilePage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>;
}) {
  const ctx = await requirePageFarmAccess('record:read');
  const { annee } = await searchParams;
  const campagne = Number(annee) || currentCampaignYear();

  const [dossier, verrous] = await Promise.all([
    assemblerDossier({ farmId: ctx.farmId, campaignYear: campagne }),
    documentsVerrouilles({ farmId: ctx.farmId, campaignYear: campagne }),
  ]);

  const aTraiter = dossier.pieces.filter((p) => p.statut !== 'presente');

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Dossier de contrôle"
        description={`Campagne ${campagne} — les pièces rassemblées, et ce qui manque`}
      />

      <Alert tone="info" className="mb-5">
        {dossier.avertissement}
      </Alert>

      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['absente', 'incomplete', 'perimee', 'presente'] as const).map((statut) => (
            <div
              key={statut}
              className="rounded-lg border border-line bg-surface-2 px-3 py-2.5"
            >
              <p className="text-[24px] font-semibold tabular-nums text-ink">
                {dossier.compte[statut]}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{TONS[statut].libelle}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Ce qui manque d'abord : c'est la raison d'ouvrir cette page. */}
      {aTraiter.length > 0 ? (
        <Card className="mb-5">
          <h2 className="text-[16px] font-semibold text-ink">À réunir</h2>
          <ul className="mt-3 space-y-3">
            {aTraiter.map((piece) => (
              <li key={piece.code} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge tone={TONS[piece.statut].badge}>{TONS[piece.statut].libelle}</Badge>
                  <span className="text-[15px] font-medium text-ink">{piece.label}</span>
                </div>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{piece.detail}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{piece.usage}</p>
                {piece.action ? (
                  <p className="mt-1 text-[13px] text-champ-700">{piece.action}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-5">
        <h2 className="text-[16px] font-semibold text-ink">Toutes les pièces</h2>
        <TableWrapper className="mt-3">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr>
                <Th>Pièce</Th>
                <Th>État</Th>
                <Th>Constat</Th>
              </tr>
            </thead>
            <tbody>
              {dossier.pieces.map((piece) => (
                <Tr key={piece.code}>
                  <Td>
                    <span className="font-medium text-ink">{piece.label}</span>
                    <span className="block text-[12px] text-ink-3">{piece.usage}</span>
                  </Td>
                  <Td>
                    <Badge tone={TONS[piece.statut].badge}>
                      {TONS[piece.statut].libelle}
                    </Badge>
                  </Td>
                  <Td>
                    {piece.detail}
                    {piece.documents.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {piece.documents.map((d) => (
                          <li key={d.id} className="text-[12.5px] text-ink-3">
                            {d.fileName}
                            {d.reference ? ` · nº ${d.reference}` : ''}
                            {d.validUntil
                              ? ` · valable jusqu’au ${formatDateFr(d.validUntil)}`
                              : ' · sans date de validité renseignée'}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </TableWrapper>
      </Card>

      {/* Verrouillage */}
      <Card className="mb-5">
        <h2 className="text-[16px] font-semibold text-ink">Documents verrouillés</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
          Verrouiller n’empêche pas de saisir : cela crée une <strong>copie datée</strong>{' '}
          qui ne bougera plus. C’est ce qui permet de répondre, deux ans plus
          tard, à « que contenait le registre que vous avez présenté ? ». Rien
          n’est jamais écrasé — une nouvelle version s’ajoute à côté.
        </p>

        <LockCampaignDocument campaignYear={campagne} />

        {verrous.length === 0 ? (
          <p className="mt-3 text-[13.5px] text-ink-3">
            Aucun document verrouillé pour cette campagne.
          </p>
        ) : (
          <TableWrapper className="mt-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>Document</Th>
                  <Th>Version</Th>
                  <Th>Verrouillé le</Th>
                  <Th>Lignes</Th>
                  <Th>Lacunes au verrouillage</Th>
                </tr>
              </thead>
              <tbody>
                {verrous.map((v) => (
                  <Tr key={v.id}>
                    <Td>{NATURES[v.kind] ?? v.kind}</Td>
                    <Td className="tabular-nums">v{v.version}</Td>
                    <Td>{formatDateFr(v.lockedAt)}</Td>
                    <Td className="tabular-nums">{v.rowCount}</Td>
                    {/* Conservées avec le document : un registre incomplet reste
                        incomplet, et effacer ses lacunes le maquillerait. */}
                    <Td className="text-ink-3">{v.gaps ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableWrapper>
        )}
      </Card>

      <Card>
        <h2 className="text-[16px] font-semibold text-ink">Référentiels employés</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Un chiffre opposé lors d’un contrôle doit pouvoir nommer sa source et
          sa version.
        </p>
        <ul className="mt-3 space-y-1.5 text-[13.5px]">
          {dossier.referentiels.map((r) => (
            <li key={r.code} className="flex flex-wrap items-baseline gap-2">
              <Badge tone={r.status === 'ACTIF' ? 'green' : 'neutral'}>
                {r.status === 'ACTIF' ? 'importé' : 'non configuré'}
              </Badge>
              <span className="text-ink">{r.name}</span>
              {r.version ? (
                <span className="text-ink-3">version {r.version}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-ink-3">
          <Link href="/conformite" className="text-champ-700 underline-offset-2 hover:underline">
            Voir la synthèse de conformité
          </Link>{' '}
          — elle dit ce qui cloche dans les données ; ce dossier dit ce qui manque
          dans les pièces.
        </p>
      </Card>
    </div>
  );
}
