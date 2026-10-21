# Administration multi-niveaux, numéros clients, support et aide

Version 0.11.0. Ce document sert à la fois de diagnostic (ce qui existait),
de description technique (ce qui a été ajouté) et de procédure de déploiement
et de retour arrière.

---

## 1. Diagnostic de l'existant (avant 0.11.0)

### Architecture

| Élément | Constat |
|---|---|
| Site | Next.js 15 (App Router), rendu serveur, routes d'API sous `src/app/api` enrobées par `route()` (`src/lib/api/handler.ts` : CSRF par origine, idempotence, erreurs homogènes). |
| Application mobile | Capacitor + Vite (`mobile/`), jeton `Authorization: Bearer`, hors ligne avec file d'attente. Partage du code via les alias `@partage` (`src/lib/ephy`) et `@commun` (`src/lib/shared`). |
| Base | PostgreSQL 16 + PostGIS, Prisma 6, migrations SQL écrites et relues à la main (`prisma/migrations`). |
| Authentification | Sessions opaques (empreinte SHA-256 en base), cookie `HttpOnly` pour le site, jeton Bearer pour l'application. `getAuthContext()` (`src/lib/auth/session.ts`) charge l'utilisateur, ses appartenances et ses missions de conseil. |
| Autorisations | `src/lib/auth/rbac.ts` : matrice de permissions par rôle d'exploitation (`FarmRole`), `requireFarmAccess`, `requireParcelAccess` (404 hors périmètre), `requirePlatformAdmin`. Variantes « page » dans `page-guards.ts`. |
| Inscription | Fermée : code d'invitation obligatoire (`InvitationCode`, empreinte seule stockée), sauf amorçage sur base vide. |
| Journal | `AuditLog` + `logAudit()` (`src/lib/audit.ts`), liste fermée d'actions typées. |
| Sauvegarde | `scripts/backup.sh` (base + documents, archive vérifiée), `scripts/restore.sh` (essai à blanc par défaut), `scripts/update-pi.sh` sauvegarde **avant** `prisma migrate deploy`. |
| Tests | Vitest, 50 fichiers / 744 tests, base réelle et serveur Next compilé (`tests/helpers`). |

### Tables concernées

| Table | Rôle |
|---|---|
| `users` | Comptes. `account_type` (`FARMER`, `AGRONOMIST`, `ADMIN`), `is_platform_admin` (droit d'administrer l'instance), suspension, suppression logique. |
| `farms`, `farm_members` | Exploitations et appartenances (`FarmRole`). |
| `advisory_engagements` | Missions d'un expert agronomique (« technicien ») sur une exploitation. |
| `invitation_codes` | Codes d'inscription et d'accès conseil. |
| `audit_logs` | Journal. |
| `app_settings` | Réglages d'instance (mode maintenance). |
| `documents` | Pièces jointes d'exploitation, validées par extension + MIME + signature binaire (`src/lib/storage/documents.ts`). |

### Administration existante

Section `/administration` (groupe `(admin)`) : vue d'ensemble, utilisateurs,
invitations, exploitations (suppression logique, rétablissement, purge à
triple verrou), experts (rattachement aux exploitations), référentiels
réglementaires, journal d'audit, maintenance (mode maintenance, purges,
mises à jour, état du système). Toutes les routes `/api/admin/*` passaient par
`requirePlatformAdmin()`. **Aucune commande de redémarrage n'existe dans
l'interface** — et aucune n'a été ajoutée : le redémarrage reste un geste
fait sur le serveur (`systemctl`, `scripts/update-pi.sh`).

### Ce qui manquait

- un seul niveau d'administration : tout administrateur voyait tout ;
- aucun identifiant public pour une exploitation ou un technicien ;
- aucun portefeuille de gestion ni « administrateur responsable » ;
- la page Contact n'était qu'une adresse e-mail : pas de demande tracée,
  pas de numéro, pas d'attribution, pas d'historique ;
- aucune FAQ.

### Risques identifiés

