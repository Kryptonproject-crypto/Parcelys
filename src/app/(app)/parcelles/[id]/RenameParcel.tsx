'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPut } from '@/lib/client/api';
import { Modal } from '@/components/forms/Modal';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

/**
 * Donner à une parcelle le nom qu'on lui donne vraiment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN ÉCRAN À PART
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Un import TéléPAC nomme les parcelles d'après la déclaration : « Îlot 39 —
 * parcelle 3 ». C'est juste, et c'est inutilisable au quotidien — personne ne
 * dit « je vais à l'îlot 39 parcelle 3 », on dit « je vais à la Croix Rouge ».
 * Le numéro d'îlot et le numéro de parcelle restent, eux, ce que la
 * déclaration a écrit : ils servent au contrôle, et Parcelys ne les invente ni
 * ne les remplace.
 *
 * Renommer supposait jusqu'ici de passer par « Modifier », c'est-à-dire par
 * l'assistant complet : la carte, le contour, le type de sol, le drainage.
 * Pour changer trois mots. Sur 141 parcelles fraîchement importées, autant
 * dire que ça ne se fait pas.
 *
 * Ce formulaire-ci ne porte que ce qu'on renomme : le nom, le numéro interne,
 * le lieu-dit. Il ne touche ni au contour, ni à la surface, ni à rien de ce
 * que la déclaration a apporté.
 */
export function RenameParcel({
  parcelId,
  name,
  internalNumber,
  lieuDit,
}: {
  parcelId: string;
  name: string;
  internalNumber: string | null;
  lieuDit: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nom, setNom] = useState(name);
  const [numero, setNumero] = useState(internalNumber ?? '');
  const [lieu, setLieu] = useState(lieuDit ?? '');

  // Rouvrir le formulaire doit repartir de ce qui est en base, pas de ce qui
  // avait été tapé puis abandonné la fois précédente.
  useEffect(() => {
    if (open) {
      setNom(name);
      setNumero(internalNumber ?? '');
      setLieu(lieuDit ?? '');
      setError(null);
    }
  }, [open, name, internalNumber, lieuDit]);

  const nomValide = nom.trim().length > 0;

  async function enregistrer(): Promise<void> {
    if (!nomValide) {
      setError('Une parcelle doit porter un nom.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiPut(`/api/parcels/${parcelId}`, {
        name: nom.trim(),
        // Vidés, ces champs redeviennent « non renseigné » — et non une chaîne
        // vide, qui se comporterait comme une valeur et ferait échouer la
        // contrainte d'unicité du numéro interne dès la deuxième parcelle.
        internalNumber: numero.trim() || null,
        lieuDit: lieu.trim() || null,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Renommer
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Renommer la parcelle"
        description="Le nom que vous employez sur l’exploitation. Il ne change rien à votre déclaration PAC."
      >
        <div className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Field
            label="Nom de la parcelle"
            htmlFor="renommer-nom"
            required
            hint="C’est ce nom que la recherche trouvera, accents ou non."
          >
            <Input
              id="renommer-nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="La Croix Rouge"
              autoFocus
            />
          </Field>

          <Field
            label="Numéro interne"
            htmlFor="renommer-numero"
            hint="Renseigné par l’import PAC sous la forme « îlot-parcelle ». Modifiable."
          >
            <Input
              id="renommer-numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="39-3"
            />
          </Field>

          <Field label="Lieu-dit" htmlFor="renommer-lieu">
            <Input
              id="renommer-lieu"
              value={lieu}
              onChange={(e) => setLieu(e.target.value)}
              placeholder="Les Sauvattes"
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button onClick={() => void enregistrer()} disabled={submitting || !nomValide}>
              {submitting ? <Spinner /> : null}
              {submitting ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
