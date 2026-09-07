import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Politique de confidentialité' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-champ-700 hover:underline">
        ← Retour à l&apos;accueil
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-ardoise-900">
        Politique de confidentialité
      </h1>

      <div className="mt-4 rounded-lg border border-ble-500/40 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Document à compléter.</strong> Cette trame décrit fidèlement les traitements
        réellement effectués par le logiciel. Elle doit être complétée (identité du
        responsable de traitement, hébergeur, durées retenues) et validée avant mise en
        production.
      </div>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-ardoise-700">
        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">
            1. Responsable de traitement
          </h2>
          <p>
            [Raison sociale], [adresse], contact : [adresse e-mail]. Hébergement des données :
            [hébergeur et localisation].
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">2. Données collectées</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <strong>Compte</strong> : prénom, nom, adresse e-mail, téléphone (facultatif),
              mot de passe (stocké sous forme d&apos;empreinte, jamais en clair).
            </li>
            <li>
              <strong>Exploitation</strong> : raison sociale, SIRET, adresse, coordonnées
              géographiques.
            </li>
            <li>
              <strong>Données agronomiques</strong> : parcelles et leurs géométries,
              cultures, apports, traitements phytosanitaires, travaux, documents joints.
            </li>
            <li>
              <strong>Données techniques</strong> : sessions actives (adresse IP, agent
              utilisateur, dates), journaux de sécurité et d&apos;activité.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">
            3. Finalités et bases légales
          </h2>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Fourniture du service et tenue des registres — exécution du contrat.
            </li>
            <li>
              Sécurité du compte, prévention des accès frauduleux, journalisation — intérêt
              légitime.
            </li>
            <li>Notifications par e-mail — consentement, révocable à tout moment.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">4. Destinataires</h2>
          <p>
            Les données agronomiques ne sont accessibles qu&apos;aux membres de
            l&apos;exploitation concernée. L&apos;isolation entre exploitations est appliquée
            côté serveur pour chaque requête.
          </p>
          <p>
            Sous-traitants techniques : fournisseur d&apos;envoi d&apos;e-mails, fournisseur
            météo et service de géocodage, sollicités uniquement avec les données strictement
            nécessaires (adresse e-mail pour les envois ; coordonnées géographiques pour la
            météo et la recherche d&apos;adresse). Aucune donnée d&apos;exploitation
            n&apos;est transmise à des fins commerciales.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">5. Durées de conservation</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>Données du compte et de l&apos;exploitation : jusqu&apos;à suppression du compte.</li>
            <li>Codes de vérification : 15 minutes ; jetons de réinitialisation : 30 minutes.</li>
            <li>Sessions : au plus 14 jours, ou 7 jours d&apos;inactivité.</li>
            <li>Journaux d&apos;activité : 12 mois.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">6. Vos droits</h2>
          <p>
            Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement,
            de limitation, d&apos;opposition et de portabilité. Deux de ces droits
            s&apos;exercent directement depuis votre profil :
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <strong>Export de vos données</strong> au format JSON réutilisable
              (portabilité et accès).
            </li>
            <li>
              <strong>Suppression du compte</strong> et des exploitations dont vous êtes le
              seul membre.
            </li>
          </ul>
          <p>
            Pour les autres demandes, écrivez à [adresse e-mail]. Vous pouvez également
            introduire une réclamation auprès de la CNIL.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">7. Cookies</h2>
          <p>
            Parcelys dépose un unique cookie strictement nécessaire au fonctionnement du
            service : le cookie de session, en <code>HttpOnly</code> et{' '}
            <code>SameSite=Lax</code>, qui vous maintient connecté. Aucun cookie de mesure
            d&apos;audience ni de publicité n&apos;est utilisé, ce qui n&apos;impose pas de
            bandeau de consentement.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-ardoise-900">8. Sécurité</h2>
          <p>
            Mots de passe hachés (Argon2id ou bcrypt), sessions à durée limitée et
            révocables, limitation du nombre de tentatives de connexion, verrouillage
            temporaire après échecs répétés, validation stricte des entrées, requêtes
            paramétrées, contrôle des permissions côté serveur et contrôle des fichiers
            téléversés.
          </p>
        </section>
      </div>
    </div>
  );
}