| Risque | Parade retenue |
|---|---|
| Ouvrir `/administration` à un second niveau expose par défaut toutes les pages existantes. | `requirePlatformAdmin()` et `requirePageAdmin()` gardent leur sens (administrateur **général** seul) : une route ou une page qu'on oublierait de convertir reste fermée au secondaire. Les routes converties passent par `requireAdmin(permission)`, qui applique la matrice puis le périmètre. Sûr par défaut. |
| Attribution des numéros oubliée dans un des points de création (inscription, seed, scripts, tests…). | Attribution par **déclencheur PostgreSQL** : impossible d'insérer une exploitation ou un technicien sans numéro, quel que soit le chemin. |
| Accès concurrents → doublons. | Compteur en table, incrémenté par `UPDATE … RETURNING` (verrou de ligne jusqu'à la fin de la transaction) + index unique en dernier rempart. |
| Réinitialisation ou réécriture d'un numéro. | Déclencheurs qui refusent toute modification d'un numéro attribué, toute baisse et toute suppression d'un compteur. |
| Migration interrompue à mi-course sur le Pi. | Migration rejouable (`IF NOT EXISTS`, `CREATE OR REPLACE`), reprise des numéros par une fonction idempotente (`parcelys_attribuer_numeros_manquants()`) appelable aussi par `npm run numeros`. Sauvegarde préalable par `update-pi.sh`. |
| Fuites indirectes (compteurs, messages, exports, recherches). | Requêtes filtrées par périmètre côté base ; ressource hors périmètre = 404 identique à « inexistant » ; statistiques, exports et recherche par numéro bornés au périmètre ; appartenances hors périmètre masquées. |
| Pièces jointes de support : fichiers malveillants. | Réutilisation de la validation existante (extension + MIME + signature), liste réduite (PDF, PNG, JPEG, WebP, TXT), 5 Mo, nom aléatoire sur disque, téléchargement réservé aux personnes autorisées, `Content-Disposition: attachment`, `nosniff`. |
| Demandes anonymes : usurpation d'un client. | Le numéro déclaré par un visiteur n'est **jamais** pris pour une preuve : la demande porte l'état « identité non vérifiée » ; la confirmation passe par un lien envoyé à l'adresse saisie ; l'interface rappelle de ne communiquer aucune donnée avant vérification. |

---

## 2. Rôles et autorisations

Deux niveaux d'administration, portés par deux colonnes de `users` qu'une
contrainte rend exclusives (`users_un_seul_niveau_admin`) :

| Rôle | Colonne | Périmètre |
|---|---|---|
| Administrateur général | `is_platform_admin = true` (inchangé) | Toute l'instance. |
| Administrateur secondaire | `is_secondary_admin = true` | Les portefeuilles qu'il gère (`portfolio_managers`). |

La matrice est dans `src/lib/admin/roles.ts` (`ADMIN_PERMISSIONS`), les
filtres de périmètre dans `src/lib/admin/scope.ts`. Chaque route
d'administration appelle `requireAdmin(permission)` ; chaque page,
`requirePageAdminScope(permission)`. Les fonctions sensibles — configuration,
maintenance, état du serveur, référentiels, journal, administrateurs,
portefeuilles, FAQ, suppression de comptes et d'exploitations — sont réservées
au niveau général.

Un administrateur secondaire ne peut jamais : lire un client hors de ses
portefeuilles (404), agir sur un compte partagé avec une exploitation hors de
son périmètre, agir sur un compte administrateur, délivrer un code
d'administration, modifier ses propres droits, accéder à la maintenance, à
l'état du serveur, aux référentiels ou au journal (403).

Aucun des deux niveaux n'a accès aux données agronomiques (parcelles,
registres) d'une exploitation dont il n'est pas membre : l'administration
voit des comptes, des numéros et des compteurs.

## 3. Numéros clients

| Objet | Format | Colonne |
|---|---|---|
| Exploitation | `EXP-000001` | `farms.customer_number` |
| Technicien (compte `AGRONOMIST`) | `TEC-000001` | `users.technician_number` |
| Demande de support | `DEM-000001` | `support_tickets.number` |

- Attribués par la base (`parcelys_numero_suivant(prefixe)`), jamais par le
  navigateur ; une valeur fournie à l'insertion est ignorée.
- Six chiffres au minimum, sans troncature au-delà (`EXP-1000000`).
- Définitifs : un numéro attribué ne change plus et n'est jamais réattribué,
  même après suppression définitive (le compteur ne fait que monter).
- Ne servent **ni** de clé primaire **ni** d'autorisation : ce sont des
  repères pour se parler. Les droits se résolvent toujours depuis la session.

## 4. Portefeuilles

`management_portfolios` (nom unique), `portfolio_managers` (qui gère quoi,
plusieurs administrateurs par portefeuille et plusieurs portefeuilles par
administrateur), `farms.portfolio_id`, `users.portfolio_id` (techniciens).
Un client sans portefeuille relève de l'administrateur général. Toute
attribution ou tout transfert est journalisé (`portfolio.client_assigned`).

## 5. Support

`support_tickets`, `support_messages` (avec notes internes), `support_ticket_events`
(historique des statuts, attributions et transferts), `support_attachments`.
Statuts : nouvelle, en cours, en attente du client, résolue, fermée.

Attribution à la création : client vérifié (session) → portefeuille de son
exploitation ou du technicien → premier administrateur du portefeuille.
Visiteur anonyme : portefeuille du numéro **déclaré**, identité marquée non
vérifiée. Sans portefeuille : administrateurs généraux.

## 6. FAQ

