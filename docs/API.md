# API Parcelys

API REST interne, consommée par l'interface web. Toutes les routes sont
préfixées par `/api`.

---

## Conventions

### Authentification

L'authentification repose sur un **cookie de session** (`parcelys_session`),
`HttpOnly`, `SameSite=Lax`, et `Secure` en production. Il est posé par
`POST /api/auth/login` ou `POST /api/auth/verify-email`.

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
| 403 | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `CSRF_BLOCKED` | Droits insuffisants |
| 404 | `NOT_FOUND` | Ressource inexistante **ou** hors de vos exploitations |
| 409 | `CONFLICT` | Valeur déjà utilisée |
| 423 | `ACCOUNT_LOCKED` | Compte temporairement verrouillé |
| 429 | `RATE_LIMITED` | Trop de requêtes (en-tête `Retry-After`) |
| 502 | `WEATHER_UNAVAILABLE`, `GEOCODER_UNAVAILABLE` | Service tiers injoignable |

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

---

## Authentification

### `POST /api/auth/register`

Crée l'utilisateur, son exploitation (rôle propriétaire), le référentiel de
cultures de l'exploitation, puis envoie un code de vérification.
**Aucune session n'est ouverte** tant que l'adresse n'est pas vérifiée.

```json
{
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

Contraintes : mot de passe de 10 caractères minimum avec majuscule, minuscule et
chiffre ; SIRET à 14 chiffres ou SIREN à 9 ; les deux consentements sont
obligatoires. Limitation : 5 inscriptions par heure et par IP.

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
