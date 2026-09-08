# 🌾 Parcelys au champ

Application mobile de terrain pour [Parcelys](../README.md) : relevé de
parcelles au GPS, saisie des traitements, des apports et des travaux —
**y compris sans réseau**, ce qui est la situation ordinaire au milieu d'une
parcelle.

Elle est volontairement réduite à ce qui se fait debout, dans un champ, souvent
d'une seule main. La consultation des registres, les exports et
l'administration restent sur l'application web, où ils se font au bureau.

---

## Ce qu'elle fait

| Écran | Rôle |
| --- | --- |
| **Connexion** | Adresse de votre instance + identifiants. Le jeton de session est conservé par l'appareil (stockage natif), jamais dans un cookie. |
| **Parcelles** | Liste et recherche, servies par le cache local : disponibles hors réseau. |
| **Relever une parcelle** | Contour au GPS, en **marchant la limite** (un point tous les 10 m) ou en **posant un sommet** à chaque angle. Surface et périmètre calculés en direct. |
| **Fiche parcelle** | Trois saisies : traitement phytosanitaire, apport de fertilisant, travail réalisé. |
| **Synchronisation** | File d'attente visible, envoi manuel ou automatique au retour du réseau, motif de refus affiché pour chaque saisie rejetée. |

### Ce qu'elle ne fait pas, volontairement

- **Aucune donnée réglementaire n'est produite par l'application.** Hors ligne,
  la liste de produits proposée est celle des produits **réellement employés**
  sur l'exploitation depuis douze mois, avec leur AMM d'origine. La recherche
  dans le catalogue officiel E-Phy reste en ligne, sur l'application web.
- **La superficie affichée pendant le relevé est une estimation** (excès
  sphérique, calculé sur le téléphone). La valeur qui fait foi est celle que
  PostGIS calcule à l'enregistrement, sur l'ellipsoïde WGS84. L'écran le dit.
- **Pas de création de compte** : l'inscription se fait par code d'invitation,
  depuis l'application web.
- **Pas de fond de carte** pendant le relevé : les tuiles exigeraient du réseau,
  précisément ce qui manque. L'aperçu du contour est un tracé, pas une carte.

---

## Comment fonctionne le mode hors ligne

```
Saisie ──▶ file d'attente (IndexedDB) ──▶ POST /api/sync ──▶ routes de l'API
                     ▲                                            │
                     └──────── conservée tant que non confirmée ──┘
```

Trois décisions structurent tout le reste :

1. **Toute saisie passe par la file d'attente**, réseau ou pas. Un seul chemin
   de code, donc un seul comportement à éprouver — et aucune saisie perdue si
   la connexion lâche au moment de l'envoi.

2. **Le serveur rejoue ses propres routes.** `/api/sync` ne réimplémente aucune
   règle métier : il passe chaque opération à la route correspondante
   (`POST /api/parcels`, `.../phytosanitary`…). Le calcul de superficie, le
   bilan NPK, les contrôles de surface traitée et le journal d'audit sont donc
   identiques à ceux de l'application web.

3. **Chaque saisie porte un identifiant d'appareil**, transmis en
   `Idempotency-Key`. Un lot renvoyé après une réponse perdue ne crée aucun
   doublon : le serveur renvoie la réponse initiale. C'est ce qui rend une
   synchronisation sûre sur une connexion de campagne.

Une opération refusée **reste** dans la file avec son motif, visible à l'écran,
jusqu'à ce que l'utilisateur la corrige ou la supprime. Rien ne disparaît en
silence d'un registre réglementaire.

---

## Développement

```bash
cd mobile
npm install
npm run dev          # http://127.0.0.1:5174
```

Le GPS fonctionne dans le navigateur (Capacitor retombe sur
`navigator.geolocation`). Renseignez l'adresse de votre instance Parcelys à la
connexion, par exemple `http://127.0.0.1:3000`.

**Côté serveur**, l'origine de l'application doit être autorisée :

