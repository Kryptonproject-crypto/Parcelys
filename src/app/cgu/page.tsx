import type { Metadata } from 'next';
import Link from 'next/link';
import { PARCELYS, mentionsCompletes } from '@/lib/constants/identity';

export const metadata: Metadata = { title: "Conditions générales d'utilisation" };

/**
 * Trame de CGU à compléter par l'exploitant du service avant toute mise en
 * production : les mentions entre crochets doivent être renseignées.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-champ-700 dark:text-champ-400 hover:underline">
        ← Retour à l&apos;accueil
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-ink">
        Conditions générales d&apos;utilisation
      </h1>

      {!mentionsCompletes() ? (
        <div className="mt-4 rounded-lg border border-ble-500/40 bg-ble-50 dark:bg-ble-700/15 p-4 text-sm text-ble-700 dark:text-ble-100">
          <strong>Adresse postale et SIRET à renseigner.</strong> Le reste de ce
          document décrit le service tel qu&apos;il fonctionne. Une validation
          juridique reste conseillée avant toute exploitation commerciale.
        </div>
      ) : null}

      <div className="prose mt-6 space-y-6 text-sm leading-relaxed text-ink-2">
        <section>
          <h2 className="text-lg font-semibold text-ink">1. Éditeur du service</h2>
          <p>
            {PARCELYS.nom} est édité et exploité par {PARCELYS.editeur.nom},{' '}
            {PARCELYS.editeur.qualite}, également directeur de la publication.
            Le service est accessible à l&apos;adresse {PARCELYS.domaine}.
          </p>
          <p className="mt-2">
            Contact :{' '}
            <a
              href={`mailto:${PARCELYS.contact.support}`}
              className="underline hover:text-ink"
            >
              {PARCELYS.contact.support}
            </a>
            .
          </p>
          {PARCELYS.editeur.adressePostale && PARCELYS.editeur.siret ? (
            <p className="mt-2">
              Siège : {PARCELYS.editeur.adressePostale} · SIRET {PARCELYS.editeur.siret}.
            </p>
          ) : (
            <p className="mt-2 text-ink-3">
              Adresse postale et numéro SIRET : à renseigner.
            </p>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">2. Objet</h2>
          <p>
            Parcelys est un logiciel de gestion parcellaire agricole permettant de
            cartographier des parcelles, d&apos;enregistrer des cultures, des apports, des
            traitements phytosanitaires et des travaux, puis d&apos;éditer des registres et
            des exports.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">3. Compte utilisateur</h2>
          <p>
            La création d&apos;un compte requiert une adresse e-mail valide, vérifiée par un
            code à usage unique. L&apos;utilisateur est responsable de la confidentialité de
            ses identifiants et de toute activité réalisée depuis son compte. Il peut à tout
            moment fermer ses sessions actives depuis son profil.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            4. Données réglementaires
          </h2>
          <p>
            Les informations relatives aux produits phytopharmaceutiques (numéro d&apos;AMM,
            substances actives, usages, doses, conditions d&apos;emploi) sont issues du
            catalogue officiel E-Phy publié par l&apos;ANSES et importées telles quelles.
            Parcelys ne produit ni ne modifie aucune donnée réglementaire.
          </p>
          <p>
            Ces informations sont fournies à titre indicatif et ne se substituent pas à
            l&apos;étiquette du produit, à la décision d&apos;autorisation de mise sur le
            marché en vigueur, ni aux prescriptions réglementaires applicables.
            L&apos;utilisateur demeure seul responsable de la conformité de ses pratiques.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            5. Responsabilité de l&apos;utilisateur
          </h2>
          <p>
            L&apos;utilisateur est seul responsable de l&apos;exactitude des données
            qu&apos;il saisit et de la conformité de ses registres aux obligations qui lui
            incombent. Les documents édités par Parcelys constituent une aide à la tenue de
            ces registres et n&apos;engagent pas l&apos;éditeur.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">
            6. Disponibilité et évolutions
          </h2>
          <p>
            L&apos;éditeur s&apos;efforce d&apos;assurer la disponibilité du service sans
            pouvoir la garantir de façon ininterrompue. Il peut faire évoluer les
            fonctionnalités, sous réserve d&apos;en informer les utilisateurs.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">7. Données personnelles</h2>
          <p>
            Le traitement des données personnelles est décrit dans la{' '}
            <Link href="/confidentialite" className="text-champ-700 dark:text-champ-400 underline">
              politique de confidentialité
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ink">8. Droit applicable</h2>
          <p>
            Les présentes conditions sont soumises au droit français. Tout litige relève de
            la compétence des tribunaux de [ressort], sous réserve des dispositions
            impératives applicables aux consommateurs.
          </p>
        </section>
      </div>
    </div>
  );
}
