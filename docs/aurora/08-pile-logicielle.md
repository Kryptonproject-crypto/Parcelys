# 8. Pile logicielle

> Le cimetière des architectures informatiques est rempli de silicium
> excellent : Alpha, Itanium, Cell, SPARC, Transmeta. Aucun n'est mort d'un
> défaut de conception matérielle. Tous sont morts d'un écosystème logiciel
> insuffisant. **Ce document est le plus important du dossier pour la survie du
> projet.**

---

## 8.1 Principe : le logiciel précède le silicium

Règle du programme, non négociable :

> **Aucune fonctionnalité matérielle n'est validée pour le tape-out tant que le
> support logiciel n'est pas fusionné en amont et testé sur simulateur ou FPGA.**

Conséquence immédiate sur l'organisation : le recrutement logiciel commence
**avant** le recrutement RTL, et l'équipe logicielle est majoritaire dès la
deuxième année. Ce n'est pas une préférence, c'est ce que l'histoire du secteur
enseigne.

Répartition cible de l'effectif à plein régime :

| Domaine | Effectif | Part |
|---|---|---|
| Logiciel (compilateurs, OS, pilotes, IA, traduction) | ~470 | 55 % |
| RTL et microarchitecture | ~200 | 23 % |
| Physical design, DFT, packaging | ~110 | 13 % |
| Vérification (partagée matériel) | comptée ci-dessus | |
| Systèmes, applications, support | ~75 | 9 % |

---

## 8.2 Compilateurs

### LLVM en premier

| Composant | Travail |
|---|---|
| Backend RISC-V | existe, mature ; ajouter la modélisation d'Aurora |
| Modèle de coût par cœur | trois modèles (P, E, L) pour l'ordonnancement d'instructions |
| Intrinsèques `Xaurmt` | via une couche d'abstraction stable (§1.3) |
| Vectorisation automatique | RVV existe ; améliorer la vectorisation des boucles à longueur variable |
| Génération de descripteurs `Xaurdma` | **nouveau** : analyse polyédrique des nids de boucles |
| Fusion contractuelle | l'ordonnanceur préfère les séquences fusibles (§1.7) |
| Threads découplés `Xaurdt` | élagage automatique de la boucle d'accès |
| Optimisation guidée par le profil | intégration avec les compteurs `Xaurpm` |

