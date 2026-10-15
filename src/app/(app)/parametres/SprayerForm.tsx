'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPut } from '@/lib/client/api';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Spinner } from '@/components/ui';
import {
  LIBELLES_TYPE_PULVERISATEUR,
  TYPES_PULVERISATEUR,
  type TypePulverisateur,
} from '@/lib/shared/pulverisateur';

type Sprayer = {
  sprayerType: TypePulverisateur | null;
  sprayerDriftReductionPct: number | null;
  sprayerDriftEquipment: string | null;
  riverainCharterApplied: boolean | null;
};

/** Les réponses possibles à « anti-dérive ? », la classe de la liste officielle comprise. */
const ANTI_DERIVE: Array<{ valeur: string; libelle: string }> = [
  { valeur: '', libelle: 'Je ne sais pas / non renseigné' },
  { valeur: '0', libelle: 'Non, aucun moyen anti-dérive' },
  { valeur: '50', libelle: 'Oui — réduction de la dérive d’au moins 50 %' },
  { valeur: '66', libelle: 'Oui — réduction de la dérive d’au moins 66 %' },
  { valeur: '75', libelle: 'Oui — réduction de la dérive d’au moins 75 %' },
  { valeur: '90', libelle: 'Oui — réduction de la dérive d’au moins 90 %' },
];

const CHARTE: Array<{ valeur: string; libelle: string }> = [
  { valeur: '', libelle: 'Je ne sais pas / non renseigné' },
  { valeur: 'oui', libelle: 'Oui, j’applique la charte approuvée par le préfet' },
  { valeur: 'non', libelle: 'Non' },
];

/**
 * Le pulvérisateur de l'exploitation.
 *
 * Trois questions, et ce qu'elles changent est dit sous chacune : c'est ce
 * qui permet, à la saisie d'un traitement, de dire si la ZNT d'un point d'eau
 * ou la distance aux habitations peut être réduite. « Je ne sais pas » reste
 * une réponse : Parcelys dit alors ce que la réduction demanderait.
 */
export function SprayerForm({ sprayer, canEdit }: { sprayer: Sprayer; canEdit: boolean }) {
  const router = useRouter();
  const [type, setType] = useState(sprayer.sprayerType ?? '');
  const [derive, setDerive] = useState(
    sprayer.sprayerDriftReductionPct === null ? '' : String(sprayer.sprayerDriftReductionPct),
  );
  const [materiel, setMateriel] = useState(sprayer.sprayerDriftEquipment ?? '');
  const [charte, setCharte] = useState(
    sprayer.riverainCharterApplied === null ? '' : sprayer.riverainCharterApplied ? 'oui' : 'non',
  );
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const equipe = derive !== '' && derive !== '0';

  async function enregistrer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setEnvoi(true);
    setMessage(null);
    setErreur(null);
    try {
      const resultat = await apiPut<{ message: string }>('/api/farms/pulverisateur', {
        sprayerType: type === '' ? null : type,
        driftReductionPct: derive === '' ? null : Number(derive),
        driftEquipment: equipe ? materiel : null,
        riverainCharterApplied: charte === '' ? null : charte === 'oui',
      });
      setMessage(resultat.message);
      router.refresh();
    } catch (err) {
      setErreur(err instanceof ApiRequestError ? err.message : 'Impossible de contacter le serveur.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Pulvérisateur"
        description="Sert, à chaque traitement saisi, à dire si la zone non traitée d’un point d’eau ou la distance aux habitations peut être réduite."
      />

      <form onSubmit={(e) => void enregistrer(e)} className="space-y-4">
        {message ? <Alert tone="success">{message}</Alert> : null}
        {erreur ? <Alert tone="danger">{erreur}</Alert> : null}

        <Field label="Type de pulvérisateur" htmlFor="sprayerType">
          <Select
            id="sprayerType"
            value={type}
            onChange={(e) => setType(e.target.value as TypePulverisateur | '')}
            disabled={!canEdit}
          >
            <option value="">Non renseigné</option>
            {TYPES_PULVERISATEUR.map((t) => (
              <option key={t} value={t}>
                {LIBELLES_TYPE_PULVERISATEUR[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Anti-dérive"
          htmlFor="driftReduction"
          hint="Buses ou équipement inscrits sur la liste officielle des moyens réduisant la dérive (Bulletin officiel du ministère de l’Agriculture). La liste donne la réduction pour votre modèle de buse et votre pression."
        >
          <Select id="driftReduction" value={derive} onChange={(e) => setDerive(e.target.value)} disabled={!canEdit}>
            {ANTI_DERIVE.map((o) => (
              <option key={o.valeur} value={o.valeur}>
                {o.libelle}
              </option>
            ))}
          </Select>
        </Field>

        {equipe ? (
          <Field
            label="Matériel anti-dérive"
            htmlFor="driftEquipment"
            hint="Marque et modèle des buses, pression d’utilisation : ce qu’un contrôle vous demandera."
          >
            <Input
              id="driftEquipment"
              value={materiel}
              onChange={(e) => setMateriel(e.target.value)}
              maxLength={200}
              placeholder="Ex. : buses à injection d’air 110-03, 3 bar"
              disabled={!canEdit}
            />
          </Field>
        ) : null}

        <Field
          label="Charte d’engagements riverains"
          htmlFor="riverainCharter"
          hint="La charte de votre département, approuvée par le préfet, permet de réduire les distances aux habitations avec un matériel anti-dérive."
        >
          <Select id="riverainCharter" value={charte} onChange={(e) => setCharte(e.target.value)} disabled={!canEdit}>
            {CHARTE.map((o) => (
              <option key={o.valeur} value={o.valeur}>
                {o.libelle}
              </option>
            ))}
          </Select>
        </Field>

        <Alert tone="info">
          Avec un moyen anti-dérive d’au moins 66 % : une zone non traitée de 20 ou 50 m le long d’un point d’eau peut
          être ramenée à 5 m s’il est bordé d’un dispositif végétalisé permanent d’au moins 5 m (arrêté du 4 mai 2017,
          annexe 3) ; la distance de 5 m aux habitations en culture basse peut être ramenée à 3 m si vous appliquez la
          charte. Parcelys vous le rappelle à chaque traitement — l’étiquette du produit fait toujours foi.
        </Alert>

        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={envoi}>
              {envoi ? <Spinner /> : null}
              Enregistrer
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
