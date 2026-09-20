# 7. Sécurité

> Une architecture conçue en 2026 qui reproduirait le modèle de sécurité de 2010
> serait obsolète avant son premier silicium. La sécurité n'est pas une couche
> ajoutée : c'est une contrainte de microarchitecture.

---

## 7.1 Modèle de menace

| Adversaire | Capacité | Réponse d'Aurora |
|---|---|---|
| Code non privilégié malveillant | exécution locale | isolation MMU, CHERI, MTE |
| Attaquant distant sur un service | corruption mémoire | CHERI, MTE, protection de flot de contrôle |
| Co-locataire dans le cloud | canaux auxiliaires, Spectre | partitionnement, pas de SMT par défaut |
| Hyperviseur compromis | lecture de la mémoire invitée | enclaves chiffrées, attestation |
| Attaquant à accès physique | sonde du bus mémoire, cold boot | chiffrement mémoire avec intégrité |
| Chaîne d'approvisionnement | firmware altéré | racine de confiance en ROM, démarrage mesuré |

Ce qui est **hors périmètre** et doit être dit : les attaques par canal
auxiliaire physique avancées (injection de fautes par laser, analyse de
consommation avec accès prolongé au silicium décapsulé) ne sont pas
entièrement couvertes. Le sous-système sécurisé est durci contre ces attaques ;
le processeur principal ne l'est pas, et prétendre le contraire serait
malhonnête.

---

## 7.2 Sécurité mémoire : trois niveaux, au choix du développeur

Environ 70 % des vulnérabilités critiques dans les grandes bases de code C et
C++ sont des erreurs de sécurité mémoire. Aucune protection unique ne convient
à tous les cas, donc Aurora en propose trois, combinables.

### Niveau 1 — MTE (étiquetage mémoire), coût quasi nul

Étiquette de 4 bits par granule de 16 octets, stockée dans les bits hauts du
pointeur et dans des métadonnées mémoire. À chaque accès, le matériel compare.

- Détecte : dépassements de tampon, usage après libération, double libération.
- Probabiliste : 1 chance sur 16 qu'une étiquette coïncide par hasard.
- Coût : ~2–4 % de performance, ~3 % de mémoire.
- **Activable en production**, ce qui est l'essentiel : un mécanisme réservé au
  débogage n'attrape rien.

### Niveau 2 — CHERI (`Xaurcap`), déterministe

Chaque pointeur devient une **capacité de 128 bits** : adresse, bornes,
permissions, et un bit de validité hors bande que seul le matériel peut poser.
Impossible de fabriquer une capacité par arithmétique.

- Détecte **déterministement** : tous les dépassements spatiaux, la plupart des
  erreurs temporelles (avec revocation), la confusion de types de pointeurs.
- Permet la **compartimentation** : des domaines de protection intra-processus,
  à commutation en quelques dizaines de cycles au lieu des milliers d'un
  changement de processus.
- Coût : pointeurs doublés, donc +15 à 30 % d'empreinte mémoire et la pression
  cache correspondante ; 3 à 10 % de performance selon la charge.

Sur Arm Morello, la mesure annoncée est l'élimination de **jusqu'à 70 % des
vulnérabilités de sécurité mémoire**.

