import Link from 'next/link';
import { Alert, Select } from '@/components/ui';
import { periodeCampagneLabel } from '@/lib/shared/campagne';
import type { CampagneResume } from '@/lib/services/campagnes';

/**
 * Le champ « Campagne », et l'avertissement qui va avec.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CES DEUX COMPOSANTS RÉPARENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les sélecteurs de campagne offraient huit années nues. Rien n'indiquait de
 * quelle période on parlait, ni où se trouvaient les données. Le 11 septembre
 * 2026 cela donnait ceci : la campagne en cours est 2027 — on sème pour la
 * récolte 2027 —, un dossier TéléPAC 2026 fraîchement importé pose donc ses
 * cultures en 2026, et la liste des parcelles, qui affiche 2027, annonce
 * 141 parcelles « sans culture déclarée ». Les cultures étaient bien en base.
 *
 * Deux composants, pour deux choses distinctes :
 *
 *   · `CampagneChamp` — le sélecteur, où chaque année dit ce qu'elle contient,
 *     et où la période de la campagne affichée est écrite sous le champ ;
 *   · `CampagneBanniere` — l'avertissement, affiché **seulement** quand la
 *     campagne regardée est vide alors qu'une autre ne l'est pas.
 *
 * Ce que ces composants ne font pas : basculer tout seuls sur l'autre
 * campagne. Le lien est offert, la décision reste à l'exploitant — une saisie
 * atterrissant dans une campagne qu'il n'a pas choisie serait pire que la
 * liste vide qu'on corrige ici.
 */

/** Ce que la campagne contient, résumé dans l'option : « 2026 — 141 culture(s) ». */
function libelle(c: CampagneResume): string {
  const parties: string[] = [];
  if (c.parcellesAvecCulture > 0) parties.push(`${c.parcellesAvecCulture} culture(s)`);
  if (c.ilots > 0) parties.push(`${c.ilots} îlot${c.ilots > 1 ? 's' : ''} PAC`);
  return parties.length === 0 ? `${c.year} — vide` : `${c.year} — ${parties.join(', ')}`;
}

export function CampagneChamp({
  campagnes,
  annee,
  id = 'annee',
  name = 'annee',
}: {
  campagnes: CampagneResume[];
  annee: number;
  id?: string;
  name?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
        Campagne
      </label>
      <Select id={id} name={name} defaultValue={String(annee)}>
        {campagnes.map((c) => (
          <option key={c.year} value={c.year}>
            {libelle(c)}
          </option>
        ))}
      </Select>
      <p className="mt-1 text-[11.5px] text-ink-3">{periodeCampagneLabel(annee)}</p>
    </div>
  );
}

export function CampagneBanniere({
  recommandee,
  annee,
  lien,
}: {
  /** La campagne à proposer, ou `null` : il n'y a alors rien à dire. */
  recommandee: CampagneResume | null;
  annee: number;
  /** Le lien vers cette campagne, construit par la page qui connaît ses filtres. */
  lien: (annee: number) => string;
}) {
  if (!recommandee) return null;

  return (
    <Alert tone="info" className="mb-5">
      <span>
        Aucune culture n’est déclarée sur la campagne {annee} ({periodeCampagneLabel(annee)}
        ). La campagne {recommandee.year} en compte {recommandee.parcellesAvecCulture}.{' '}
        <Link href={lien(recommandee.year)} className="font-medium underline">
          Voir la campagne {recommandee.year}
        </Link>
      </span>
    </Alert>
  );
}
