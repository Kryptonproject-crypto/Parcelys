# 0. État de l'art — septembre 2026

Avant de concevoir, il faut savoir contre quoi on se mesure. Ce document est la
base factuelle du dossier : tout ce qui suit s'y réfère. Chaque affirmation est
sourcée, et quand une donnée est une estimation ou une revendication
constructeur non vérifiée, c'est écrit.

---

## 0.1 Les jeux d'instructions

### x86-64

Deux fournisseurs (Intel, AMD), un jeu d'instructions accumulé depuis 1978.
Ses caractéristiques structurantes :

- **Longueur variable, 1 à 15 octets.** Décoder *n* instructions en parallèle
  exige de trouver les frontières avant de savoir ce qu'on décode. Le coût est
  quadratique en largeur, ce qui explique pourquoi les x86 modernes sont
  quasiment obligés d'avoir un cache d'µops (le décodage est trop cher pour
  être refait à chaque itération de boucle).
- **Modèle mémoire TSO.** Fort, donc simple pour le programmeur, mais coûteux :
  le matériel doit maintenir l'ordre des stores.
- **Registres de drapeaux implicites.** Chaque ALU écrit `EFLAGS`, ce qui crée
  des dépendances que le renommage doit défaire.
- **Instructions à micro-codage.** Une part non négligeable du jeu passe par le
  séquenceur de microcode, coûteux en latence.

L'extension x86-64 s'est enrichie d'AVX-512 puis d'AVX10, avec une
fragmentation des sous-ensembles qui complique la distribution logicielle.

### Arm (v9)

Longueur fixe 32 bits, décodage bon marché, modèle mémoire faible avec
instructions atomiques dédiées (LSE), extensions vectorielles à longueur
variable (SVE2) et matricielles (SME2). Écosystème mature : Apple, Qualcomm,
Nvidia (Grace), AWS (Graviton), Ampere. Le modèle économique reste une licence
avec redevances, et l'architecture est contrôlée par une seule entité.

Apple a démontré deux choses décisives pour ce dossier :

1. Qu'un cœur très large (8+ de largeur de décodage), à fréquence modérée, sur
   un procédé de pointe, bat en perf/W des cœurs plus rapides en horloge.
2. Que **la traduction binaire x86→Arm est acceptable pour l'utilisateur**
   quand le matériel aide (Rosetta 2, avec mode TSO commutable et support des
   drapeaux x86).