Le point le plus original est la **génération de descripteurs de flux**. LLVM
dispose déjà de l'infrastructure d'analyse polyédrique (Polly, et l'analyse
d'accès dans le vectoriseur). Il s'agit de la brancher sur une nouvelle cible
de génération de code. Estimation : 6 personnes-années, dont la moitié en
amont du projet plutôt que dans un fork.

### GCC ensuite

GCC compte pour la distribution Linux traditionnelle (Debian, Fedora
construisent avec GCC). Le support arrive en année 2, après LLVM, avec une
équipe plus réduite.

### Politique d'amont

**Tout est contribué en amont, en continu, jamais en une seule grosse
contribution.** Un fork maintenu en interne devient impossible à rebaser au
bout de dix-huit mois. C'est l'erreur la plus répandue et la plus coûteuse.

---

## 8.3 Système d'exploitation

### Linux, cible principale

| Sous-système | Travail |
|---|---|
| Support d'architecture | RVA23 existe en amont ; ajouter les extensions Aurora |
| Ordonnanceur hétérogène | intégration de `Xaurpm` dans EAS/sched_ext |
| Gestion d'énergie | pilote cpufreq, interface du gouverneur, états de repos |
| Sauvegarde d'état matriciel | gestion paresseuse (bit `MS`), comme le FPU |
| Mémoire unifiée | HMM, migration de pages, fautes de page GPU |
| IOMMU | pilote, ATS/PRI |
| CHERI | activation par processus, chargeur ELF adapté |
| Sécurité | MTE, pile d'ombre, CFI |
| Virtualisation | KVM sur l'extension H, VM confidentielles |

`sched_ext` (ordonnanceurs BPF) est une opportunité réelle : il permet
d'expérimenter les politiques de placement hétérogène **sans patcher le
noyau**, donc d'itérer en jours plutôt qu'en cycles de publication. La politique
de référence d'Aurora est livrée comme un ordonnanceur BPF, puis proposée en
amont une fois éprouvée.

### Autres systèmes

| Système | Plan |
|---|---|
| Android | AOSP RISC-V progresse (Android 16 tourne sur silicium RVA23) ; portage + HAL graphique |
| FreeBSD | support RISC-V existant ; c'est aussi la plateforme de référence CHERI |
| Zephyr / RTOS | pour les cœurs L et l'embarqué |
| Windows | **pas de portage prévu.** Dépendance à un tiers qu'on ne contrôle pas. La stratégie est Linux + traduction (§8.4) |

---

## 8.4 Aurora Bridge — la traduction binaire

C'est le pont vers l'existant, et donc vers l'adoption.

### Architecture

```
Binaire x86-64 ou Arm64
        ↓
 Chargeur (détection de format, cartographie mémoire)
        ↓
 ┌─────────────────────────────────────────────┐
 │  Traduction anticipée (AOT) à l'installation│ ← cas principal
 │  ou traduction à la volée (JIT) au 1er lancement
 └─────────────────────────────────────────────┘
        ↓
 Cache de code traduit (persistant, signé)
        ↓
 Exécution native avec aides Xaurx86 (§1.6)
```

**AOT à l'installation, comme Rosetta 2.** Le coût de traduction est payé une
fois, pas à chaque lancement. Un JIT prend le relais pour le code généré
dynamiquement (JavaScript, JVM, .NET), avec profilage et réoptimisation à chaud
des zones chaudes.

### Les quatre aides matérielles, rappel

| Aide | Points de surcoût supprimés |
|---|---|
| Mode TSO par thread | ~14 |
| Instructions de calcul de drapeaux | ~7 |
| Adressage complexe fusionné | ~4 |
| Modes flottants x87/SSE | ~2 |
| **Total** | **~27 points, de ~41 % à ~14 %** |

Objectif global : **< 25 % de surcoût** contre ~40 % pour l'état de l'art
purement logiciel (EuroSys 2026). Combiné à un avantage de performance native,
l'expérience utilisateur est celle d'un système au moins équivalent.

### Vérification

Le traducteur est un composant critique : un bogue de traduction est un bogue
silencieux de calcul. Plan :

- **Tests différentiels** massifs : exécution du même binaire sur x86 réel et
  sur traduction, comparaison d'état à chaque appel système. Des millions de
  programmes générés aléatoirement plus l'ensemble des suites de tests des
  distributions.
- **Vérification formelle** de la sémantique instruction par instruction pour le
  cœur du jeu x86-64 (approche éprouvée par les travaux de spécification
  formelle de x86).
- Fuzzing continu, en intégration continue, pour toute la durée de vie.

---

## 8.5 Pile IA

| Couche | Choix |
|---|---|
| Frontend | PyTorch (prioritaire), JAX, ONNX Runtime |
| Compilation | **IREE / MLIR** comme chemin principal |
| Noyaux | bibliothèque Aurora-BLAS + génération par Triton |
| Distribution | NCCL-équivalent ouvert sur UCIe/réseau |
| Inférence | llama.cpp, vLLM, portages prioritaires |
| Quantification | MXFP8/6/4, INT8, sparsité 2:4, support natif |

**Pourquoi MLIR/IREE plutôt qu'un compilateur propriétaire :** parce que le
dialecte matriciel d'Aurora devient une cible parmi d'autres dans une
infrastructure partagée, au lieu d'être une île à maintenir seul. Le coût
marginal d'ajout d'une cible dans MLIR est bien inférieur à celui d'un
compilateur complet, et l'écosystème progresse indépendamment de nous.

**Le modèle de coût est central.** Le compilateur doit choisir entre trois
emplacements d'unité matricielle (CPU, GPU, near-memory, §3.4) pour chaque
opération. Le modèle évalue :

```
coût(op, emplacement) = temps_calcul + temps_transfert + λ · énergie
```

avec λ réglable : λ = 0 pour maximiser la vitesse, λ élevé sur batterie. **Un
compilateur qui sait optimiser pour l'énergie est aussi rare qu'utile** — et
c'est cohérent avec la thèse du dossier.

---

## 8.6 Graphisme : le risque numéro un

L'état de l'art RISC-V est sans ambiguïté (§0.9) : l'accélération 3D mainline
est très récente, et beaucoup d'environnements tournent encore en rendu
logiciel. Un GPU sans pilote est un radiateur.

### Plan

| Étape | Échéance | Contenu |
|---|---|---|
| Modèle fonctionnel du GPU | M6 | simulateur exécutant des commandes Vulkan |
| Backend NIR + pilote Gallium | M12 | dans Mesa, en amont, publiquement |
| Conformité Vulkan 1.4 sur simulateur | M20 | suite Khronos complète |
| Pilote sur FPGA | M26 | rendu réel, lent mais correct |
| Conformité sur silicium | M42 | certification Khronos |
| Zink (OpenGL sur Vulkan) | M24 | pas de pilote OpenGL natif |
| DXVK / vkd3d-proton | M30 | jeux Windows |
| Optimisation continue | permanent | c'est là que se joue la perf réelle |

### Ce qui fait échouer les pilotes graphiques

Trois causes récurrentes, et les parades :

1. **Développement en interne, publication tardive.** Parade : tout dans Mesa
   dès le premier jour, revue publique.
2. **Sous-effectif.** Parade : 40 personnes sur quatre ans, soit plus que
   l'équipe RTL du GPU.
3. **Conformité traitée comme une case à cocher en fin de projet.** Parade :
   la suite de conformité tourne en intégration continue sur simulateur dès
   M14, et un échec bloque la fusion RTL.

---

## 8.7 Bibliothèques et langages

| Composant | Priorité | Notes |
|---|---|---|
| glibc, musl | P0 | support RVA23 existant, ajouter les `ifunc` Aurora |
| OpenSSL, BoringSSL | P0 | chemins accélérés, y compris post-quantique |
| **Rust** | P0 | cible native, `std` complet ; c'est le principal levier de sécurité mémoire |
| Go | P0 | runtime et GC à adapter |
| JVM (OpenJDK) | P0 | backend JIT C2 pour Aurora |
| V8, SpiderMonkey | P0 | backends JIT |
| Python, CPython | P1 | fonctionne, optimiser les chemins chauds |
| .NET | P1 | backend RyuJIT |
| FFmpeg, libvpx | P1 | chemins vectoriels |
| BLAS/LAPACK | P0 | Aurora-BLAS, noyaux matriciels |
| OpenMP, TBB | P1 | conscience de l'hétérogénéité |

**Les JIT sont un poste sous-estimé.** V8, la JVM et .NET génèrent du code
machine à l'exécution ; sans backend de qualité, tout le web et toute
l'informatique d'entreprise sont lents. Trois backends JIT, c'est environ 25
personnes-années. Il faut le budgéter explicitement, sinon on le découvre à
M30.

---

## 8.8 Distribution et intégration continue

- **Debian et Fedora comme distributions de référence.** Objectif : une image
  Aurora officielle au jour du lancement, avec au moins 95 % des paquets
  construits.
- **Ferme de construction** : 200 nœuds Aurora dédiés aux compilations de
  distributions, mis à disposition des projets amont gratuitement. C'est ce qui
  a fait réussir les architectures précédentes : donner du matériel aux
  mainteneurs. Budget : ~4 M$, le meilleur rapport coût/adoption du programme.
- **Intégration continue** : chaque commit RTL est testé contre la suite
  logicielle sur émulateur. Chaque commit logiciel est testé sur le simulateur
  fonctionnel.

---

## 8.9 Séquence d'amorçage de l'écosystème

| Phase | Cible | Pourquoi ce marché d'abord |
|---|---|---|
| **1. Serveur Linux** (lancement) | cloud, HPC, IA | la charge de travail est compilée depuis les sources, l'écosystème propriétaire est marginal, les acheteurs mesurent le coût total et savent lire une courbe de perf/W |
| **2. Station de travail développeur** (+9 mois) | ingénierie logicielle | ceux qui portent le logiciel ont besoin de machines ; c'est aussi le meilleur outil de promotion |
| **3. Portable Linux** (+18 mois) | professionnel, éducation | l'autonomie est l'argument, et l'écosystème est prêt à ce stade |
| **4. Grand public** (+30 mois) | — | seulement quand la traduction et le graphisme sont irréprochables |

**Ne jamais commencer par le grand public.** Un utilisateur grand public ne
pardonne pas un jeu qui ne se lance pas. Un administrateur de centre de données
pardonne beaucoup si la facture d'électricité baisse de 30 %.

---

## 8.10 Risques logiciels et parades

| Risque | Probabilité | Impact | Parade |
|---|---|---|---|
| Pilote graphique en retard | **élevée** | critique | sur-effectif dès M0, conformité en CI, repli sur rendu logiciel accéléré vectoriellement pour le bureau |
| Traduction binaire décevante | moyenne | élevé | prototype dès M12 sur simulateur ; si le surcoût dépasse 35 % à M24, renforcer les aides matérielles avant gel du RTL |
| Écosystème RISC-V fragmenté | moyenne | élevé | conformité RVA23 stricte, participation active aux groupes de travail, refus de toute divergence gratuite |
| Extensions matricielles divergentes du futur standard | **élevée** | moyen | couche d'abstraction LLVM (§1.3), engagement de support du standard ratifié |
| Pas assez de mainteneurs amont intéressés | moyenne | élevé | donner du matériel tôt et gratuitement ; financer des mainteneurs indépendants |
| Backends JIT sous-estimés | moyenne | élevé | budget explicite, recrutement spécialisé dès l'année 1 |

La première ligne est le risque numéro un du programme entier — devant le
rendement de fabrication, devant le budget, devant la concurrence.

---

**Suite :** [9. Vérification et implémentation](09-verification-implementation.md)
