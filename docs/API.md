# API Parcelys

API REST interne, consommée par l'interface web. Toutes les routes sont
préfixées par `/api`.

---

## Conventions

### Authentification

L'authentification repose sur un **cookie de session** (`parcelys_session`),
`HttpOnly`, `SameSite=Lax`, et `Secure` en production. Il est posé par
`POST /api/auth/login` ou `POST /api/auth/verify-email`.

L'application mobile, dont la WebView est sur une autre origine et ne recevrait
jamais ce cookie, présente le **même** jeton dans un en-tête
`Authorization: Bearer` — voir
[Application mobile et synchronisation](#application-mobile-et-synchronisation).
Le cookie reste prioritaire quand les deux sont présents.

Toutes les routes hors `/api/auth/*` exigent :

1. une session valide ;
2. une adresse e-mail vérifiée ;
3. l'appartenance à l'exploitation concernée ;
4. un rôle disposant de la permission requise.

### Exploitation active

Les routes qui ne portent pas d'identifiant de parcelle s'appliquent à
**l'exploitation active** de la session, modifiable par
`POST /api/farms/switch`.

### Protection CSRF

Les requêtes `POST`, `PUT`, `PATCH` et `DELETE` portant un en-tête `Origin`
doivent provenir de `APP_URL` ou de l'hôte courant. Une origine étrangère
renvoie `403 CSRF_BLOCKED`.

Seule exception : une requête **sans cookie de session** venant d'une origine
d'application native déclarée (`MOBILE_APP_ORIGINS`). Sans identifiant ambiant,
il n'y a rien à détourner. Dès qu'un cookie accompagne la requête, la
vérification s'applique de nouveau — y compris depuis ces origines.

### Format des erreurs

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Données invalides",
    "details": [{ "field": "password", "message": "Ajoutez au moins un chiffre" }]
  }
}
```

| Code HTTP | `code` | Signification |
| --- | --- | --- |
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR` | Entrée invalide |
| 401 | `UNAUTHENTICATED` | Session absente, expirée ou révoquée |
| 403 | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `CSRF_BLOCKED`, `ACCOUNT_SUSPENDED` | Droits insuffisants |
| 403 | `INVITATION_REQUIRED`, `INVITATION_INVALID`, `INVITATION_EMAIL_MISMATCH` | Inscription fermée ou code inutilisable |
| 404 | `NOT_FOUND` | Ressource inexistante **ou** hors de vos exploitations |
| 409 | `CONFLICT`, `INVITATION_ALREADY_USED`, `SELF_ACTION_FORBIDDEN`, `LAST_ADMIN` | Conflit d'état |
| 423 | `ACCOUNT_LOCKED` | Compte temporairement verrouillé |
| 429 | `RATE_LIMITED` | Trop de requêtes (en-tête `Retry-After`) |
| 502 | `WEATHER_UNAVAILABLE`, `GEOCODER_UNAVAILABLE` | Service tiers injoignable |
| 503 | `MAINTENANCE` | Mode maintenance actif (les administrateurs d'instance passent) |

> **Note de sécurité :** une ressource appartenant à une autre exploitation
> renvoie **404**, jamais 403 — l'existence de la ressource n'est pas divulguée.

### Rôles et permissions

| Permission | Propriétaire | Administrateur | Salarié | Lecture seule |
| --- | :-: | :-: | :-: | :-: |
| Consulter parcelles et interventions | ✅ | ✅ | ✅ | ✅ |
| Créer / modifier une parcelle | ✅ | ✅ | ✅ | ❌ |
| Supprimer une parcelle | ✅ | ✅ | ❌ | ❌ |
| Saisir une intervention | ✅ | ✅ | ✅ | ❌ |
| Téléverser un document | ✅ | ✅ | ✅ | ❌ |
| Supprimer un document | ✅ | ✅ | ❌ | ❌ |
| Modifier l'exploitation | ✅ | ✅ | ❌ | ❌ |
| Gérer les membres | ✅ | ✅ | ❌ | ❌ |
| Exporter | ✅ | ✅ | ✅ | ✅ |

Ces rôles valent **dans une exploitation**. L'accès aux routes `/api/admin/*`
dépend d'une autorité distincte, l'**administrateur d'instance**, qui ne confère
en retour aucun accès aux données agronomiques des exploitations dont il n'est
pas membre.

---

## Authentification

### `POST /api/auth/register`

Crée l'utilisateur, le rattache à une exploitation (existante ou nouvelle), puis
envoie un code de vérification. **Aucune session n'est ouverte** tant que
l'adresse n'est pas vérifiée.

**Un code d'invitation est obligatoire**, sauf pour le tout premier compte d'une
instance vierge — personne ne peut alors en délivrer, et ce compte devient
administrateur de l'instance.

```json
{
  "invitationCode": "PRCL-8F3A-KT2M-QWX7",
  "firstName": "Jean",
  "lastName": "Dupont",
  "email": "jean@ferme.fr",
  "password": "MotDePasse1",
  "passwordConfirmation": "MotDePasse1",
  "farmName": "GAEC des Prés",
  "siret": "12345678901234",
  "acceptTerms": true,
  "acceptPrivacy": true
}
```

`201` → `{ "message": "...", "email": "...", "nextStep": "verification-email" }`

`farmName` n'est requis que si le code ne désigne aucune exploitation ; sinon le
compte rejoint celle prévue par le code, avec le rôle qu'il porte. Le code est à
usage unique et consommé dans la même transaction que la création du compte :
deux inscriptions simultanées avec le même code ne peuvent pas aboutir toutes
les deux. Un code invalide, expiré, révoqué ou déjà utilisé renvoie la même
erreur `INVITATION_INVALID`, pour ne pas transformer le formulaire en oracle.

Contraintes : mot de passe de 10 caractères minimum avec majuscule, minuscule et
chiffre ; SIRET à 14 chiffres ou SIREN à 9 ; les deux consentements sont
obligatoires. Limitation : 5 inscriptions par heure et par IP, et 10 essais de
code par quart d'heure et par IP.

### `POST /api/auth/invitation/check`

Vérifie un code **sans le consommer**, pour que le formulaire d'inscription
puisse s'adapter. Public, fortement limité en débit.

```json
{ "code": "PRCL-8F3A-KT2M-QWX7", "email": "jean@ferme.fr" }
```

`200` →

```json
{
  "scope": "EXISTING_FARM",
  "farmName": "GAEC des Prés",
  "role": "EMPLOYEE",
  "roleLabel": "Salarié",
  "email": null,
  "grantsPlatformAdmin": false,
  "expiresAt": "2026-09-22T00:00:00.000Z"
}
```

`scope` vaut `NEW_FARM` lorsque le titulaire créera sa propre exploitation.

### `POST /api/auth/login`

```json
{ "email": "jean@ferme.fr", "password": "MotDePasse1" }
```

`200` → pose le cookie de session.
`401` si les identifiants sont incorrects (message identique que le compte
existe ou non).
`403 EMAIL_NOT_VERIFIED` si l'adresse n'est pas vérifiée — un nouveau code est
alors envoyé automatiquement.
`423 ACCOUNT_LOCKED` après 8 échecs (verrouillage de 15 minutes).

Limitation : 10 tentatives par 15 minutes, par IP **et** par compte.

### `POST /api/auth/verify-email`

```json
{ "email": "jean@ferme.fr", "code": "123456" }
```

Valide l'adresse et **ouvre directement la session**. Le code expire au bout de
15 minutes et tolère 5 tentatives.

### `POST /api/auth/resend-code`

```json
{ "email": "jean@ferme.fr" }
```

Émet un nouveau code et invalide le précédent. Réponse identique pour une
adresse inconnue. Limitation : 3 demandes par 15 minutes.

### `POST /api/auth/forgot-password`

```json
{ "email": "jean@ferme.fr" }
```

Envoie un lien de réinitialisation valable 30 minutes. Réponse invariable.

### `POST /api/auth/reset-password`

```json
{
  "token": "...",
  "password": "NouveauSecret1",
  "passwordConfirmation": "NouveauSecret1"
}
```

Applique le nouveau mot de passe, **révoque toutes les sessions** et marque
l'adresse comme vérifiée.

### `POST /api/auth/logout`

Révoque la session courante et efface le cookie.

### `POST /api/auth/logout-all`

Révoque **toutes** les sessions de l'utilisateur, y compris la courante.

### `GET /api/auth/session`

```json
{
  "authenticated": true,
  "user": { "id": "...", "email": "...", "firstName": "...", "emailVerified": true },
  "memberships": [{ "farmId": "...", "farmName": "...", "role": "OWNER" }],
  "activeFarmId": "...",
  "activeRole": "OWNER"
}
```

---

## Parcelles

### `GET /api/parcels`

Paramètres : `search`, `cropId`, `status` (`ACTIVE`/`FALLOW`/`ARCHIVED`),
`parcelType`, `commune`, `year`, `page`, `pageSize` (≤ 200),
`sort` (`name`/`area`/`commune`/`recent`).

```json
{
  "campaignYear": 2026,
  "page": 1,
  "pageSize": 50,
  "total": 6,
  "totalAreaHa": 328.81,
  "items": [
    {
      "id": "...",
      "name": "Le Grand Champ",
      "internalNumber": "P-001",
      "commune": "Artenay",
      "areaHa": 61.2345,
      "status": "ACTIVE",
      "centroid": { "lat": 48.0866, "lng": 1.8842 },
      "crop": { "id": "...", "name": "Blé tendre", "variety": "Rubisko" },
      "counts": { "fertilizations": 2, "phyto": 1, "operations": 2 }
    }
  ]
}
```

### `POST /api/parcels`

```json
{
  "name": "Le Grand Champ",
  "internalNumber": "P-001",
  "commune": "Artenay",
  "lieuDit": "Les Terres Blanches",
  "cadastralRef": "ZK 0042",
  "pacId": "...",
  "parcelType": "Terre labourable",
  "status": "ACTIVE",
  "notes": "...",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[1.878, 48.083], [1.890, 48.083], [1.890, 48.090], [1.878, 48.090], [1.878, 48.083]]]
  }
}
```

`geometry` accepte un `Polygon` ou un `MultiPolygon` GeoJSON (`[longitude,
latitude]`, SRID 4326). Les anneaux non fermés le sont automatiquement.

**La superficie n'est jamais reprise du client** : elle est calculée par PostGIS
(`ST_Area(geometry::geography)`) sur l'ellipsoïde WGS84.

`201` :

```json
{
  "id": "...",
  "name": "Le Grand Champ",
  "areaHa": 61.2345,
  "centroid": { "lat": 48.0866, "lng": 1.8842 },
  "warnings": ["Cette parcelle recouvre 1 parcelle(s) existante(s) : Les Sables (2.1043 ha)"]
}
```

Erreurs : `400` si le polygone est auto-sécant (message issu de
`ST_IsValidReason`) ou si sa superficie est nulle ; `409` si le numéro interne
est déjà pris.

### `GET /api/parcels/:id`

Fiche complète : attributs, `geometry` (GeoJSON), `currentCrop`, `cropYears`,
compteurs d'interventions.

### `PUT /api/parcels/:id`

Champs partiels. Fournir `geometry` déclenche un recalcul de superficie et crée
une **nouvelle version** de géométrie ; les versions précédentes sont conservées
(`is_current = false`).

### `DELETE /api/parcels/:id`

Suppression **logique** : la parcelle disparaît des listes et de la carte, mais
ses interventions restent en base pour que les registres et exports antérieurs
demeurent complets.

### `GET /api/parcels/geojson`

`FeatureCollection` des parcelles de l'exploitation, avec la culture de la
campagne (`?year=2026`).

---

## Cultures

### `GET /api/parcels/:id/crops`

Assolement de la parcelle, campagnes décroissantes.

### `POST /api/parcels/:id/crops`

```json
{
  "cropId": "...",
  "campaignYear": 2026,
  "variety": "Rubisko",
  "sowingDate": "2025-10-15",
  "expectedHarvestDate": "2026-07-20",
  "actualHarvestDate": "2026-07-22",
  "yieldValue": 82.5,
  "yieldUnit": "q/ha",
  "notes": "..."
}
```

Réenregistrer la même culture sur la même campagne **met à jour** l'existant.
Unités de rendement : `q/ha`, `t/ha`, `kg/ha`, `hL/ha`, `bottes/ha`.

### `GET /api/crops` · `POST /api/crops`

Référentiel de cultures (global + exploitation). `POST` crée une culture
personnalisée.

### `DELETE /api/crop-years/:id`

Retire une culture de l'assolement.

---

## Apports

### `GET /api/parcels/:id/fertilization`

```json
{
  "items": [ ... ],
  "balance": {
    "totalN": 837.5, "totalP": 0, "totalK": 0,
    "perHectareN": 67, "perHectareP": 0, "perHectareK": 0,
    "areaHa": 12.5,
    "incompleteCount": 1
  }
}
```

`incompleteCount` recense les apports sans teneur en azote connue : le bilan est
alors sous-estimé, et l'interface le signale.

### `POST /api/parcels/:id/fertilization`

```json
{
  "appliedOn": "2026-02-25",
  "inputType": "MINERAL",
  "fertilizerId": "...",
  "productLabel": "Ammonitrate 33,5 %",
  "dose": 180,
  "doseUnit": "kg/ha",
  "treatedAreaHa": 12.5,
  "supplier": "Coopérative",
  "batchNumber": "LOT-2026-014",
  "operator": "Camille Durand",
  "notes": "...",
  "cropYearId": "...",
  "nSupplied": 60.3
}
```

- `inputType` : `MINERAL` (avec `fertilizerId`) ou `ORGANIC` (avec
  `organicInputId`). Croiser les deux est refusé.
- `treatedAreaHa` vaut par défaut la superficie de la parcelle ; la dépasser de
  plus de 5 % est refusé.
- Unités de dose : `kg/ha`, `L/ha`, `t/ha`, `m3/ha`, `g/ha`, `unité/ha`.

**Calculs côté serveur :**

- `totalQuantity = dose × treatedAreaHa`, unité déduite (`kg/ha` → `kg`) ;
- éléments fertilisants, à partir du référentiel :
  - minéral : `dose × teneur % / 100`,
  - organique : `dose × teneur (kg/t ou kg/m³)` ;
- une teneur inconnue reste `null` — **jamais estimée** ;
- `nSupplied` / `pSupplied` / `kSupplied` fournis explicitement (analyse de
  produit) sont prioritaires sur le calcul.

`201` → `{ "item": { ... }, "computed": { "totalQuantity": 2250, "totalUnit": "kg", "nSupplied": 60.3, "pSupplied": null, "kSupplied": null }, "message": "Apport enregistré" }`

### `DELETE /api/fertilization/:id`

### `GET /api/fertilizers` · `GET /api/organic-inputs`

Référentiels d'engrais minéraux et de produits organiques.

---

## Phytosanitaire

### `GET /api/phytosanitary/products?q=`

Recherche dans le catalogue **E-Phy importé**. Paramètres : `q` (nom commercial,
second nom ou numéro d'AMM), `onlyAuthorized`, `limit` (≤ 50).

```json
{
  "results": [
    {
      "id": "...",
      "amm": "2020024",
      "name": "...",
      "holder": "...",
      "status": "Autorisé",
      "formulation": "SL",
      "substances": ["..."]
    }
  ],
  "total": 12,
  "source": {
    "label": "Données issues de sources officielles (E-Phy — ANSES, jeu de données ouvert)",
    "lastSyncAt": "2026-09-01T03:00:00.000Z",
    "productsInBase": 15234,
    "configured": true
  }
}
```

> `source` est **toujours** présent. Si `configured` vaut `false`, aucune
> synchronisation n'a eu lieu : la liste est vide et l'interface l'indique.
> Parcelys ne produit aucune donnée réglementaire.

### `GET /api/phytosanitary/products/:idOrAmm`

Fiche produit officielle : substances actives (avec numéro CAS et
concentration), usages autorisés (culture, cible, dose, DAR, ZNT aquatique,
nombre maximal d'applications, conditions d'emploi), mentions autorisées,
restrictions, date de retrait. Les champs absents du jeu de données sont
retournés `null`.

### `POST /api/parcels/:id/phytosanitary`

```json
{
  "appliedOn": "2026-03-15",
  "productId": "...",
  "productName": "Produit non référencé",
  "amm": "2020024",
  "targetLabel": "Adventices",
  "cropLabel": "Blé tendre",
  "dose": 1.5,
  "doseUnit": "L/ha",
  "sprayVolumeLHa": 150,
  "treatedAreaHa": 12.5,
  "operator": "Camille Durand",
  "captureWeather": true,
  "notes": "..."
}
```

- Avec `productId`, le nom, le numéro d'AMM et les substances actives sont
  **repris du référentiel** ; les valeurs envoyées par le client sont ignorées.
- Sans `productId` (saisie libre), `amm` reste ce qui est fourni — souvent
  vide — et la réponse renvoie un avertissement : l'intervention apparaîtra
  comme « à compléter » dans le tableau de bord et le registre.
- `captureWeather: true` relève automatiquement température, vent, humidité et
  précipitations sur le centroïde de la parcelle. En cas d'indisponibilité du
  service, les champs restent vides — aucune valeur n'est inventée.

### `GET /api/phytosanitary/applications`

Registre de l'exploitation. Paramètres : `year`, `parcelId`, `q`, `substance`,
`filtre=incomplet`.

### `DELETE /api/phytosanitary/applications/:id`

---

## Travaux

### `GET /api/parcels/:id/operations` · `POST /api/parcels/:id/operations`

```json
{
  "performedOn": "2025-09-05",
  "type": "DECHAUMAGE",
  "equipment": "Déchaumeur à disques 4 m",
  "operator": "Camille Durand",
  "durationHours": 1.5,
  "notes": "..."
}
```

Types : `LABOUR`, `DECHAUMAGE`, `SEMIS`, `ROULAGE`, `HERSAGE`, `BROYAGE`,
`FAUCHE`, `RECOLTE`, `TRANSPORT`, `IRRIGATION`, `AUTRE`.

### `DELETE /api/operations/:id`

---

## Historique

### `GET /api/parcels/:id/history`

Paramètre `kinds` (liste séparée par des virgules) : `CROP`, `HARVEST`,
`FERTILIZATION`, `PHYTO`, `OPERATION`, `DOCUMENT`.

```json
{
  "events": [
    {
      "id": "fert-...",
      "kind": "FERTILIZATION",
      "date": "2026-02-25T00:00:00.000Z",
      "parcelId": "...",
      "parcelName": "Le Grand Champ",
      "title": "Apport minéral : Ammonitrate 33,5 %",
      "details": ["Dose : 180 kg/ha", "Quantité totale : 2250 kg sur 12.5 ha"],
      "link": "/parcelles/.../?onglet=apports"
    }
  ]
}
```

Ordre antichronologique.

---

## Documents

### `GET /api/parcels/:id/documents`

### `POST /api/parcels/:id/documents`

`multipart/form-data` : `file` (requis), `category`, `description`.

Catégories : `FACTURE`, `ANALYSE_SOL`, `PHOTO`, `ADMINISTRATIF`,
`RESULTAT_ANALYSE`, `AUTRE`.

Formats acceptés : `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.csv`, `.txt`,
`.xlsx`. Taille maximale : `UPLOAD_MAX_BYTES` (15 Mo par défaut).

La validation croise **l'extension, le type MIME déclaré et la signature
binaire** : un exécutable renommé en `.pdf` est rejeté. Le fichier est écrit
sous un nom aléatoire, dans un dossier propre à l'exploitation.

### `GET /api/documents/:id`

Télécharge le fichier (`Content-Disposition: attachment`, `nosniff`).

### `DELETE /api/documents/:id`

Supprime l'enregistrement **et** le fichier.

---

## Météo

### `GET /api/weather`

Paramètres : `lat` + `lng`, ou `parcelId`. À défaut, les coordonnées du siège
d'exploitation, puis le centroïde d'une parcelle.

```json
{
  "provider": "open-meteo",
  "latitude": 48.0836,
  "longitude": 1.8836,
  "timezone": "Europe/Paris",
  "fetchedAt": "2026-09-07T09:00:00.000Z",
  "current": {
    "temperatureC": 18.4, "humidity": 72, "windKmh": 11.2,
    "precipitationMm": 0, "pressureHpa": 1017, "summary": "Partiellement nuageux"
  },
  "hourly": [ ... ],
  "daily": [ ... ],
  "spraying": {
    "suitable": false,
    "reasons": ["Pluie annoncée dans les 6 h (2.4 mm)"]
  }
}
```

`502 WEATHER_UNAVAILABLE` si le fournisseur est injoignable — aucune valeur de
repli n'est fabriquée.

---

## Exports

### `GET /api/exports`

| Paramètre | Valeurs |
| --- | --- |
| `dataset` | `parcelles`, `phytosanitaire`, `apports`, `historique`, `cultures`, `travaux` |
| `format` | `csv`, `xlsx`, `pdf` |
| `year` | Campagne (1er août → 31 juillet) |
| `from` / `to` | Période explicite (prioritaire sur `year`) |
| `parcelIds` | Identifiants séparés par des virgules |
| `cropIds` | Identifiants séparés par des virgules |

Renvoie le fichier en pièce jointe.

- **CSV** : séparateur `;`, UTF-8 avec BOM (ouverture directe dans Excel
  francophone), neutralisation de l'injection de formule.
- **Excel** : en-tête figé, filtre automatique, largeurs de colonnes.
- **PDF** : A4 paysage, en-tête et pagination, mention de provenance en pied.

Les identifiants de parcelles fournis sont **filtrés côté serveur** : impossible
d'inclure une parcelle d'une autre exploitation. Limitation : 30 exports par
5 minutes.

---

## Exploitation et profil

| Route | Description |
| --- | --- |
| `GET /api/farms` | Fiche de l'exploitation active |
| `PUT /api/farms` | Modification (nom, SIRET, adresse, coordonnées) |
| `POST /api/farms/switch` | Change l'exploitation active de la session |
| `GET /api/profile` | Informations personnelles et préférences |
| `PUT /api/profile` | Met à jour identité et/ou préférences |
| `PUT /api/profile/password` | Change le mot de passe (révoque les autres sessions) |
| `GET /api/profile/sessions` | Sessions actives |
| `DELETE /api/profile/sessions` | Révoque une session (`{ "sessionId": "..." }`) |
| `GET /api/notifications` | Notifications + nombre de non lues |
| `PATCH /api/notifications` | Marque comme lues (`{ "ids": [...] }` ou tout) |

---

## Application mobile et synchronisation

L'application de terrain n'est pas servie par l'instance : elle vit dans un APK
et appelle l'API depuis une autre origine. Deux conséquences.

### Authentification par jeton

`POST /api/auth/login` avec `"client": "native"` renvoie le jeton de session au
lieu de poser un cookie :

```json
{ "email": "jean@ferme.fr", "password": "…", "client": "native", "deviceName": "Pixel 7" }
```

`200` → `{ "token": "…", "expiresAt": "…", "user": { … } }`

Le jeton se présente ensuite en `Authorization: Bearer <token>` sur toutes les
routes. C'est le même secret qu'un cookie de session — opaque, aléatoire sur
32 octets, **stocké haché** — avec la même expiration et la même révocation.
`deviceName` apparaît dans la liste des sessions du profil, pour reconnaître et
révoquer un téléphone perdu.

Le jeton n'est **jamais** renvoyé au client web, dont la session reste un cookie
`HttpOnly` inaccessible au JavaScript.

### CORS et CSRF

Les origines des WebView Capacitor (`http://localhost`,
`capacitor://localhost`…) sont autorisées par `MOBILE_APP_ORIGINS`, **sans**
`Access-Control-Allow-Credentials`. Une requête sans cookie de session ne porte
aucun identifiant ambiant : la CSRF y est impossible, et la vérification
d'origine ne s'y applique pas. Dès qu'un cookie est présent, elle reprend —
une écriture inter-sites accompagnée d'un cookie reste refusée.

### Idempotence des écritures

Toute route mutante accepte un en-tête `Idempotency-Key` (un identifiant produit
par le client, par saisie). La première exécution mémorise la réponse ; un rejeu
la renvoie telle quelle, avec `Idempotency-Replayed: true`, sans retoucher la
base.

La clé est associée à l'empreinte du jeton de session : deux appareils peuvent
employer la même clé sans se percuter, et personne ne peut relire la réponse
d'un autre. Les échecs ne sont pas mémorisés — une saisie corrigée peut repartir
avec la même clé. Réutiliser une clé pour **une autre** route renvoie
`409 IDEMPOTENCY_KEY_REUSED`.

### `GET /api/mobile/bootstrap`

Instantané complet du cache hors ligne : exploitation, parcelles **avec leur
géométrie**, référentiels (cultures, engrais, produits organiques, unités,
types de travaux) et produits phytosanitaires réellement employés sur les douze
derniers mois, avec leur AMM.

Aucune donnée réglementaire n'est produite : la liste hors ligne provient de
saisies passées, la recherche au catalogue officiel E-Phy reste en ligne.

### `POST /api/sync`

Rejoue un lot de saisies faites hors réseau (50 au maximum).

```json
{
  "operations": [
    {
      "clientId": "3f0c…",
      "kind": "parcel.create",
      "capturedAt": "2026-04-01T08:00:00.000Z",
      "payload": { "name": "Les Grandes Pièces", "geometry": { "type": "Polygon", "coordinates": [[…]] } }
    },
    {
      "clientId": "9ab1…",
      "kind": "phyto.create",
      "parcelId": "clx…",
      "payload": { "appliedOn": "2026-04-02", "productName": "…", "dose": 1.5, "doseUnit": "L/ha", "captureWeather": false }
    }
  ]
}
```

`kind` est limité à `parcel.create`, `fertilization.create`, `phyto.create` et
`operation.create` — une liste fermée : la synchronisation n'est pas un tunnel
vers le reste de l'API.

Chaque opération est passée à la **route correspondante** de l'API. Les règles
métier — superficie calculée par PostGIS, bilan NPK, contrôle de la surface
traitée, permissions, journal d'audit — sont donc exactement celles de
l'application web. `clientId` sert de clé d'idempotence.

`200` →

```json
{
  "syncedAt": "…",
  "applied": 1,
  "rejected": 1,
  "results": [
    { "clientId": "3f0c…", "kind": "parcel.create", "status": "applied", "entityId": "clx…", "httpStatus": 201 },
    { "clientId": "9ab1…", "kind": "phyto.create", "status": "rejected", "httpStatus": 400,
      "message": "Données invalides", "fieldErrors": [{ "field": "dose", "message": "…" }] }
  ]
}
```

`status` vaut `applied`, `replayed` (déjà enregistrée lors d'un envoi précédent)
ou `rejected`. **Un refus n'interrompt pas le lot** : les autres opérations
passent, et le client n'a à corriger que celle-là. Les opérations sont traitées
en séquence, de sorte qu'une parcelle créée en début de lot puisse recevoir ses
interventions dans le même envoi.

### `GET /api/sync?since=`

Changements depuis une date ISO 8601 (trente jours par défaut) : parcelles
modifiées et identifiants des parcelles supprimées, pour rafraîchir le cache
sans retélécharger l'instantané complet.

---

## Administration de l'instance

Toutes ces routes exigent un compte **administrateur d'instance**
(`User.isPlatformAdmin`). Pour tout autre compte elles répondent `403 FORBIDDEN`,
et `401` sans session.

### `GET /api/admin/users`

Paramètres : `statut` (`tous`, `actifs`, `suspendus`, `non-verifies`, `admins`)
et `q` (nom ou adresse).

`200` → `{ "users": [...], "count": 12 }`. Chaque compte porte son état
(administrateur, suspendu, adresse vérifiée, verrouillage, sessions actives) et
ses appartenances avec le rôle correspondant.

### `PATCH /api/admin/users/:id`

Une action nommée par requête — l'API n'expose aucun champ modifiable
directement, et ne permet ni de changer le mot de passe ni l'adresse d'un tiers.

```json
{ "action": "suspend", "reason": "Départ de l'exploitation" }
```

| `action` | Effet |
| --- | --- |
| `suspend` | Bloque la connexion et révoque immédiatement les sessions ouvertes |
| `restore` | Lève la suspension |
| `unlock` | Efface le verrouillage anti-bruteforce et le compteur d'échecs |
| `verify-email` | Marque l'adresse comme vérifiée |
| `revoke-sessions` | Ferme toutes les sessions du compte |
| `set-platform-admin` | Accorde ou retire le rôle d'administrateur (`{ "value": true }`) |

`409 SELF_ACTION_FORBIDDEN` si l'on tente de se suspendre ou de se déclasser
soi-même ; `409 LAST_ADMIN` si l'opération laisserait l'instance sans
administrateur.

### `DELETE /api/admin/users/:id`

Suppression logique : accès supprimé, sessions révoquées. Les enregistrements
réglementaires saisis restent attachés à leur exploitation — l'exploitant doit
les conserver. `409 CONFLICT` si le compte est l'unique propriétaire d'une
exploitation.

### `GET` · `POST /api/admin/invitations`

`POST` délivre un code :

```json
{
  "farmId": "clx…",
  "role": "EMPLOYEE",
  "email": "jean@ferme.fr",
  "grantsPlatformAdmin": false,
  "note": "Nouveau salarié",
  "validityDays": 14
}
```

`201` → `{ "code": "PRCL-8F3A-KT2M-QWX7", "invitation": { … } }`

**C'est la seule réponse contenant le code en clair** : seule son empreinte
SHA-256 est stockée, et `GET` ne renvoie qu'un indice (`codeHint`). `farmId` vide
signifie que le titulaire créera sa propre exploitation, avec le rôle
propriétaire.

### `DELETE /api/admin/invitations/:id`

Révoque un code non encore utilisé. `409 CONFLICT` s'il a déjà servi : la trace
de son émission fait partie du journal et n'est pas effacée.

### `GET` · `POST /api/admin/maintenance`

```json
{ "enabled": true, "message": "Migration de la base en cours." }
```

Mode maintenance : les pages redirigent vers `/maintenance` et les routes
métier répondent `503 MAINTENANCE`. Les administrateurs d'instance conservent
l'accès complet — sans quoi personne ne pourrait lever le mode.

### `POST /api/admin/cleanup`

```json
{ "targets": ["sessions", "rate-limits", "invitations", "audit"], "auditRetentionDays": 365 }
```

Purges rejouables : sessions expirées ou révoquées, compteurs de limitation,
codes caducs jamais utilisés, journal d'audit au-delà de sa durée de
conservation. `200` → `{ "message": "...", "results": { … } }`.

---

## RGPD

### `GET /api/account/export`

Export JSON complet : compte, appartenances, exploitations, parcelles et leurs
interventions, notifications, sessions, journal d'audit. Limitation : 3 exports
par heure.

### `DELETE /api/account`

```json
{ "password": "MotDePasse1", "confirmation": "SUPPRIMER" }
```

Supprime le compte, ainsi que les exploitations dont l'utilisateur est le seul
membre (fichiers compris). Les exploitations partagées sont conservées : seule
l'appartenance est retirée.

---

## Géocodage

| Route | Description |
| --- | --- |
| `GET /api/geo/search?q=` | Recherche d'adresse (Base Adresse Nationale) |
| `GET /api/geo/reverse?lat=&lng=` | Commune correspondant à un point |

Limitation : 60 requêtes par minute et par IP.
