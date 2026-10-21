import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/PublicShell';
import { AutresPagesLegales, Corps, MentionsIncompletes, Section } from '@/components/legal/Juridique';
import { PARCELYS } from '@/lib/constants/identity';

export const metadata: Metadata = { title: "Conditions générales d'utilisation" };

/**
 * Conditions générales d'utilisation.
 *
 * Elles disent ce que le service fait et ne fait pas — en particulier qu'un
 * registre tenu dans Parcelys reste le registre **de l'exploitant**, dont il
 * répond en cas de contrôle. Une validation par un juriste reste conseillée
 * avant une exploitation commerciale à grande échelle.
 */
export default function TermsPage() {
  const lien = 'font-medium text-champ-700 underline dark:text-champ-400';
  return (
    <PublicShell
      title="Conditions générales d’utilisation"
      description="Ce que Parcelys fait pour vous, ce qu’il ne fait pas, et qui répond de quoi."
    >
      <MentionsIncompletes />
      <Corps>
        <Section titre="1. Éditeur">
          <p>
            {PARCELYS.nom} ({PARCELYS.domaine}) est édité et exploité par{' '}
            {PARCELYS.editeur.nom}, {PARCELYS.editeur.qualite}, également directeur de la
            publication. Coordonnées complètes :{' '}
            <Link href="/mentions-legales" className={lien}>
              mentions légales
            </Link>
            .
          </p>
        </Section>

        <Section titre="2. Objet">
          <p>
            Parcelys est un logiciel de gestion parcellaire agricole : cartographie des
            parcelles, suivi des cultures, enregistrement des apports, des traitements
            phytopharmaceutiques, des travaux et des couverts, plan de fumure, stocks,
            import et export de la déclaration PAC, édition des registres et exports — sur le
            site et dans l’application de terrain, y compris hors réseau.
          </p>
          <p>
            Le service est réservé aux professionnels (exploitants agricoles, leurs salariés,
            leurs conseillers). L’accès se fait sur invitation.
          </p>
        </Section>

        <Section titre="3. Compte">
          <p>
            La création d’un compte demande une adresse électronique valide, vérifiée par un
            code à usage unique. Vous êtes responsable de la confidentialité de vos
            identifiants et des actions faites depuis votre compte ; vous pouvez fermer vos
            sessions actives depuis votre profil. Le propriétaire d’une exploitation décide
            qui y accède et avec quel rôle, et peut ouvrir ou révoquer l’accès d’un conseiller.
          </p>
        </Section>

        <Section titre="4. Vos registres, votre responsabilité">
          <p>
            Les registres tenus dans Parcelys — registre phytopharmaceutique, registre des
            apports et cahier d’enregistrement des pratiques de fertilisation, cahier
            d’épandage, plan de fumure — sont <strong>les vôtres</strong>. Vous êtes seul
            responsable de l’exactitude de ce que vous y saisissez, de leur tenue dans les
            délais réglementaires, de leur conservation pendant les durées imposées (au moins
            cinq ans pour le registre phytopharmaceutique et le cahier d’enregistrement) et
            de leur présentation en cas de contrôle.
          </p>
          <p>
            Parcelys vous aide à les tenir : il signale les mentions manquantes, produit le
            registre phytopharmaceutique au format électronique lisible par machine (exigé à
            partir du 1er janvier 2027), garde la trace de chaque correction, et vous permet
            d’exporter vos registres à tout moment (PDF, Excel, CSV, JSON). Il ne garantit pas
            que vos pratiques sont conformes : les contrôles qu’il affiche reposent sur les
            référentiels importés, dont la source et la date sont indiquées, et signalent ce
            qu’ils ne peuvent pas vérifier plutôt que de le supposer conforme.
          </p>
        </Section>

        <Section titre="5. Données réglementaires">
          <p>
            Les informations sur les produits phytopharmaceutiques (numéro d’AMM, substances,
            usages, doses, zones non traitées, conditions d’emploi) proviennent du catalogue
            officiel E-Phy de l’Anses et sont importées telles quelles ; les zonages, des
            référentiels publics importés avec leur version. Parcelys n’en produit ni n’en
            modifie aucune. Elles ne se substituent ni à l’étiquette du produit, ni à la
            décision d’autorisation en vigueur, ni aux arrêtés applicables.
          </p>
        </Section>

        <Section titre="6. Vos données">
          <p>
            Vos données restent les vôtres. Pour le contenu de vos registres, l’éditeur agit
            comme sous-traitant (article 28 du RGPD) : il ne les traite que pour vous fournir
            le service, ne les revend pas, ne les communique à aucun tiers sans vous, et vous
            permet de les exporter puis de les supprimer. Le détail figure dans la page{' '}
            <Link href="/confidentialite" className={lien}>
              Données personnelles
            </Link>
            .
          </p>
        </Section>

        <Section titre="7. Disponibilité et évolutions">
          <p>
            L’éditeur s’efforce d’assurer la disponibilité du service sans pouvoir la
            garantir de façon ininterrompue ; l’application de terrain continue d’enregistrer
            hors réseau et transmet à la reconnexion. Les sauvegardes sont quotidiennes. Les
            fonctionnalités peuvent évoluer ; les changements notables sont annoncés.
          </p>
        </Section>

        <Section titre="8. Fin d’utilisation">
          <p>
            Vous pouvez supprimer votre compte à tout moment depuis votre profil. Exportez
            auparavant vos registres : vous devez pouvoir les présenter pendant leur durée de
            conservation, et Parcelys ne pourra plus les produire une fois le compte supprimé.
          </p>
        </Section>

        <Section titre="9. Droit applicable">
          <p>
            Les présentes conditions sont soumises au droit français. En cas de différend,
            les parties recherchent d’abord une solution amiable ; à défaut, le litige est
            porté devant la juridiction compétente selon les règles de droit commun.
          </p>
        </Section>
      </Corps>
      <AutresPagesLegales courante="/cgu" />
    </PublicShell>
  );
}
