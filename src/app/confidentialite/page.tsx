import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/PublicShell';
import { AManquer, AutresPagesLegales, Corps, MentionsIncompletes, Section } from '@/components/legal/Juridique';
import { PARCELYS } from '@/lib/constants/identity';
import { CONSERVATION_TRACES_REGISTRE_JOURS } from '@/lib/audit';
import { getEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Données personnelles',
  description:
    'Quelles données Parcelys traite, pourquoi, combien de temps, avec qui, et comment exercer vos droits.',
};

/**
 * Politique de confidentialité (règlement (UE) 2016/679, art. 13 et 14).
 *
 * Elle décrit ce que le code fait réellement : chaque durée citée ici est
 * celle d'une purge qui existe, chaque destinataire est un appel qui part.
 * Ce qui n'est pas automatisé est dit tel quel.
 */
export default function ConfidentialitePage() {
  const env = getEnv();
  const { editeur, contact } = PARCELYS;
  const lien = 'font-medium text-champ-700 underline dark:text-champ-400';
  return (
    <PublicShell
      title="Données personnelles"
      description="Ce que Parcelys traite, pourquoi, combien de temps, avec qui — et comment exercer vos droits."
    >
      <MentionsIncompletes />
      <Corps>
        <Section titre="1. Qui est responsable de quoi">
          <p>
            <strong>Pour votre compte</strong> (identité, connexion, sécurité, demandes
            d’assistance), le responsable de traitement est l’éditeur : {editeur.nom},{' '}
            {editeur.qualite} — adresse : {editeur.adressePostale ?? <AManquer quoi="Adresse postale" />}.
          </p>
          <p>
            <strong>Pour le contenu de vos registres</strong> (parcelles, interventions,
            noms des opérateurs et des prestataires que vous y inscrivez), le responsable est
            votre exploitation : c’est elle qui tient ces registres et en répond. Parcelys
            agit alors comme <strong>sous-traitant</strong> au sens de l’article 28 du RGPD :
            il ne traite ces données que pour vous fournir le service, selon vos
            instructions, ne les utilise pour rien d’autre et ne les communique à personne
            sans vous.
          </p>
          <p>
            Contact pour toute question ou demande :{' '}
            <a href={`mailto:${contact.donneesPersonnelles}`} className={lien}>
              {contact.donneesPersonnelles}
            </a>{' '}
            ou le{' '}
            <Link href="/contact" className={lien}>
              formulaire de contact
            </Link>
            . Aucun délégué à la protection des données n’est désigné : cette désignation
            n’est pas obligatoire pour ces traitements.
          </p>
        </Section>

        <Section titre="2. Les données traitées">
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              <strong>Compte</strong> : prénom, nom, adresse électronique, téléphone
              (facultatif), mot de passe (conservé sous forme d’empreinte, jamais en clair),
              numéro client ou de technicien.
            </li>
            <li>
              <strong>Exploitation</strong> : nom, SIRET, adresse, position du siège,
              conduite en agriculture biologique, équipement de pulvérisation.
            </li>
            <li>
              <strong>Registres et données agronomiques</strong> : contours des parcelles,
              cultures, apports, traitements (dont le nom de l’opérateur, et le nom et le
              SIRET d’un prestataire ou d’une exploitation en entraide), travaux, couverts,
              stocks, plans de fumure, documents joints, déclaration PAC importée (numéros
              d’îlots et de parcelles, cultures déclarées, numéro PACAGE).
            </li>
            <li>
              <strong>Demandes d’assistance</strong> : messages, pièces jointes, adresse
              électronique de réponse.
            </li>
            <li>
              <strong>Données techniques</strong> : sessions (adresse IP, navigateur,
              dates), journal d’activité et de sécurité.
            </li>
            <li>
              <strong>Position du téléphone</strong> : dans l’application, elle sert à vous
              situer sur la carte et à tracer un contour. Elle n’est pas envoyée au serveur ;
              seul le contour que vous enregistrez l’est.
            </li>
          </ul>
          <p>
            Aucune donnée n’est utilisée à des fins publicitaires, revendue, ni croisée avec
            d’autres sources. Aucune décision automatisée produisant des effets juridiques
            n’est prise à votre égard : les contrôles réglementaires affichés sont des
            alertes, jamais des décisions.
          </p>
        </Section>

        <Section titre="3. Pourquoi, et sur quelle base">
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              Fournir le service — cartographie, registres, exports, application de terrain,
              assistance : <strong>exécution du contrat</strong> (art. 6.1.b RGPD).
            </li>
            <li>
              Vous permettre de tenir les registres que la réglementation agricole vous
              impose (registre phytopharmaceutique, cahier d’enregistrement des pratiques de
              fertilisation, cahier d’épandage) : cette obligation est la vôtre ; Parcelys
              est l’outil qui la sert, au titre du contrat.
            </li>
            <li>
              Sécurité des comptes, prévention des accès frauduleux, traçabilité des
              corrections de registre : <strong>intérêt légitime</strong> (art. 6.1.f) — un
              registre doit pouvoir montrer ce qu’il disait avant d’être corrigé.
            </li>
            <li>
              Courriels de service (code de vérification, réinitialisation du mot de passe,
              réponses à vos demandes) : exécution du contrat. Les notifications facultatives
              se désactivent depuis votre profil.
            </li>
          </ul>
        </Section>

        <Section titre="4. Qui y a accès">
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              <strong>Les membres de votre exploitation</strong>, selon le rôle que vous leur
              donnez (propriétaire, administrateur, salarié, lecteur).
            </li>
            <li>
              <strong>Un technicien ou conseiller</strong>, seulement si vous lui ouvrez une
              mission de conseil, en lecture, et jusqu’à ce que vous la révoquiez.
            </li>
            <li>
              <strong>L’administration de Parcelys</strong> (l’éditeur, et le cas échéant un
              administrateur qu’il a désigné pour le suivi d’un portefeuille de clients), pour
              l’assistance et la maintenance ; les actions d’administration sont journalisées.
            </li>
            <li>
              <strong>Personne d’autre.</strong> Aucune administration, coopérative ou
              organisme de contrôle ne reçoit vos registres de Parcelys : c’est vous qui les
              exportez et les présentez.
            </li>
          </ul>
          <p>Services techniques sollicités, avec le strict nécessaire :</p>
          <ul className="list-inside list-disc space-y-1.5">
            <li>envoi des courriels : votre adresse électronique et le message ;</li>
            <li>
              météo (Open-Meteo, ou le fournisseur que l’éditeur a configuré) : les
              coordonnées du centre de la parcelle, sans votre identité ;
            </li>
            <li>
              recherche d’adresse (Base adresse nationale) : le texte recherché, sans votre
              identité ;
            </li>
            <li>
              fonds de carte (OpenStreetMap ; Esri, établi aux États-Unis, pour la vue
              satellite) : chargés par votre navigateur, ils reçoivent l’adresse IP de
              l’appareil et la zone affichée —{' '}
              <Link href="/cookies" className={lien}>
                détail
              </Link>
              .
            </li>
          </ul>
        </Section>

        <Section titre="5. Où, et hors de l’Union européenne ?">
          <p>
            Les données sont stockées en France, sur un serveur exploité par l’éditeur ; les
            sauvegardes aussi. Le seul flux hors de l’Union européenne est celui de la vue
            satellite, vers Esri (États-Unis), limité à l’adresse IP et à la zone de carte, et
            seulement si vous choisissez cette vue.
          </p>
        </Section>

        <Section titre="6. Combien de temps">
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              <strong>Compte, exploitation et registres</strong> : tant que le compte existe.
              Vos registres doivent pouvoir être présentés au moins cinq ans (registre
              phytopharmaceutique, arrêté du 24 décembre 2025 ; cahier d’enregistrement des
              pratiques de fertilisation en zone vulnérable) : avant de supprimer votre
              compte, exportez-les — Parcelys ne pourra plus les produire ensuite.
            </li>
            <li>
              <strong>Traces de correction des registres</strong> (ce qu’une ligne disait
              avant d’être corrigée ou supprimée) :{' '}
              {Math.round(CONSERVATION_TRACES_REGISTRE_JOURS / 365)} ans ; l’adresse IP et le
              navigateur qui les accompagnent sont effacés au bout d’un an.
            </li>
            <li>
              <strong>Journal d’activité et de sécurité</strong> : un an, à chaque purge de
              maintenance.
            </li>
            <li>
              <strong>Sessions</strong> : {Math.round(env.SESSION_TTL_HOURS / 24)} jours au
              plus, {Math.round(env.SESSION_IDLE_TIMEOUT_HOURS / 24)} jours sans activité.
              Codes de vérification et liens de réinitialisation : quelques minutes.
            </li>
            <li>
              <strong>Sauvegardes</strong> : chaque copie est effacée au bout de 14 jours
              (réglage par défaut).
            </li>
            <li>
              <strong>Demandes d’assistance</strong> : aucune purge automatique n’est
              programmée aujourd’hui ; vous pouvez en demander l’effacement à tout moment.
            </li>
          </ul>
        </Section>

        <Section titre="7. Vos droits">
          <p>
            Vous disposez des droits d’accès, de rectification, d’effacement, de limitation,
            d’opposition et de portabilité, ainsi que du droit de définir des directives sur
            le sort de vos données après votre décès. Deux s’exercent directement depuis
            votre profil :
          </p>
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              <strong>Exporter vos données</strong> (fichier JSON réutilisable) — accès et
              portabilité ;
            </li>
            <li>
              <strong>Supprimer votre compte</strong>, avec les exploitations dont vous êtes
              le seul membre.
            </li>
          </ul>
          <p>
            Pour les autres, écrivez à{' '}
            <a href={`mailto:${contact.donneesPersonnelles}`} className={lien}>
              {contact.donneesPersonnelles}
            </a>{' '}
            : réponse dans un délai d’un mois. Une personne inscrite dans vos registres (un
            opérateur, un prestataire) peut aussi s’adresser à vous, responsable de ces
            registres. Si vous estimez que vos droits ne sont pas respectés, vous pouvez
            saisir la CNIL (
            <a href="https://www.cnil.fr/fr/plaintes" className={lien} rel="noreferrer noopener">
              cnil.fr/fr/plaintes
            </a>
            ).
          </p>
        </Section>

        <Section titre="8. Sécurité">
          <p>
            Mots de passe hachés, sessions à durée limitée et révocables, limitation des
            tentatives de connexion, cloisonnement des exploitations vérifié par le serveur à
            chaque requête, journal des actions d’administration, contrôle des fichiers
            déposés, sauvegardes quotidiennes.
          </p>
        </Section>

        <Section titre="9. Cookies">
          <p>
            Uniquement des traceurs strictement nécessaires, exemptés de consentement :{' '}
            <Link href="/cookies" className={lien}>
              liste complète
            </Link>
            .
          </p>
        </Section>
      </Corps>
      <AutresPagesLegales courante="/confidentialite" />
    </PublicShell>
  );
}