`faq_categories`, `faq_entries`. Contenu initial dans
`src/lib/shared/faq-initiale.ts` (partagé avec l'application mobile pour le
hors-ligne), inséré une seule fois en base puis éditable dans
`/administration/aide`. Les réponses à confirmer portent la mention
« À vérifier ».

Depuis la 0.12.0, une entrée écrite après la première installation porte
`ajouteeEn` : elle est **livrée une fois** aux serveurs déjà installés (réglage
`faq.ajouts-livres`). Une entrée de même identifiant déjà présente n'est pas
écrasée ; une entrée livrée puis supprimée par l'administrateur ne revient
pas. Avant la 0.12.0, les réponses ajoutées en 0.11.1 et 0.11.2 n'arrivaient
jamais sur un serveur installé avant elles.

### Journal d'audit et durées de conservation

La purge (`/administration/maintenance`, « journal d'audit ») efface le journal
ordinaire au-delà de la durée choisie (un an par défaut). Les **traces de
registre** — créations, corrections (avant/après) et suppressions (copie de la
ligne) de traitements, apports, travaux, couverts, cultures, plans de fumure —
sont gardées **six ans** : les registres se conservent au moins cinq ans, et
leur trace de correction avec eux. Leur adresse IP et leur navigateur sont
effacés au même terme que le journal ordinaire. Aucune purge n'est
automatique : elle se lance depuis la maintenance.

---

## 7. Fichiers

### Base de données

| Fichier | Contenu |
|---|---|
| `prisma/schema.prisma` | Colonnes `users.is_secondary_admin`, `users.technician_number`, `users.portfolio_id`, `farms.customer_number`, `farms.portfolio_id`, `invitation_codes.grants_secondary_admin`, `invitation_codes.portfolio_id` ; modèles `ManagementPortfolio`, `PortfolioManager`, `SupportTicket`, `SupportMessage`, `SupportTicketEvent`, `SupportAttachment`, `FaqCategory`, `FaqEntry`, `CustomerNumberCounter`. |
| `prisma/migrations/20261017090000_administration_multi_niveaux/migration.sql` | La migration (rejouable), les déclencheurs de numérotation, la fonction de reprise, la contrainte `users_un_seul_niveau_admin`. |
| `scripts/numeros-clients.ts` | `npm run numeros` : contrôle et reprise de la numérotation. |

### Autorisations

| Fichier | Rôle |
|---|---|
| `src/lib/admin/roles.ts` | Rôles et matrice `ADMIN_PERMISSIONS` (partagée avec la navigation). |
| `src/lib/admin/scope.ts` | `requireAdmin(permission)`, filtres par périmètre, chargements bornés (404 hors périmètre). |
| `src/lib/auth/page-guards.ts` | `requirePageAdminScope(permission)` pour les pages. |
| `src/lib/auth/session.ts` | `isSecondaryAdmin` dans la session. |

### Administration

`src/lib/admin/overview.ts` (lectures bornées, pagination, statistiques),
`src/lib/admin/portefeuilles.ts` (attribution, transfert, responsable),
`src/lib/admin/administrateurs.ts`, `src/lib/admin/recherche.ts`,
`src/lib/admin/serveur.ts` ; routes `src/app/api/admin/*` ; pages
`src/app/(admin)/administration/*` (tableau de bord, support, exploitations
et fiche, techniciens et fiche, comptes, invitations, administrateurs,
portefeuilles et fiche, centre d'aide, référentiels, journal, maintenance,
état du serveur, recherche).

### Support, contact, aide

`src/lib/support/tickets.ts`, `src/lib/shared/support.ts`,
`src/lib/validation/support.ts`, `src/lib/aide/faq.ts`,
`src/lib/shared/faq.ts`, `src/lib/shared/faq-initiale.ts`,
`src/lib/shared/numeros.ts` ; routes `src/app/api/support/*`,
`src/app/api/aide/faq` ; pages `/contact`, `/contact/suivi/[token]`, `/aide`,
`/mes-demandes` ; composants `src/components/support/*`,
`src/components/aide/FaqBrowser.tsx`.

### Application mobile

`mobile/src/screens/Aide.tsx`, `Contact.tsx`, `Demandes.tsx`,
`mobile/src/screens/Settings.tsx` (numéro client), `mobile/src/lib/api.ts`.

## 8. Tests

| Fichier | Couvre |
|---|---|
| `tests/numeros-clients.test.ts` | Format, unicité sous 25 créations simultanées, numéro fourni ignoré, immuabilité, compteurs protégés, techniciens, exclusivité des deux niveaux, **reprise des comptes existants** (ordre, idempotence, réalignement). |
| `tests/administration-multi.test.ts` | Accès global du général ; isolation de deux portefeuilles (listes, fiches, compteurs, recherche, exports) ; accès direct par URL et identifiants modifiés ; maintenance, serveur, journal, portefeuilles, administrateurs, FAQ refusés au secondaire (403, journalisé) ; maintenance qui bloque le secondaire ; création, élargissement, désactivation, révocation d'un secondaire ; affectation et transfert d'exploitations et de techniciens ; invitations du secondaire bornées ; rendu de toutes les pages. |
| `tests/support.test.ts` | Attribution au bon administrateur (exploitant, technicien, anonyme avec ou sans numéro) ; identifiants envoyés par le navigateur ignorés ; accès limité aux demandes ; notes internes invisibles ; statuts et historique ; attribution et transfert ; pièces jointes (autorisées, déguisées, trop lourdes, accès) ; lien de suivi anonyme. |
| `tests/aide.test.ts` | Recherche, renvoi vers Contact, insertion unique du contenu initial, édition réservée au général, publication. |

Chaque garde-fou a été éprouvé par sabotage (périmètre neutralisé, filtre
retiré, matrice contournée, compteur remplacé par `max + 1`) : chaque fois,
les tests concernés ont échoué.

## 9. Déploiement

Voir `docs/RASPBERRY-PI.md`, « Passer en 0.11.0 ». En résumé :
`scripts/update-pi.sh` sauvegarde la base, applique la migration, recompile et
redémarre ; `npm run numeros -- --verifier` contrôle la numérotation.

### Reprise après une migration interrompue

1. `npx prisma migrate status` : la migration apparaît en échec.
2. `npx prisma migrate resolve --rolled-back 20261017090000_administration_multi_niveaux`
3. `npx prisma migrate deploy` : la migration est rejouable, ce qui était fait
   est reconnu.
4. `npm run numeros` : termine la numérotation s'il en manque.

## 10. Retour arrière

La migration n'ajoute que des colonnes facultatives, des tables et des
déclencheurs : **la version 0.10.4 fonctionne sur une base migrée**. Le retour
arrière recommandé ne touche donc pas à la base :

```bash
cd /opt/parcelys
sudo -u parcelys git checkout --detach 327b4c1   # 0.10.4
sudo -u parcelys npm ci
sudo -u parcelys npm run build
sudo systemctl restart parcelys
```

Pendant ce retour en 0.10.4, un administrateur secondaire n'a plus accès à
l'administration (l'ancienne version ne connaît que `is_platform_admin`) : rien
ne s'ouvre, rien ne s'élargit. La contrainte `users_un_seul_niveau_admin`
refusera seulement de promouvoir général un compte encore secondaire : retirer
d'abord ce rôle depuis la 0.11.0, ou en SQL
(`UPDATE users SET is_secondary_admin = false WHERE email = '…'`).

