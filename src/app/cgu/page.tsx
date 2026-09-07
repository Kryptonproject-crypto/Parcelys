import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: "Conditions générales d'utilisation" };

/**
 * Trame de CGU à compléter par l'exploitant du service avant toute mise en
 * production : les mentions entre crochets doivent être renseignées.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-champ-700 hover:underline">
        ← Retour à l&apos;accueil
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-ardoise-900">
        Conditions générales d&apos;utilisation
      </h1>

      <div className="mt-4 rounded-lg border border-ble-500/40 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Document à compléter.</strong> Cette trame doit être adaptée et validée
        juridiquement avant toute exploitation commerciale. Les mentions entre crochets
        sont à renseigner par l&apos;éditeur du service.
      </div>

      <div className="prose mt-6 space-y-6 text-sm leading-relaxed text-ardoise-700">
        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">1. Éditeur du service</h2>
          <p>
            Parcelys est édité par [raison sociale], [forme juridique] au capital de
            [montant], immatriculée sous le numéro [SIRET], dont le siège social est situé
            [adresse]. Directeur de la publication : [nom]. Contact : [adresse e-mail].
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">2. Objet</h2>
          <p>
            Parcelys est un logiciel de gestion parcellaire agricole permettant de
            cartographier des parcelles, d&apos;enregistrer des cultures, des apports, des
            traitements phytosanitaires et des travaux, puis d&apos;éditer des registres et
            des exports.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">3. Compte utilisateur</h2>
          <p>
            La création d&apos;un compte requiert une adresse e-mail valide, vérifiée par un
            code à usage unique. L&apos;utilisateur est responsable de la confidentialité de
            ses identifiants et de toute activité réalisée depuis son compte. Il peut à tout
            moment fermer ses sessions actives depuis son profil.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">
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
          <h2 className="text-lg font-semibold text-ardoise-900">
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
          <h2 className="text-lg font-semibold text-ardoise-900">
            6. Disponibilité et évolutions
          </h2>
          <p>
            L&apos;éditeur s&apos;efforce d&apos;assurer la disponibilité du service sans
            pouvoir la garantir de façon ininterrompue. Il peut faire évoluer les
            fonctionnalités, sous réserve d&apos;en informer les utilisateurs.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">7. Données personnelles</h2>
          <p>
            Le traitement des données personnelles est décrit dans la{' '}
            <Link href="/confidentialite" className="text-champ-700 underline">
              politique de confidentialité
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">8. Droit applicable</h2>
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
