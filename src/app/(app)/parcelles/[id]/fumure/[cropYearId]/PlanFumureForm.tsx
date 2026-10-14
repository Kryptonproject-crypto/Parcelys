'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, Select, Spinner } from '@/components/ui';
import { CalculGrenView } from '@/components/regulatory/CalculGren';
import type { CalculGren, ChampTableau, DescriptionSaisie, SaisieGren } from '@/lib/regulatory/gren-calcul';
import type { Trace } from '@/lib/regulatory/regles';

type Resultat = {
  calcul: CalculGren;
  traces: Record<string, Trace>;
  referentiel: { code: string; version: string; source: string } | null;
  lueLe: string;
};

type Description = {
  description: DescriptionSaisie;
  referentiel: { code: string; version: string; source: string } | null;
  raison: string | null;
  lueLe: string;
  departement: string | null;
  cultureDHiver: boolean | null;
  rendements: Array<{ campagne: number; valeur: number; unite: string | null }>;
};

type Brouillon = Partial<SaisieGren> & {
  choix: Record<string, Record<string, string>>;
  mesures: Record<string, { valeur: number; justification: string }>;
  sansObjet: NonNullable<SaisieGren['sansObjet']>;
  apportsPrevus: NonNullable<SaisieGren['apportsPrevus']>;
};

/** Le champ en clair, depuis le chemin rendu par la validation. */
const CHAMPS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^saisie\.besoin\.valeur$/, () => 'besoin unitaire de la variété'],
  [/^saisie\.besoin\.justification$/, () => 'justification du besoin unitaire'],
  [/^saisie\.objectif\.valeur$/, () => 'objectif de rendement'],
  [/^saisie\.objectif\.justification$/, () => 'justification de l’objectif'],
  [/^saisie\.objectif\.cultureFiche20$/, () => 'culture de la fiche 20'],
  [/^saisie\.mesures\.(\w+)\.valeur$/, (m) => `${m[1]} mesuré`],
  [/^saisie\.mesures\.(\w+)\.justification$/, (m) => `justification de ${m[1]}`],
  [/^saisie\.apportsPrevus\.(\d+)\.dose$/, (m) => `dose de l’apport prévu n° ${Number(m[1]) + 1}`],
  [/^saisie\.apportsPrevus\.(\d+)\.date$/, (m) => `date de l’apport prévu n° ${Number(m[1]) + 1}`],
  [/^saisie\.irrigation/, () => 'irrigation'],
  [/^saisie\.culture$/, () => 'culture'],
];

function champsEnClair(err: ApiRequestError): string {
  const details = (err.details as Array<{ field?: string }> | undefined) ?? [];
  const noms = details.map((d) => {
    const champ = d.field ?? '';
    for (const [motif, nom] of CHAMPS) {
      const m = champ.match(motif);
      if (m) return nom(m);
    }
    return champ;
  });
  return noms.length > 0 ? `${err.message} — à compléter : ${[...new Set(noms)].join(', ')}.` : err.message;
}

const nombre = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/**
 * Le plan prévisionnel de fumure d'une culture, saisi **dans les termes des
 * fiches GREN** : l'écran ne demande que ce que la fiche de la culture
 * demande, avec les choix des tableaux de la fiche — rien d'autre, rien
 * d'inventé. Le calcul se fait côté serveur, sur les règles en vigueur à la
 * date du bilan.
 */