Ne lancez pas `prisma migrate deploy` avec l'ancienne version. Les numéros, les
portefeuilles et les demandes restent en base, intacts, et réapparaissent en
revenant à la 0.11.0 (`git checkout claude/parcelys-saas-agricole-7iqlgw`, puis
`scripts/update-pi.sh`).

En dernier recours seulement — la base elle-même endommagée —, restaurer la
sauvegarde prise par `update-pi.sh` juste avant la migration :

```bash
sudo parcelys-restore /var/backups/parcelys/base-<date>.sql.gz            # essai à blanc
sudo parcelys-restore --remplacer /var/backups/parcelys/base-<date>.sql.gz
```

Tout ce qui a été saisi depuis cette sauvegarde est alors perdu.

## 11. Limites connues

- **Un secondaire ne délègue pas** : seul le général attribue ou transfère un
  client, crée un portefeuille ou un administrateur. Il n'existe pas
  d'autorisation fine (par exemple « référentiels » pour un secondaire) : les
  référentiels restent au général.
- **Secondaire = compte d'administration** : un exploitant ou un technicien ne
  peut pas être, en même temps, administrateur secondaire.
- **Exploitation créée par un exploitant lui-même** (deuxième exploitation) :
  elle arrive sans portefeuille et relève du général jusqu'à son attribution.
- **Identité d'un demandeur anonyme** : la confirmation prouve seulement qu'il
  reçoit les e-mails de l'adresse saisie. L'écran le dit ; la vérification
  d'identité proprement dite reste un geste humain.
- **Pièces jointes dans l'application mobile** : on peut en joindre, mais on
  les ouvre depuis le site.
- **Notifications des administrateurs** : dans Parcelys et par e-mail si le
  compte l'a activé ; aucune autre voie (SMS, messagerie).
- **Réponses de la FAQ marquées « À vérifier »** : durée de session (réglable
  sur le serveur), écart de surface avec la déclaration PAC, plan de fumure,
  calendrier d'épandage, mise à jour de l'APK — à relire avant de retirer la
  mention.