Microsoft a confirmé la seconde avec Prism, annoncé comme ~10–20 % plus rapide
que l'émulation précédente à matériel identique, dans la même classe que
Rosetta ([TechSpot](https://www.techspot.com/news/103082-prism-emulator-make-x86-applications-run-faster-arm.html)).

### RISC-V

ISA ouverte, modulaire, sans redevance. L'événement structurant est le profil
**RVA23**, ratifié le 21 octobre 2024
([RISC-V International](https://riscv.org/blog/risc-v-announces-ratification-of-the-rva23-profile-standard/)).
Il rend obligatoires le vectoriel (RVV 1.0) et l'hyperviseur, ce qui permet
enfin à un binaire unique de cibler tous les processeurs d'application
conformes — le préalable à tout écosystème.

L'effet se voit immédiatement : Canonical aligne ses images RISC-V sur RVA23,
au prix de la compatibilité avec environ 90 % des cartes existantes
([TechPowerUp](https://www.techpowerup.com/338734/risc-v-ecosystem-gets-more-standardization-as-ubuntu-drops-non-compliant-cpus)).
C'est douloureux à court terme et sain à long terme.

**Ce qui manque encore :** l'extension matricielle. Les groupes de travail
RISC-V se répartissent entre **IME** (matrice dans les registres entiers),
**VME** (dans les registres vectoriels) et **AME** (registres matriciels
dédiés). Aucun n'est ratifié à ce jour. Toute conception qui a besoin
d'accélération matricielle en 2026 doit donc définir sa propre extension, avec
un plan de convergence.

### Cœurs RISC-V haut de gamme existants

| Cœur | Performance annoncée | Statut |
|---|---|---|
| Tenstorrent TT-Ascalon | > 2,3 SPECint2017/GHz, > 3,6 SPECfp2017/GHz, > 2,5 GHz sur Samsung SF4X | IP disponible ([source](https://tenstorrent.com/en/newsroom/tenstorrent-announces-availability-of-tt-ascalon)) |
| Ventana Veyron V2 | jusqu'à 32 cœurs RVA23 à 3,85 GHz, 1,5 Mo L2/cœur, 128 Mo L3 | silicium attendu début 2026 |
| SiFive P870 | positionné face à Neoverse N2 | en production chez des clients |

**Lecture à retenir :** le RISC-V haut de gamme est arrivé au niveau
« Cortex-X d'il y a une génération ». L'écart avec Apple et AMD n'est pas un
écart d'ISA, c'est un écart d'investissement en microarchitecture et en
procédé. C'est précisément ce qu'un programme sérieux peut combler.

---

## 0.2 Procédés de fabrication

| Nœud | Gains annoncés | Disponibilité |
|---|---|---|
| TSMC N3E | référence | production |
| **TSMC N2** | +10–15 % perf à iso-puissance vs N3E, −25–30 % puissance à iso-perf, +15 % densité (mixte), jusqu'à +20 % en logique pure | en production volume ([TSMC](https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_2nm)) |
| TSMC N2P | variante optimisée de N2 | 2026 |
| **TSMC A16** | vs N2P : +8–10 % vitesse à iso-Vdd, −15–20 % puissance à iso-vitesse, densité ×1,10 | 2e semestre 2026 ([TSMC](https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_A16)) |

Deux ruptures technologiques comptent ici :

**GAA nanosheet.** Le transistor à grille enrobante remplace le FinFET. Le
canal est une pile de nanofeuilles entièrement entourée par la grille, ce qui
donne un bien meilleur contrôle électrostatique — donc moins de fuite à tension
égale, ou une tension plus basse à fuite égale. En pratique : le **Vmin**
descend, et c'est le levier le plus direct sur l'énergie, puisque la puissance
dynamique varie en V².

**Backside power delivery (BSPD).** L'alimentation passe par la face arrière du
wafer, les signaux par la face avant. Deux effets : le réseau d'alimentation
cesse de disputer les couches de routage aux signaux (donc densité et
fréquence gagnent), et la chute de tension IR s'effondre. Chez TSMC, c'est le
**Super Power Rail** d'A16, la première implémentation de production, orientée
HPC en priorité ([Semiconductor Engineering](https://semiengineering.com/tsmc-uncorks-a16-with-super-power-rail/)).

**Conséquence pour Aurora :** les chiplets logiques haute densité vont sur N2P,
et la version serveur, où le IR drop limite tout, passe sur A16 dès qu'il est
qualifié. Le die de base (SRAM + PHY + NoC) reste sur un nœud mature — la SRAM
ne rétrécit presque plus, et payer N2 pour du cache est un gaspillage.

---

## 0.3 Le mur énergétique : les chiffres qui décident de tout

Les ordres de grandeur, établis par Horowitz et confirmés depuis :

| Opération | Énergie |
|---|---|
| MAC FP32 | ~1–1,5 pJ |
| Accès SRAM 8 Ko | ~10 pJ (à 45 nm, 0,9 V) |
| Accès SRAM 1 Mo | ~100 pJ (idem) |
| Accès DRAM / HBM, 32 bits | ~200 pJ, jusqu'à ~640 pJ selon la technologie |

Rapport : **un accès DRAM ≈ 130 à 200 MAC**. Un accès SRAM ≈ 6 MAC.

Sur une inférence LLM locale typique, le déplacement de données représente
jusqu'à **90 % de l'énergie totale**. Aucune amélioration des unités de calcul
ne peut compenser cela — d'où la priorité absolue donnée dans Aurora à la
hiérarchie mémoire et aux mémoires locales explicites.

Corollaire souvent oublié : la **réutilisation** est la seule variable qui
compte. Une donnée sortie de DRAM doit servir des dizaines de fois avant d'être
réécrite. Toute l'architecture matricielle et la gestion des tuiles découlent
de cette contrainte.

---

## 0.4 Mémoires

### HBM4

Standard JESD270-4 finalisé par JEDEC : interface **2048 bits**, 8 Gb/s par
broche, soit jusqu'à **2 To/s par pile**, et jusqu'à 64 Go par pile. Tensions
VDDQ à 0,7 / 0,75 / 0,8 / 0,9 V et VDDC à 1,0 / 1,05 V selon le fournisseur,
ce qui améliore l'efficacité énergétique
([JEDEC](https://www.jedec.org/news/pressreleases/jedec%C2%AE-and-industry-leaders-collaborate-release-jesd270-4-hbm4-standard-advancing)).

### LPDDR6

JESD209-6, publié le 9 juillet 2025 : débits de 10 667 à 14 400 MT/s, soit
environ 28,5 à 38,4 Go/s par composant. C'est la mémoire des configurations
mobiles et desktop d'Aurora.

### SRAM empilée et hybrid bonding

C'est la technologie la plus importante du dossier après le procédé lui-même.

Le 3D V-Cache d'AMD, en 2e génération, empile de la SRAM sur le die logique à
un pas de connexion de **9 µm**, et atteint **2,5 To/s** entre le cache et les
cœurs. Face aux micro-bumps classiques, AMD annonce **moins d'un tiers de
l'énergie par bit**, **15× la densité d'interconnexion**, et de meilleures
caractéristiques de signalisation et d'alimentation
([Tom's Hardware](https://www.tomshardware.com/news/amd-shares-new-second-gen-3d-v-cache-chiplet-details-up-to-25-tbs)).

En 2026, le hybrid bonding est en production de masse sous 20 µm de pas ; la
recherche vise 2–5 µm, avec une production volume sous 5 µm attendue entre 2028
et 2030 ([Inside DeepTech](https://www.insidedeeptech.com/hybrid-bonding-soic-foveros-direct-full-guide/)).

**Conséquence pour Aurora :** l'empilement vertical par hybrid bonding devient
le chemin de données privilégié, et les liaisons latérales style UCIe sont
réservées à ce qui ne peut pas être empilé. Un ordre de grandeur sépare les
deux en énergie par bit.

---

## 0.5 Interconnexion de chiplets

**UCIe 3.0**, publié le 5 août 2025, double le débit maximal de 32 à
**64 GT/s** (avec un palier à 48 GT/s), pour les deux variantes de packaging
(standard et avancé). Il ajoute la recalibration TX en fonctionnement, un état
de repos L2 optimisé, et étend la portée du sideband à 100 mm, ce qui autorise
des topologies plus complexes
([UCIe Consortium](https://www.uciexpress.org/post/ucie-3-0-specification-redefining-chiplet-interconnects)).

Ordre de grandeur énergétique utile pour dimensionner : une liaison latérale
sérialisée coûte typiquement quelques dixièmes de pJ/bit, une liaison verticale
par hybrid bonding environ un ordre de grandeur moins. Le chiffre exact dépend
du PHY et du pas ; le dossier utilise 0,25 pJ/bit pour UCIe avancé et
0,05 pJ/bit pour le hybrid bonding, avec la sensibilité correspondante calculée
dans le modèle.

---

## 0.6 GPU

L'année 2026 voit converger trois mouvements :

- **Nvidia Rubin** : présenté au GTC 2026 avec 336 milliards de transistors,
  288 Go de HBM4 et ~50 PFLOPS sur la déclinaison datacenter. La génération
  grand public passe en 3 nm.
- **AMD UDNA (RDNA 5)** : réunification des lignées gaming et calcul en une
  architecture unique, attendue fin 2026.
- **Apple M5** : un **accélérateur neuronal dans chaque cœur GPU**, et plus de
  4× la puissance de calcul GPU en IA face à la génération M4. Le M5 de base
  monte à 153 Go/s de bande passante. En août 2026, Apple annonce M6 et
  M5 Ultra ([Apple Newsroom](https://www.apple.com/newsroom/2026/08/apple-introduces-m6-and-m5-ultra-for-a-big-leap-in-performance-and-ai-compute/)).

La leçon d'Apple est la plus instructive : **mettre la matrice dans le GPU**
plutôt que dans un NPU séparé. Un NPU distinct duplique la bande passante,
reste inutilisé la plupart du temps, et impose au logiciel de choisir une cible.
Aurora suit cette voie, avec une nuance argumentée au document 3.

Côté rendu, le **TBDR** (tile-based deferred rendering, popularisé par PowerVR
et généralisé sur mobile) reste la technique la plus économe : en travaillant
par tuiles dont la couleur et la profondeur tiennent en SRAM, on supprime
l'essentiel du trafic vers la mémoire externe — c'est-à-dire, justement, le
poste à 200 pJ/accès.

---

## 0.7 Accélération IA : où en est l'efficacité

Les NPU mobiles haut de gamme se situent autour de **50 TOPS INT8**. Côté
recherche, un NPU intégré de l'état de l'art publie **657 GOPS/W en MXINT8** et
**4 065 GOPS/W en MXFP4** — soit environ 4 TOPS/W. L'écart d'un facteur 6 entre
les deux formats montre que **le format numérique est devenu un levier
architectural de premier ordre**, au même titre que la microarchitecture.

Aurora en tire une conséquence directe : support natif des formats
*microscaling* (MXFP8, MXFP6, MXFP4, MXINT8) dans les unités matricielles, avec
le facteur d'échelle par bloc géré en matériel.

---

## 0.8 Sécurité mémoire

**CHERI** (Cambridge / SRI) transforme chaque pointeur en *capacité* portant ses
bornes et ses permissions, vérifiées par le matériel. Sur le prototype Arm
Morello, la mesure annoncée est l'élimination de **jusqu'à 70 % des
vulnérabilités de sécurité mémoire**
([Cambridge](https://www.cl.cam.ac.uk/research/security/ctsrd/cheri/)).

L'écosystème CHERI-RISC-V est actif (Microsoft, Google, lowRISC, Codasip, SCI
Semiconductor), avec un toolchain LLVM et des portages FreeBSD et Linux.

Le coût est réel : pointeurs à 128 bits, donc empreinte mémoire et pression
cache accrues. D'où le choix d'Aurora : **CHERI par processus, pas global**
(document 7).

---

## 0.9 Écosystème logiciel RISC-V : l'état honnête

C'est le point où il faut être le plus lucide, parce que c'est le principal
risque du programme.

**Ce qui marche :**
- Debian, Fedora, openSUSE, Alpine publient des images RISC-V 64 officielles.
- Android 16 tourne sur silicium RVA23 (portage DAMO Academy / XuanTie,
  [The Register](https://www.theregister.com/systems/2026/05/27/alibaba_gets_android_16_running_on_risc_v/5246710)).
- LLVM et GCC supportent RVA23, vectoriel inclus.

**Ce qui ne marche pas encore bien :**
- Ubuntu reste en niveau « preview » pour RISC-V : ça fonctionne, sans la même
  couverture de tests que x86-64 et arm64.
- **Les pilotes graphiques sont le maillon faible.** Le TH1520 est devenu le
  premier SoC RISC-V avec accélération 3D pleinement mainline (fusionné dans
  Linux 6.18) — c'est-à-dire tout récemment. Beaucoup d'environnements de
  bureau tournent encore en rendu logiciel.
- Vortex 3.0 (Georgia Tech, juin 2026) apporte un GPU RISC-V open source avec
  pipeline 3D complet et pilote Vulkan, mais c'est de la recherche.

**Conclusion pour le programme :** le silicium n'est pas le chemin critique.
Le pilote graphique et la chaîne de traduction binaire le sont. Le document 8
alloue les ressources en conséquence — environ **55 % de l'effectif du
programme côté logiciel**, ce qui surprendra ceux qui pensent qu'on fait un
processeur avec des architectes matériels.

---

## 0.10 Coûts

Le chiffre le plus cité pour un design 2 nm complet est de l'ordre de
**725 M$** de NRE, EDA, IP, masques, ingénierie, vérification et validation
inclus. Les jeux de masques seuls se situent autour de 10–20 M$ à 3 nm, et
davantage à 2 nm. L'essentiel du coût n'est ni le masque ni le wafer : c'est le
**logiciel et la vérification**.

Ces valeurs sont des estimations d'analystes, pas des tarifs publics ; elles
servent à dimensionner un budget, pas à le contractualiser. Le document 10 les
reprend avec une marge explicite.

---

## Sources

- [RISC-V — ratification du profil RVA23](https://riscv.org/blog/risc-v-announces-ratification-of-the-rva23-profile-standard/)
- [RVA23 Profiles v1.0](https://docs.riscv.org/reference/rva23/v1.0/rva23-profiles.html)
- [Canonical — pourquoi RVA23 est significatif](https://canonical.com/blog/risc-v-profiles-why-is-rva23-significant)
- [TechPowerUp — Ubuntu abandonne les CPU non conformes](https://www.techpowerup.com/338734/risc-v-ecosystem-gets-more-standardization-as-ubuntu-drops-non-compliant-cpus)
- [TSMC N2](https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_2nm) · [TSMC A16](https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_A16) · [Semiconductor Engineering — A16 Super Power Rail](https://semiengineering.com/tsmc-uncorks-a16-with-super-power-rail/)
- [Horowitz — Computing's Energy Problem](https://gwern.net/doc/cs/hardware/2014-horowitz-2.pdf)
- [JEDEC — HBM4 JESD270-4](https://www.jedec.org/news/pressreleases/jedec%C2%AE-and-industry-leaders-collaborate-release-jesd270-4-hbm4-standard-advancing) · [Tom's Hardware — HBM4 finalisé](https://www.tomshardware.com/pc-components/ram/jedec-finalizes-hbm4-memory-standard-with-major-bandwidth-and-efficiency-upgrades)
- [UCIe 3.0](https://www.uciexpress.org/post/ucie-3-0-specification-redefining-chiplet-interconnects) · [Synopsys — UCIe 3.0](https://www.synopsys.com/blogs/chip-design/ucie-3-0-chiplet-ip-solutions.html)
- [Tom's Hardware — 3D V-Cache 2e génération](https://www.tomshardware.com/news/amd-shares-new-second-gen-3d-v-cache-chiplet-details-up-to-25-tbs) · [Inside DeepTech — hybrid bonding, SoIC, Foveros Direct](https://www.insidedeeptech.com/hybrid-bonding-soic-foveros-direct-full-guide/)
- [Apple — M6 et M5 Ultra](https://www.apple.com/newsroom/2026/08/apple-introduces-m6-and-m5-ultra-for-a-big-leap-in-performance-and-ai-compute/) · [Tom's Hardware — M5](https://www.tomshardware.com/pc-components/cpus/apple-unveils-m5-chip-with-10-core-cpu-and-10-core-gpu-company-says-3nm-chip-offers-4x-peak-gpu-performance-over-m4-for-ai-45-percent-graphics-uplift)
- [Tenstorrent TT-Ascalon](https://tenstorrent.com/en/newsroom/tenstorrent-announces-availability-of-tt-ascalon)
- [CHERI — Cambridge](https://www.cl.cam.ac.uk/research/security/ctsrd/cheri/)
- [The Register — Android 16 sur RISC-V](https://www.theregister.com/systems/2026/05/27/alibaba_gets_android_16_running_on_risc_v/5246710) · [Vortex 3.0](https://www.techtimes.com/articles/318156/20260610/open-source-risc-v-gpu-vortex-30-adds-full-3d-pipeline-vulkan-asic-flows.htm)
- [Émulation x86-64 sur RISC-V, EuroSys 2026](https://dl.acm.org/doi/10.1145/3767295.3803574)
- [SemiAnalysis — coûts fixes de conception](https://newsletter.semianalysis.com/p/the-dark-side-of-the-semiconductor)
