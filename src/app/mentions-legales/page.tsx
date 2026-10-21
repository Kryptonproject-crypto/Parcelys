import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/PublicShell';
import { AManquer, AutresPagesLegales, Corps, MentionsIncompletes, Section } from '@/components/legal/Juridique';
import { PARCELYS } from '@/lib/constants/identity';

export const metadata: Metadata = {
  title: 'Mentions légales',
  description: 'Éditeur, directeur de la publication et hébergement du service Parcelys.',
};

/**
 * Mentions légales (loi n° 2004-575 du 21 juin 2004 pour la confiance dans
 * l'économie numérique, art. 6, III).
 *
 * Une personne physique qui édite un service à titre professionnel doit
 * indiquer ses nom, prénom, domicile et numéro de téléphone ; l'hébergeur, son
 * nom, son adresse et son téléphone. Ce qui n'est pas encore fourni est
 * signalé comme tel : une mention légale fausse est pire qu'une mention
 * absente, et la seconde se voit.
 */
export default function MentionsLegalesPage() {
  const { editeur, contact } = PARCELYS;
  return (
    <PublicShell
      title="Mentions légales"
      description="Qui édite Parcelys, qui en répond, et où sont hébergées vos données."
    >
      <MentionsIncompletes />
      <Corps>
        <Section titre="Éditeur du service">
          <p>
            {PARCELYS.nom} ({PARCELYS.domaine}) est édité par <strong>{editeur.nom}</strong>,{' '}
            {editeur.qualite}, personne physique.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Adresse : {editeur.adressePostale ?? <AManquer quoi="Adresse postale" />}
            </li>
            <li>Téléphone : {editeur.telephone ?? <AManquer quoi="Numéro de téléphone" />}</li>
            <li>SIRET : {editeur.siret ?? <AManquer quoi="Numéro SIRET" />}</li>
            <li>
              Courriel :{' '}
              <a href={`mailto:${contact.support}`} className="font-medium underline">
                {contact.support}
              </a>
            </li>
          </ul>
        </Section>

        <Section titre="Directeur de la publication">
          <p>{editeur.nom}.</p>
        </Section>

        <Section titre="Hébergement">
          <p>
            {PARCELYS.hebergement} Le serveur est exploité par l’éditeur lui-même : les
            coordonnées de l’hébergeur sont donc celles de l’éditeur, ci-dessus.
          </p>
          <p>
            Les sauvegardes quotidiennes restent sur un support local du même serveur, en
            France.
          </p>
        </Section>

        <Section titre="Propriété intellectuelle">
          <p>
            Le logiciel, son code, ses textes et ses visuels appartiennent à leur auteur.
            Les données que vous saisissez — parcelles, registres, documents — restent les
            vôtres : vous pouvez les exporter à tout moment, et elles ne sont jamais
            revendues.
          </p>
          <p>
            Les données réglementaires affichées proviennent de sources publiques citées à
            chaque usage (catalogue E-Phy de l’Anses, référentiels de zonage, déclaration
            PAC que vous importez). Fonds de carte : © contributeurs OpenStreetMap ; imagerie
            satellite © Esri et ses fournisseurs.
          </p>
        </Section>

        <Section titre="Signaler un contenu ou un problème">
          <p>
            Par le{' '}
            <Link href="/contact" className="font-medium text-champ-700 underline dark:text-champ-400">
              formulaire de contact
            </Link>{' '}
            ou à {contact.support}. Chaque demande reçoit un numéro et une réponse.
          </p>
        </Section>
      </Corps>
      <AutresPagesLegales courante="/mentions-legales" />
    </PublicShell>
  );
}