```bash
# .env de l'instance Parcelys
MOBILE_APP_ORIGINS="capacitor://localhost,http://localhost,https://localhost,http://127.0.0.1:5174"
```

---

## Construire l'APK

### Prérequis

- **JDK 21** (`sudo apt install openjdk-21-jdk`)
- **Android SDK** — le plus simple est [Android Studio](https://developer.android.com/studio) ;
  sinon les *command line tools* suffisent :

  ```bash
  export ANDROID_HOME="$HOME/Android/Sdk"
  sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
  echo "sdk.dir=$ANDROID_HOME" > mobile/android/local.properties
  ```

### APK de test (installable immédiatement)

```bash
cd mobile
npm run apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Transférez le fichier sur le téléphone et installez-le (il faut autoriser
« installer des applications inconnues » pour l'application qui ouvre le
fichier).

### APK signé, pour un usage durable

Un APK de débogage se réinstalle mal et n'est pas fait pour durer. Pour une
version signée :

```bash
keytool -genkey -v -keystore parcelys.keystore -alias parcelys \
        -keyalg RSA -keysize 2048 -validity 10000
```

Puis dans `mobile/android/app/build.gradle` :

```groovy
android {
    signingConfigs {
        release {
            storeFile file("../../parcelys.keystore")
            storePassword System.getenv("PARCELYS_STORE_PASSWORD")
            keyAlias "parcelys"
            keyPassword System.getenv("PARCELYS_KEY_PASSWORD")
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.release }
    }
}
```

```bash
PARCELYS_STORE_PASSWORD=… PARCELYS_KEY_PASSWORD=… npm run apk:release
# → android/app/build/outputs/apk/release/app-release.apk
```

> **Conservez le fichier `.keystore` et ses mots de passe hors du dépôt.** Sans
> lui, aucune mise à jour de l'application ne pourra être installée par-dessus :
> Android refuse une signature différente.

### Après chaque modification

```bash
npm run sync     # reconstruit le web et le recopie dans le projet Android
```

---

## Configuration côté serveur

L'application appelle une instance Parcelys que vous hébergez. Deux réglages
comptent :

| Variable | Valeur |
| --- | --- |
| `MOBILE_APP_ORIGINS` | Doit contenir `http://localhost` (WebView Android). C'est déjà le cas par défaut. |
| `APP_URL` | L'adresse publique de l'instance, utilisée pour les liens des e-mails. |

**HTTPS est nécessaire.** La configuration Capacitor refuse le trafic en clair
(`cleartext: false`), et Android le bloquerait de toute façon. Pour un essai en
réseau local sur une adresse IP en HTTP, activez temporairement
`server.cleartext: true` dans `capacitor.config.ts` — et remettez-le à `false`
ensuite.

---

## Sécurité

| Point | Traitement |
| --- | --- |
| Authentification | Jeton opaque de 32 octets, **stocké haché** côté serveur, conservé par l'appareil dans le stockage natif (`Preferences`), envoyé en `Authorization: Bearer`. |
| Cookies | Aucun. La WebView est sur une autre origine ; un cookie n'y reviendrait jamais et n'aurait servi qu'à élargir la surface d'attaque. |
| CORS | Liste fermée d'origines (`MOBILE_APP_ORIGINS`), **sans** `Allow-Credentials` : aucun site tiers ne peut emprunter une session. |
| CSRF | Sans cookie, il n'y a pas d'identifiant ambiant à détourner. La vérification d'origine reste appliquée dès qu'un cookie est présent. |
| Permissions | Position fine uniquement, jamais en arrière-plan : le relevé n'a lieu que l'application ouverte. |
| Déconnexion | Révoque la session côté serveur **et** vide le cache et la file locale. L'écran prévient si des saisies sont encore en attente. |

Un téléphone perdu se traite depuis le profil web (« Sessions actives ») ou
depuis l'administration : la session porte le nom de l'appareil.