**Décision d'Aurora : CHERI par processus, pas global.** Un bit dans la table
de pages active le mode capacité. On peut donc exécuter un navigateur ou un
parseur réseau en mode CHERI (là où la surface d'attaque est maximale) et le
reste du système en mode classique. C'est la seule voie réaliste vers
l'adoption : exiger la recompilation de tout l'espace utilisateur avant de
livrer quoi que ce soit condamne la fonctionnalité à ne jamais servir.

### Niveau 3 — Rust et langages sûrs

Rien à faire côté matériel, mais le support doit être excellent : LLVM de
qualité, atomiques efficaces, `std` complet dès le premier jour. C'est traité
au document 8, et c'est probablement le levier de sécurité mémoire le plus
puissant des trois.

---

## 7.3 Protection du flot de contrôle

| Mécanisme | Protège contre |
|---|---|
| Pile d'ombre (matérielle, `Zicfiss`) | ROP (retour vers une adresse détournée) |
| Points d'atterrissage (`Zicfilp`) | JOP/COP (saut indirect détourné) |
| Authentification de pointeurs | réutilisation de pointeurs de code |
| Pile de retour du prédicteur, isolée par contexte | contamination inter-domaines |

La pile d'ombre est matérielle : une région mémoire inaccessible en écriture
par le code normal, où chaque `call` empile l'adresse de retour et chaque `ret`
la vérifie. Coût mesuré sur les implémentations comparables : **< 1 %**. Il n'y
a aucune raison de ne pas l'activer partout, et Aurora l'active par défaut.

---

## 7.4 Exécution spéculative : la leçon de Spectre

Spectre et Meltdown ont montré qu'un canal auxiliaire microarchitectural est
un problème **d'architecture**, pas un bogue à corriger par microcode. Les
correctifs logiciels coûtent 5 à 30 % de performance.

Décisions structurelles d'Aurora :

| Mesure | Effet |
|---|---|
| **Pas de SMT** sur les cœurs P (défaut) | supprime la classe entière d'attaques par partage de cœur |
| Prédicteurs **indexés et étiquetés par contexte** (ASID + niveau de privilège + bit CHERI) | empêche l'empoisonnement inter-domaine |
| Rinçage des prédicteurs aux transitions de domaine sensibles | coût ~40 cycles, uniquement aux frontières concernées |
| **Partitionnement du cache par voies** entre domaines de sécurité | exclusion mutuelle configurable par l'hyperviseur |
| Chargements spéculatifs **non observables** : une ligne chargée spéculativement est marquée et n'est promue en cache qu'à la validation | supprime le canal cache pour la spéculation transitoire |
| Suivi de teinte léger sur les données issues de chargements spéculatifs | empêche leur usage comme adresse d'un second accès |
| Pas de repli sur les données spéculatives (`STT`) | |

Le mécanisme des **chargements spéculatifs non observables** est le plus
coûteux en surface (un tampon de 32 lignes par cœur, ~0,08 mm²) et le plus
efficace : il retire le canal d'exfiltration principal sans bloquer la
spéculation elle-même. On ne renonce pas à la performance ; on renonce à
laisser une trace observable.

**Position honnête :** aucun de ces mécanismes ne garantit l'absence de tout
canal auxiliaire. Les canaux par contention de port d'exécution, par exemple,
restent possibles entre threads d'un même cœur — raison supplémentaire de ne
pas activer le SMT par défaut. La sécurité spéculative est un domaine de
recherche vivant, et l'architecture prévoit des **contrôles firmware** pour
durcir davantage au prix de la performance si une nouvelle classe d'attaque
apparaît après le silicium.

---

## 7.5 Chiffrement de la mémoire

| Fonction | Implémentation |
|---|---|
| Chiffrement | AES-XTS 256 bits, en ligne dans le contrôleur mémoire |
| Intégrité | MAC 64 bits par ligne de 64 octets, arbre de Merkle pour les régions critiques |
| Anti-rejeu | compteurs versionnés, cachés dans le SLC |
| Clés | par machine virtuelle, jusqu'à 512 clés simultanées |
| Latence ajoutée | ~8 ns (chiffrement), ~14 ns (avec vérification d'intégrité) |
| Coût en puissance | ~1,8 W sur Aurora-S à pleine bande passante |

Le chiffrement seul protège contre la lecture physique. L'intégrité protège
contre la **modification** — attaque bien plus dangereuse dans un contexte
cloud. Aurora fournit les deux, l'intégrité étant activable par région pour ne
pas payer 14 ns sur toute la mémoire.

---

## 7.6 Enclaves et informatique confidentielle

Modèle de machine virtuelle confidentielle, dans l'esprit de ce qui existe chez
les fournisseurs actuels mais bâti sur l'extension hyperviseur RISC-V :

- Chaque VM confidentielle reçoit une clé de chiffrement mémoire distincte.
- L'hyperviseur **ordonnance** la VM mais ne peut ni lire sa mémoire, ni son
  état de registres (sauvegardé chiffré).
- **Attestation à distance** : le sous-système sécurisé signe une mesure de
  l'état initial de la VM avec une clé attestée par le fabricant.
- Le module TPM est virtualisé par VM.
- Les E/S passent par des tampons partagés explicitement déclarés non chiffrés.

Cas d'usage qui justifie l'investissement : **exécuter un modèle d'IA
propriétaire sur une infrastructure tierce**, ou traiter des données de santé
sans faire confiance à l'opérateur. C'est devenu une exigence d'achat, pas une
option.

---

## 7.7 Racine de confiance et démarrage

```
ROM immuable (clé publique du fabricant gravée)
   ↓ vérifie la signature
Firmware du sous-système sécurisé
   ↓ mesure et vérifie
Firmware de plateforme (équivalent UEFI/OpenSBI)
   ↓ mesure et vérifie
Chargeur d'amorçage
   ↓ mesure
Noyau
```

- Sous-système sécurisé : cœur Aurora-L dédié, ROM, SRAM privée, RNG matériel
  (source physique + conditionnement), moteurs crypto.
- **Démarrage mesuré** avec journal des mesures dans des registres de type PCR.
- Anti-rollback par fusibles monotones.
- **Propriété du dispositif transférable** : l'utilisateur peut inscrire sa
  propre clé racine et révoquer celle du fabricant. Un ordinateur qui n'obéit
  qu'à son constructeur n'appartient pas à son propriétaire — c'est une
  position d'architecture, assumée comme telle.
- Débogage verrouillé par défaut, déverrouillable par signature du propriétaire,
  avec effacement irréversible des secrets.

---

## 7.8 Cryptographie

| Primitive | Support |
|---|---|
| AES-128/256 (GCM, XTS, CTR) | instructions dédiées + moteur DMA |
| SHA-2, SHA-3 | instructions dédiées |
| ChaCha20-Poly1305 | accéléré via vectoriel |
| Courbes elliptiques (P-256, Curve25519) | accélération du corps fini |
| **ML-KEM (Kyber)** | `Xaurpq` : NTT, réduction de Montgomery, échantillonnage |
| **ML-DSA (Dilithium)** | `Xaurpq` |
| SLH-DSA (SPHINCS+) | accéléré via Keccak matériel |

Le post-quantique n'est pas de l'anticipation : les calendriers de migration
publiés par les agences nationales placent l'échéance dans les années qui
viennent, et le trafic capté aujourd'hui sera déchiffrable demain. Une puce
conçue en 2026 et produite jusqu'en 2035 doit l'avoir en dur.

---

## 7.9 Sécurité du GPU et des accélérateurs

Souvent le maillon faible, parce qu'historiquement conçu sans modèle de menace.

| Mesure | Détail |
|---|---|
| MMU GPU complète | même format de table de pages, mêmes permissions que le CPU |
| Isolation par contexte | chaque contexte GPU a son espace d'adressage ; aucun accès croisé |
| Effacement mémoire à la libération | matériel, pas logiciel — évite la fuite de framebuffer entre applications |
| Préemption avec sauvegarde chiffrée | l'état GPU d'une VM confidentielle reste confidentiel |
| Limitation de débit des files de commandes | empêche un déni de service par saturation |
| Validation des descripteurs | le matériel vérifie les bornes des descripteurs fournis par l'application |

L'effacement à la libération mérite un mot : la fuite de contenu de framebuffer
entre applications ou entre VM est une vulnérabilité récurrente et réelle sur
les GPU existants. La corriger coûte une machine d'état et de la bande passante
en arrière-plan. Il n'y a pas d'excuse à ne pas le faire.

---

## 7.10 Traitement des vulnérabilités après silicium

Un processeur vit dix ans. Des failles seront découvertes. L'architecture doit
prévoir **comment on les corrigera** :

1. **Microcode reconfigurable** pour les séquences complexes (chargé et signé au
   démarrage).
2. **Bits de désactivation de fonctionnalités** : chaque optimisation
   spéculative agressive peut être désactivée individuellement par firmware.
   Coût en performance, mais correction disponible en heures.
3. **Chase logic** : des points de patch matériels sur les chemins de contrôle
   critiques, permettant de modifier un comportement sans respin.
4. **Programme de divulgation** : délai de 90 jours, primes, coordination avec
   les mainteneurs de noyaux et d'hyperviseurs avant publication.
5. **Errata publics.** Toujours. Un errata caché est une faille offerte à qui la
   trouve seul.

---

**Suite :** [8. Pile logicielle](08-pile-logicielle.md)