export function PlanFumureForm({
  cropYearId,
  saisieInitiale,
  ouvertureInitiale,
  produits,
  canWrite,
  verrouille,
}: {
  cropYearId: string;
  saisieInitiale: Partial<SaisieGren> | null;
  ouvertureInitiale: string | null;
  produits: Array<{ id: string; name: string; defaultUnit: string }>;
  canWrite: boolean;
  verrouille: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [saisie, setSaisie] = useState<Brouillon>({
    choix: {},
    mesures: {},
    sansObjet: [],
    apportsPrevus: [],
    ...(saisieInitiale ?? {}),
  } as Brouillon);
  const [ouverture, setOuverture] = useState<string>(ouvertureInitiale ?? '');
  // Volume et teneur se saisissent séparément ; l'irrigation n'est retenue que
  // quand les deux sont connus — jamais une teneur nulle par défaut.
  const [irrigation, setIrrigation] = useState({
    v: saisieInitiale?.irrigation ? String(saisieInitiale.irrigation.volumeMm) : '',
    c: saisieInitiale?.irrigation ? String(saisieInitiale.irrigation.nitratesMgL) : '',
  });
  const majIrrigation = (patch: Partial<{ v: string; c: string }>) => {
    const next = { ...irrigation, ...patch };
    setIrrigation(next);
    const v = nombre(next.v);
    const c = nombre(next.c);
    maj({ irrigation: v !== undefined && c !== undefined ? { volumeMm: v, nitratesMgL: c } : undefined });
  };
  const [desc, setDesc] = useState<Description | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // La fiche demande des choses différentes selon la culture et l'espèce :
  // la description se relit à chaque changement de l'une ou de l'autre.
  useEffect(() => {
    let annule = false;
    setChargement(true);
    apiPost<Description>(`/api/crop-years/${cropYearId}/fumure`, {
      action: 'decrire',
      saisie: { ...(saisie.culture ? { culture: saisie.culture } : {}), ...(saisie.espece ? { espece: saisie.espece } : {}) },
    })
      .then((d) => {
        if (!annule) setDesc(d);
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de lire les fiches du référentiel.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [cropYearId, saisie.culture, saisie.espece]);

  const maj = (patch: Partial<Brouillon>) => {
    setSaisie((s) => ({ ...s, ...patch }));
    setResultat(null);
  };
  const choisir = (terme: string, cle: string, valeur: string) => {
    setSaisie((s) => {
      const actuel = { ...(s.choix[terme] ?? {}) };
      if (valeur) actuel[cle] = valeur;
      else delete actuel[cle];
      return { ...s, choix: { ...s.choix, [terme]: actuel } };
    });
    setResultat(null);
  };
  const basculerSansObjet = (terme: string, actif: boolean) => {
    const t = terme as NonNullable<SaisieGren['sansObjet']>[number];
    maj({ sansObjet: actif ? [...saisie.sansObjet.filter((x) => x !== t), t] : saisie.sansObjet.filter((x) => x !== t) });
  };

  async function envoyer(action: 'calculer' | 'enregistrer') {
    if (!saisie.culture) {
      setErreur('Choisissez la culture au sens de la fiche 1.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await apiPost<Resultat & { message?: string }>(`/api/crop-years/${cropYearId}/fumure`, {
        action,
        saisie,
        ouverture: ouverture || null,
      });
      setResultat(r);
      if (action === 'enregistrer') {
        toast.success(r.message ?? 'Plan enregistré');
        router.refresh();
      }
    } catch (err) {
      setErreur(err instanceof ApiRequestError ? champsEnClair(err) : 'Calcul impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  const d = desc?.description ?? null;
  const champTableau = (champ: ChampTableau, cleTerme: string) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {champ.cles
        .filter((c) => c.partage !== 'typeSol')
        .map((c) => (
          <Field key={c.nom} label={c.libelle} htmlFor={`${cleTerme}-${c.nom}`}>
            <Select
              id={`${cleTerme}-${c.nom}`}
              value={saisie.choix[cleTerme]?.[c.nom] ?? ''}
              onChange={(e) => choisir(cleTerme, c.nom, e.target.value)}
              disabled={verrouille}
            >
              <option value="">—</option>
              {c.options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.libelle}
                </option>
              ))}
            </Select>
          </Field>
        ))}
    </div>
  );

  const champsIrrigation = (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <Checkbox
          checked={saisie.sansObjet.includes('Nirr')}
          onChange={(e) => basculerSansObjet('Nirr', e.target.checked)}
          disabled={verrouille}
        />
        Parcelle non irriguée pendant la campagne
      </label>
      {!saisie.sansObjet.includes('Nirr') ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Volume d’eau apporté (mm/an)" htmlFor="irr-v">
            <Input
              id="irr-v"
              inputMode="decimal"
              value={irrigation.v}
              onChange={(e) => majIrrigation({ v: e.target.value })}
              disabled={verrouille}
            />
          </Field>
          <Field label="Nitrates de l’eau (mg NO₃/L)" htmlFor="irr-c" hint="Analyse de l’eau d’irrigation.">
            <Input
              id="irr-c"
              inputMode="decimal"
              value={irrigation.c}
              onChange={(e) => majIrrigation({ c: e.target.value })}
              disabled={verrouille}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );

  const champsXpro = (
    <div className="space-y-2">
      <Field
        label="Groupe de culture du tableau Kéq (fiche 19)"
        htmlFor="keq"
        hint="Utilisé pour les produits organiques apportés ou prévus sur la culture."
      >
        <Select
          id="keq"
          value={saisie.groupeCultureKeq ?? ''}
          onChange={(e) => maj({ groupeCultureKeq: e.target.value || undefined })}
          disabled={verrouille}
        >
          <option value="">—</option>
          {(d?.groupesKeq ?? []).map((g) => (
            <option key={g.code} value={g.code}>
              {g.libelle}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-[12.5px] text-ink-3">
        Les apports organiques déjà enregistrés sur cette culture sont pris d’eux-mêmes. Ajoutez
        ici ceux qui sont prévus.
      </p>
      {saisie.apportsPrevus.map((a, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <Field label="Produit" htmlFor={`ap-p-${i}`}>
            <Select
              id={`ap-p-${i}`}
              value={a.organicInputId}
              onChange={(e) => {
                const liste = [...saisie.apportsPrevus];
                liste[i] = { ...a, organicInputId: e.target.value };
                maj({ apportsPrevus: liste });
              }}
              disabled={verrouille}
            >
              {produits.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dose" htmlFor={`ap-d-${i}`}>
            <Input
              id={`ap-d-${i}`}
              inputMode="decimal"
              defaultValue={a.dose}
              onChange={(e) => {
                const v = nombre(e.target.value);
                if (v === undefined) return;
                const liste = [...saisie.apportsPrevus];
                liste[i] = { ...a, dose: v };
                maj({ apportsPrevus: liste });
              }}
              disabled={verrouille}
            />
          </Field>
          <Field label="Unité" htmlFor={`ap-u-${i}`}>
            <Select
              id={`ap-u-${i}`}
              value={a.unite}
              onChange={(e) => {
                const liste = [...saisie.apportsPrevus];
                liste[i] = { ...a, unite: e.target.value as typeof a.unite };
                maj({ apportsPrevus: liste });
              }}
              disabled={verrouille}
            >
              <option value="t/ha">t/ha</option>
              <option value="m3/ha">m³/ha</option>
            </Select>
          </Field>
          <Field label="Date prévue" htmlFor={`ap-t-${i}`}>
            <Input
              id={`ap-t-${i}`}
              type="date"
              value={a.date}
              onChange={(e) => {
                const liste = [...saisie.apportsPrevus];
                liste[i] = { ...a, date: e.target.value };
                maj({ apportsPrevus: liste });
              }}
              disabled={verrouille}
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => maj({ apportsPrevus: saisie.apportsPrevus.filter((_, j) => j !== i) })}
            disabled={verrouille}
          >
            Retirer
          </Button>
        </div>
      ))}
      {produits.length > 0 && !verrouille ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            maj({
              apportsPrevus: [
                ...saisie.apportsPrevus,
                // Ni dose ni date par défaut : un apport prévu se saisit.
                { organicInputId: produits[0]!.id, unite: produits[0]!.defaultUnit === 'm3/ha' ? 'm3/ha' : 't/ha', date: '' } as never,
              ],
            })
          }
        >
          Ajouter un apport organique prévu
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      {verrouille ? <Alert tone="info">Ce plan est verrouillé : la campagne est close.</Alert> : null}

      <Card>
        <CardHeader
          title="Culture et parcelle"
          description={
            desc
              ? desc.referentiel
                ? `Fiches GREN — ${desc.referentiel.version}. Règles lues au ${new Date(`${desc.lueLe}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}.`
                : desc.raison ?? 'Référentiel GREN non disponible.'
              : 'Lecture des fiches…'
          }
        />
        {chargement && !desc ? (
          <div className="flex justify-center py-4">
            <Spinner size={20} />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Culture (fiche 1)" htmlFor="culture" required>
            <Select
              id="culture"
              value={saisie.culture ?? ''}
              onChange={(e) => maj({ culture: e.target.value || undefined, espece: undefined, plafond: undefined })}
              disabled={verrouille}
            >
              <option value="">—</option>
              {(d?.cultures ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.libelle}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Type de sol (fiche 21)"
            htmlFor="sol"
            hint={
              d?.sousRegion
                ? `Classification de l’ex-région ${d.sousRegion === 'auvergne' ? 'Auvergne' : 'Rhône-Alpes'}.`
                : 'Département de la parcelle inconnu : renseignez son code INSEE.'
            }
          >
            <Select
              id="sol"
              value={saisie.typeSol ?? ''}
              onChange={(e) => maj({ typeSol: e.target.value || undefined })}
              disabled={verrouille || !d?.sousRegion}
            >
              <option value="">—</option>
              {(d?.typesSol ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.libelle}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ouverture du bilan" htmlFor="ouverture" hint="Date de la sortie d’hiver retenue ; à défaut, le 1er février de l’année de récolte.">
            <Input id="ouverture" type="date" value={ouverture} onChange={(e) => setOuverture(e.target.value)} disabled={verrouille} />
          </Field>
          {desc ? (
            <p className="self-end text-[12.5px] text-ink-3">
              Département : {desc.departement ?? 'inconnu'} · culture d’hiver :{' '}
              {desc.cultureDHiver === null ? 'date de semis inconnue' : desc.cultureDHiver ? 'oui' : 'non'}
            </p>
          ) : null}
        </div>
      </Card>

      {d?.methode === 'bilan' ? (
        <Card>
          <CardHeader title="Besoins de la culture" description={d.expression ?? undefined} />
          <div className="space-y-3">
            {d.especes.length > 0 ? (
              <Field label="Espèce" htmlFor="espece">
                <Select id="espece" value={saisie.espece ?? ''} onChange={(e) => maj({ espece: e.target.value || undefined, besoin: undefined })} disabled={verrouille}>
                  <option value="">—</option>
                  {d.especes.map((e) => (
                    <option key={e.code} value={e.code}>
                      {e.libelle}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {d.besoinParVariete ? (
              <div className="space-y-2 rounded-md border border-line p-3">
                <p className="text-[13px] text-ink-2">Le besoin unitaire dépend de la variété (tableaux Arvalis – COMIFER 2024).</p>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input
                    type="radio"
                    name="besoin"
                    checked={saisie.besoin?.mode === 'variete-non-referencee'}
                    onChange={() => maj({ besoin: { mode: 'variete-non-referencee' } })}
                    disabled={verrouille}
                  />
                  Variété non référencée : valeur de la fiche
                </label>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input
                    type="radio"
                    name="besoin"
                    checked={saisie.besoin?.mode === 'declare'}
                    onChange={() => maj({ besoin: { mode: 'declare', justification: '' } as never })}
                    disabled={verrouille}
                  />
                  Besoin de ma variété
                </label>
                {saisie.besoin?.mode === 'declare' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="b (kg N/q)" htmlFor="b">
                      <Input id="b" inputMode="decimal" defaultValue={saisie.besoin.valeur} onChange={(e) => {
                        const v = nombre(e.target.value);
                        if (v !== undefined && saisie.besoin?.mode === 'declare') maj({ besoin: { ...saisie.besoin, valeur: v } });
                      }} disabled={verrouille} />
                    </Field>
                    <Field label="Justification (variété, source)" htmlFor="b-j">
                      <Input id="b-j" defaultValue={saisie.besoin.justification} onChange={(e) => {
                        if (saisie.besoin?.mode === 'declare') maj({ besoin: { ...saisie.besoin, justification: e.target.value } });
                      }} disabled={verrouille} />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            {d.objectif.utile ? (
              <div className="space-y-2 rounded-md border border-line p-3">
                <p className="text-[13px] font-medium text-ink-2">Objectif de rendement ({d.objectif.unite})</p>
                <Select
                  value={saisie.objectif?.mode ?? ''}
                  onChange={(e) => {
                    const m = e.target.value;
                    maj({
                      objectif:
                        m === 'historique'
                          ? { mode: 'historique' }
                          : m === 'defaut'
                            ? { mode: 'defaut', cultureFiche20: '', regimeHydrique: 'pluvial' }
                            : m === 'declare'
                              ? ({ mode: 'declare', justification: '' } as never)
                              : undefined,
                    });
                  }}
                  disabled={verrouille}
                >
                  <option value="">—</option>
                  <option value="historique">Moyenne de mes 5 dernières campagnes (hors extrêmes)</option>
                  <option value="defaut">Valeur par défaut de la fiche 20</option>
                  <option value="declare">Valeur que je déclare et justifie</option>
                </Select>
                {saisie.objectif?.mode === 'historique' ? (
                  <p className="text-[12.5px] text-ink-3">
                    Rendements enregistrés :{' '}
                    {desc && desc.rendements.length > 0
                      ? desc.rendements.map((r) => `${r.campagne} : ${r.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${r.unite ?? '?'}`).join(' · ')
                      : 'aucun'}
                  </p>
                ) : null}
                {saisie.objectif?.mode === 'defaut' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={saisie.objectif.cultureFiche20}
                      onChange={(e) => saisie.objectif?.mode === 'defaut' && maj({ objectif: { ...saisie.objectif, cultureFiche20: e.target.value } })}
                      disabled={verrouille}
                    >
                      <option value="">Culture de la fiche 20…</option>
                      {d.objectif.cultures20.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.libelle}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={saisie.objectif.regimeHydrique}
                      onChange={(e) => saisie.objectif?.mode === 'defaut' && maj({ objectif: { ...saisie.objectif, regimeHydrique: e.target.value } })}
                      disabled={verrouille}
                    >
                      <option value="pluvial">Pluvial</option>
                      <option value="irrigue">Irrigué</option>
                    </Select>
                  </div>
                ) : null}
                {saisie.objectif?.mode === 'declare' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input inputMode="decimal" defaultValue={saisie.objectif.valeur} aria-label="Objectif" onChange={(e) => {
                      const v = nombre(e.target.value);
                      if (v !== undefined && saisie.objectif?.mode === 'declare') maj({ objectif: { ...saisie.objectif, valeur: v } });
                    }} disabled={verrouille} />
                    <Input placeholder="Justification" defaultValue={saisie.objectif.justification} aria-label="Justification" onChange={(e) => {
                      if (saisie.objectif?.mode === 'declare') maj({ objectif: { ...saisie.objectif, justification: e.target.value } });
                    }} disabled={verrouille} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {d.colza ? (
              <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
                <Field label="Matière verte sortie d’hiver (kg/m²)" htmlFor="mv-sh">
                  <Input id="mv-sh" inputMode="decimal" defaultValue={saisie.colza?.mvSortieHiver ?? ''} onChange={(e) => maj({ colza: { ...saisie.colza, mvSortieHiver: nombre(e.target.value) } })} disabled={verrouille} />
                </Field>
                <Field label="Matière verte entrée d’hiver (kg/m²)" htmlFor="mv-eh" hint="Facultative.">
                  <Input id="mv-eh" inputMode="decimal" defaultValue={saisie.colza?.mvEntreeHiver ?? ''} onChange={(e) => maj({ colza: { ...saisie.colza, mvEntreeHiver: nombre(e.target.value) } })} disabled={verrouille} />
                </Field>
                <Field label="Profondeur du sol" htmlFor="prof" hint="Déduite du type de sol quand la fiche 20 le classe « profond ».">
                  <Select id="prof" value={saisie.colza?.profondeur ?? ''} onChange={(e) => maj({ colza: { ...saisie.colza, profondeur: (e.target.value || undefined) as 'superficiel' | 'profond' | undefined } })} disabled={verrouille}>
                    <option value="">—</option>
                    <option value="superficiel">Superficiel</option>
                    <option value="profond">Profond</option>
                  </Select>
                </Field>
                <Field label="Précédent pois protéagineux" htmlFor="fleg">
                  <Select id="fleg" value={saisie.colza?.precedentPois === undefined ? '' : String(saisie.colza.precedentPois)} onChange={(e) => maj({ colza: { ...saisie.colza, precedentPois: e.target.value === '' ? undefined : e.target.value === 'true' } })} disabled={verrouille}>
                    <option value="">—</option>
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </Select>
                </Field>
                <Field label="Associé à des légumineuses gélives" htmlFor="fass">
                  <Select id="fass" value={saisie.colza?.legumineusesGelives === undefined ? '' : String(saisie.colza.legumineusesGelives)} onChange={(e) => maj({ colza: { ...saisie.colza, legumineusesGelives: e.target.value === '' ? undefined : e.target.value === 'true' } })} disabled={verrouille}>
                    <option value="">—</option>
                    <option value="true">Oui</option>
                    <option value="false">Non</option>
                  </Select>
                </Field>
              </div>
            ) : null}

            {d.maisSemence ? (
              <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-3">
                <Field label="Rendement de référence Rr (q/ha)" htmlFor="rr">
                  <Input id="rr" inputMode="decimal" defaultValue={saisie.maisSemence?.rendementReference ?? ''} onChange={(e) => maj({ maisSemence: { ...saisie.maisSemence, rendementReference: nombre(e.target.value) } })} disabled={verrouille} />
                </Field>
                <Field label="Dispositif" htmlFor="disp">
                  <Select id="disp" value={saisie.maisSemence?.dispositif ?? ''} onChange={(e) => maj({ maisSemence: { ...saisie.maisSemence, dispositif: e.target.value || undefined } })} disabled={verrouille}>
                    <option value="">—</option>
                    {d.maisSemence.dispositifs.map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.libelle}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="CAU" htmlFor="cau">
                  <Select id="cau" value={saisie.maisSemence?.cau ?? ''} onChange={(e) => maj({ maisSemence: { ...saisie.maisSemence, cau: e.target.value || undefined } })} disabled={verrouille}>
                    <option value="">—</option>
                    {d.maisSemence.cau.map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.libelle}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {d?.methode === 'bilan' ? (
        <Card>
          <CardHeader title="Termes du bilan" description="Chaque terme se lit dans la fiche de la culture ; un terme laissé vide empêche le calcul." />
          <div className="space-y-4">
            {d.termes
              .filter((t) => t.terme !== 'Pf' || t.tableau)
              .map((t) => (
                <div key={t.terme} className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <p className="text-[13.5px] font-medium text-ink">{t.libelle}</p>
                  {t.ambigu ? <p className="text-[12.5px] text-ble-700 dark:text-ble-300">{t.ambigu}</p> : null}
                  {t.nulParLaFiche ? (
                    <p className="text-[12.5px] text-ink-3">Nul : {t.nulParLaFiche}</p>
                  ) : t.terme === 'Nirr' ? (
                    champsIrrigation
                  ) : t.terme === 'Xpro' ? (
                    champsXpro
                  ) : t.calcule ? (
                    <p className="text-[12.5px] text-ink-3">Calculé : {t.calcule}</p>
                  ) : (
                    <>
                      {t.sansObjet ? (
                        <label className="flex items-center gap-2 text-[13px] text-ink-2">
                          <Checkbox
                            checked={saisie.sansObjet.includes(t.terme as never)}
                            onChange={(e) => basculerSansObjet(t.terme, e.target.checked)}
                            disabled={verrouille}
                          />
                          Sans objet : {t.sansObjet}
                        </label>
                      ) : null}
                      {!saisie.sansObjet.includes(t.terme as never) && t.tableau ? (
                        t.tableau.cles.every((c) => c.partage === 'typeSol') ? (
                          <p className="text-[12.5px] text-ink-3">
                            Lu dans la fiche d’après le type de sol choisi plus haut.
                          </p>
                        ) : (
                          champTableau(t.tableau, t.terme)
                        )
                      ) : null}
                      {!saisie.sansObjet.includes(t.terme as never) && t.coefficient ? champTableau(t.coefficient, 'Mhp-coefficient') : null}
                      {t.mesurable ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Field label={`${t.terme} mesuré (kg N/ha)`} htmlFor={`m-${t.terme}`} hint={t.tableau ? 'Une mesure prime sur le tableau.' : undefined}>
                            <Input
                              id={`m-${t.terme}`}
                              inputMode="decimal"
                              defaultValue={saisie.mesures[t.terme]?.valeur ?? ''}
                              onChange={(e) => {
                                const v = nombre(e.target.value);
                                const mesures = { ...saisie.mesures };
                                if (v === undefined) delete mesures[t.terme];
                                else mesures[t.terme] = { valeur: v, justification: mesures[t.terme]?.justification ?? '' };
                                maj({ mesures });
                              }}
                              disabled={verrouille}
                            />
                          </Field>
                          <Field label="Justification (laboratoire, date)" htmlFor={`mj-${t.terme}`}>
                            <Input
                              id={`mj-${t.terme}`}
                              defaultValue={saisie.mesures[t.terme]?.justification ?? ''}
                              onChange={(e) => {
                                const m = saisie.mesures[t.terme];
                                if (m) maj({ mesures: { ...saisie.mesures, [t.terme]: { ...m, justification: e.target.value } } });
                              }}
                              disabled={verrouille}
                            />
                          </Field>
                        </div>
                      ) : null}
                      {!t.tableau && !t.mesurable && !t.sansObjet ? (
                        <p className="text-[12.5px] text-ink-3">Aucun tableau de la fiche pour ce terme et ce territoire.</p>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      {d?.methode === 'plafond' ? (
        <Card>
          <CardHeader title="Dose plafond" description={d.expression ?? undefined} />
          <div className="space-y-3">
            {d.plafond?.tableau ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {d.plafond.tableau.cles.map((c) => (
                  <Field key={c.nom} label={c.libelle} htmlFor={`pl-${c.nom}`}>
                    <Select
                      id={`pl-${c.nom}`}
                      value={saisie.plafond?.choix?.[c.nom] ?? ''}
                      onChange={(e) =>
                        maj({ plafond: { option: 'tableau', choix: { ...(saisie.plafond?.choix ?? {}), [c.nom]: e.target.value } } })
                      }
                      disabled={verrouille}
                    >
                      <option value="">—</option>
                      {c.options.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.libelle}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            ) : d.plafond && d.plafond.options.length > 0 ? (
              <Field label="Ligne de la fiche" htmlFor="pl-option">
                <Select id="pl-option" value={saisie.plafond?.option ?? ''} onChange={(e) => maj({ plafond: e.target.value ? { option: e.target.value } : undefined })} disabled={verrouille}>
                  <option value="">—</option>
                  {d.plafond.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.libelle}
                      {o.plafond === null ? ' — NC' : ` — ${o.plafond}${o.parTonne !== undefined ? ` + ${o.parTonne}/t` : ''} kg N`}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="text-[13px] text-ink-3">Cette fiche ne se lit pas automatiquement : le plafond est à déterminer depuis la fiche.</p>
            )}
            {d.objectif.utile ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Objectif de rendement (t/ha)" htmlFor="obj-pl">
                  <Input id="obj-pl" inputMode="decimal" defaultValue={saisie.objectif?.mode === 'declare' ? saisie.objectif.valeur : ''} onChange={(e) => {
                    const v = nombre(e.target.value);
                    maj({ objectif: v === undefined ? undefined : { mode: 'declare', valeur: v, justification: saisie.objectif?.mode === 'declare' ? saisie.objectif.justification : '' } });
                  }} disabled={verrouille} />
                </Field>
                <Field label="Justification" htmlFor="obj-pl-j">
                  <Input id="obj-pl-j" defaultValue={saisie.objectif?.mode === 'declare' ? saisie.objectif.justification : ''} onChange={(e) => {
                    if (saisie.objectif?.mode === 'declare') maj({ objectif: { ...saisie.objectif, justification: e.target.value } });
                  }} disabled={verrouille} />
                </Field>
              </div>
            ) : null}
            <div className="border-t border-line pt-3">
              <p className="mb-1.5 text-[13.5px] font-medium text-ink">Azote de l’eau d’irrigation (Nirr)</p>
              {champsIrrigation}
            </div>
            <div className="border-t border-line pt-3">
              <p className="mb-1.5 text-[13.5px] font-medium text-ink">Produits organiques de la campagne (Xpro)</p>
              {champsXpro}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void envoyer('calculer')} loading={envoi} disabled={!saisie.culture}>
          Calculer
        </Button>
        {canWrite && !verrouille ? (
          <Button type="button" onClick={() => void envoyer('enregistrer')} loading={envoi} disabled={!saisie.culture}>
            Enregistrer le plan
          </Button>
        ) : null}
      </div>

      {resultat ? (
        <Card>
          <CardHeader title="Résultat" />
          <CalculGrenView calcul={resultat.calcul} traces={resultat.traces} referentiel={resultat.referentiel} lueLe={resultat.lueLe} />
        </Card>
      ) : null}
    </div>
  );
}
