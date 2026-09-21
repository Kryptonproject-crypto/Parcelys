# Aurora — architecture CPU + GPU unifiée

**Dossier de conception, de l'ISA au silicium.**
Version 1.0 — septembre 2026.

---

## Ce que c'est, et ce que ce n'est pas

Ce dossier est une **architecture complète et cohérente**, chiffrée, appuyée sur
l'état de l'art réellement disponible en 2026 (procédés, mémoires, standards
d'interconnexion, écosystème logiciel). Chaque bloc est spécifié au niveau où un
ingénieur peut commencer à écrire du RTL ou dimensionner une équipe.

Ce n'est **pas** un produit validé. Aucun chiffre de performance n'est mesuré :
ce sont des **objectifs de conception** (*design targets*) dérivés d'un modèle
analytique dont les hypothèses sont écrites, versionnées et exécutables
(`modele/aurora_model.py`). Un objectif ne devient un résultat qu'après
simulation cycle-accurate, puis après silicium. La distinction est maintenue
partout dans ce dossier : quand on lit « 2,9 SPECint2017/GHz », il faut lire
« cible de 2,9, avec une incertitude de ±25 % avant RTL ».

---

## La thèse en une page

L'industrie a longtemps optimisé le **calcul**. Or, en 2026, le calcul n'est
plus ce qui coûte. Les chiffres de référence, stables depuis les travaux de
Horowitz et confirmés depuis :

| Opération | Énergie approximative |
|---|---|
| MAC FP32 (logique) | ~1 pJ |
| Lecture SRAM locale (quelques Ko) | ~5 pJ |
| Lecture cache de dernier niveau (Mo) | ~50–100 pJ |
| Lecture DRAM / HBM (32 bits) | ~200 pJ, parfois davantage |

**Déplacer une donnée coûte 100 à 200 fois plus cher que la calculer.** Sur une
inférence LLM locale, le déplacement représente jusqu'à 90 % de l'énergie
consommée.

À ce premier coût s'en ajoute un second, moins visible : le coût de la
**découverte**. Un cœur x86 moderne dépense une fraction considérable de son
énergie à *comprendre* ce qu'il doit faire — décoder des instructions de
longueur variable, spéculer, renommer, réveiller des files d'attente,
re-découvrir à chaque itération un motif d'accès mémoire que le compilateur
connaissait déjà.

Aurora attaque les deux :

1. **Un front-end bon marché.** ISA à longueur fixe, décodage trivial, fusion de
   macro-instructions *contractuelle* (garantie par l'ISA, pas devinée), fetch
   découplé profond. Pas de cache d'µops : à décodage simple, il ne rembourse
   pas sa surface ni sa fuite.
2. **La donnée près du calcul.** SRAM système empilée en 3D par *hybrid
   bonding*, mémoire réellement unifiée CPU/GPU (zéro copie), mémoires de tuile
   explicites, et des moteurs de flux (`Xaurdma`) qui remplacent les chaînes de
   chargements spéculatifs par une description du motif d'accès.
3. **La spécialisation là où elle paie.** Unités matricielles intégrées au CPU
   *et* au GPU, unité de réduction près des contrôleurs mémoire, crypto et
   post-quantique en dur. Sortir du régime « une opération = une instruction
   dynamique » est le seul moyen connu de gagner un ordre de grandeur.

Le reste du dossier est l'application méthodique de ces trois principes.

---

## Positionnement

| | x86-64 | Arm (v9) | **Aurora** |
|---|---|---|---|
| ISA | longueur variable 1–15 o | longueur fixe 32 b | longueur fixe 32 b (RVA23) |
| Licence | 2 fournisseurs | redevance + royalties | ouverte (RISC-V), extensions propres |
| Coût du décodage | élevé (µop cache quasi obligatoire) | faible | faible, fusion contractuelle |
| Modèle mémoire | TSO | faible + LSE | faible, **TSO commutable par thread** |
| Compatibilité binaire | native | traduction (Rosetta, Prism) | traduction + aides matérielles dédiées |
| Mémoire CPU/GPU | copies via PCIe (hors APU) | partagée selon SoC | **unifiée, cohérente, zéro copie** |
| Sécurité mémoire | MTE partiel | MTE, PAC, BTI | **CHERI optionnel + MTE + chiffrement** |

Le pari n'est pas « faire un x86 en mieux ». C'est de constater que **la
compatibilité binaire n'est plus un fossé infranchissable** : Rosetta 2 et Prism
l'ont prouvé côté Arm, et la recherche publiée en 2026 montre une émulation
x86-64 sur RISC-V avec moins de 40 % de surcoût moyen, soit 3,3× mieux que
QEMU-TCG. Avec quatre aides matérielles ciblées (détaillées en
[§1.6](01-isa-aurora.md)), ce surcoût descend dans la zone où l'écart de
performance native le compense.

---

## Les trois produits de la famille

Une seule architecture, trois assemblages de chiplets :

| | **Aurora-M** (mobile) | **Aurora-D** (desktop/station) | **Aurora-S** (serveur/IA) |
|---|---|---|---|
| Cœurs P / E / L | 4 / 8 / 2 | 12 / 16 / 2 | 64 / 32 / 4 |
| GPU (slices) | 2 | 8 | 16 (calcul) |
| Cache système (SLC) | 32 Mo | 64 Mo | 256 Mo + 1 Go L4 |
| Mémoire | LPDDR6, ~230 Go/s | LPDDR6, ~460 Go/s | HBM4, 4 piles, ~8 To/s |
| Enveloppe (TDP) | 8–18 W | 65–120 W | 350–500 W |
| Procédé | N2P | N2P | A16 (Super Power Rail) |

---

## Sommaire du dossier

| # | Document | Contenu |
|---|---|---|
| 0 | [État de l'art 2026](00-etat-de-lart-2026.md) | Ce qui existe vraiment, sourcé : procédés, ISA, GPU, mémoires, packaging, écosystème |
| 1 | [ISA Aurora-V](01-isa-aurora.md) | Base RVA23, extensions `Xaur*`, encodage, ABI, fusion contractuelle, compatibilité x86/Arm |
| 2 | [Microarchitecture CPU](02-cpu-microarchitecture.md) | Cœurs P / E / L, pipeline étage par étage, prédiction, OoO, LSU, budgets de surface |
| 3 | [Microarchitecture GPU](03-gpu-microarchitecture.md) | Slice, SIMT scalarisé, TBDR hybride, ray tracing, unités matricielles |
| 4 | [Hiérarchie mémoire](04-hierarchie-memoire.md) | L1→L4, SLC 3D, cohérence, mémoire unifiée, LPDDR6/HBM4, compression, near-memory |
| 5 | [Interconnexion et chiplets](05-interconnect-chiplets.md) | NoC maillé, die de base actif, hybrid bonding, UCIe 3.0, floorplan, thermique |
| 6 | [Gestion de l'énergie](06-gestion-energie.md) | DVFS par cœur, IVR, power gating, gouverneur prédictif, budget de puissance détaillé |
| 7 | [Sécurité](07-securite.md) | CHERI, MTE, chiffrement mémoire, racine de confiance, mitigations spéculatives |
| 8 | [Pile logicielle](08-pile-logicielle.md) | LLVM, Linux, Mesa, Aurora Bridge (traduction), pile IA, plan d'amorçage |
| 9 | [Vérification et implémentation](09-verification-implementation.md) | Flot RTL, vérification formelle, émulation, DFT, physical design, bring-up |
| 10 | [Feuille de route et budget](10-feuille-de-route-budget.md) | 5 ans, jalons, équipes, coûts, risques, stratégie de mise sur le marché |
| 11 | [Modèle de performance](11-modele-performance.md) | Méthode d'estimation, hypothèses, résultats chiffrés, limites, falsifiabilité |
| 12 | [**Plans de construction**](12-plans-de-construction.md) | Plans de masse cotés, pile 3D, budget de connexion, PDN, horloge, thermique, package, assemblage, nomenclature et coût unitaire |

### Les schémas

Neuf plans en SVG, versionnés dans [`schemas/`](schemas/), lisibles dans le
navigateur comme dans un diff :

| Schéma | Ce qu'il démontre |
|---|---|
| [Coupe du package](schemas/01-coupe-package.svg) | pourquoi le chemin de données est vertical, et où passe l'alimentation |
| [Plan de masse CCD-P](schemas/02-floorplan-ccd-p.svg) | où va la surface, et pourquoi les unités matricielles sont au centre |
| [Plan de masse du die de base](schemas/03-floorplan-die-base.svg) | chaque régulateur à l'aplomb de sa charge |
| [Pipeline du cœur P](schemas/04-pipeline-coeur-p.svg) | le prédicteur court devant la récupération |
| [Immédiat contre TBDR](schemas/05-tbdr-vs-immediat.svg) | le trafic mémoire qui disparaît |
| [Chemin des poids d'un LLM](schemas/06-chemin-donnees-llm.svg) | pourquoi ×2,6 et ×1,5 donnent ×8,8 |
| [Arbre d'alimentation](schemas/07-arbre-alimentation.svg) | 4 points de rendement échangés contre 200× d'agilité |
| [Pile thermique](schemas/08-pile-thermique.svg) | le point chaud que la moyenne cache |
| [Flot d'assemblage](schemas/09-flot-assemblage.svg) | pourquoi le tri des bons dies décide de l'économie |

Le modèle exécutable vit dans [`modele/aurora_model.py`](modele/aurora_model.py)
(bibliothèque standard uniquement, aucune dépendance) :

```sh
python3 docs/aurora/modele/aurora_model.py --mc 20000
```

Sa sortie complète est archivée dans [`modele/resultats.txt`](modele/resultats.txt),
pour pouvoir lire les chiffres sans exécuter le script — et pour que toute
modification du modèle apparaisse dans le diff.

---

## Objectifs de conception (rappel : objectifs, pas mesures)

| Métrique | Cible Aurora | Référence 2026 | Base de l'estimation |
|---|---|---|---|
| IPC cœur P (SPECint2017/GHz) | **2,87** (p05 2,71 – p95 3,03) | 2,3 (Ascalon), ~3,0 (Apple) | [§11.2](11-modele-performance.md) |
| Fréquence cœur P (N2P) | 4,2 GHz visés (médiane MC 4,06) | 3,85 GHz (Veyron V2) | [§11.8](11-modele-performance.md) |
| SPECint2017 mono-cœur | **11,6** (p05 10,4 – p95 12,7) | — | [§11.8](11-modele-performance.md) |
| Perf/W à surface égale, 4 cœurs E vs 1 cœur P | **×2,94** pour ×1,65 de débit | — | [§11.3](11-modele-performance.md) |
| Efficacité matricielle MXFP4 (sous-système) | **5,3–5,6 TOPS/W** | 4,07 TOPS/W (prototype recherche) | [§11.7](11-modele-performance.md) |
| Efficacité matricielle MXFP4 (système complet) | 3,0 à 6,6 TOPS/W selon la classe | — | [§11.7](11-modele-performance.md) |
| Énergie par token, décodage LLM 7 Md | **8,2 mJ** au lieu de 71,8 (×8,8) | — | [§11.7](11-modele-performance.md) |
| Surcoût traduction x86 | < 25 % | ~40 % (état de l'art logiciel seul) | [§1.6](01-isa-aurora.md) |
| Coût de fabrication Aurora-D | **≈ 341 $** (silicium 247 $) | — | [§12.10](12-plans-de-construction.md) |
| Coût de fabrication Aurora-S | ≈ 3 283 $, dont **49 % de HBM4** | — | [§12.10](12-plans-de-construction.md) |

Ces cibles sont **falsifiables** : le document 11 dit précisément quelle mesure,
à quelle étape du projet, invaliderait chacune d'elles. Une architecture qui ne
peut pas être réfutée n'est pas une architecture, c'est une brochure.

---

## Honnêteté sur les limites

Quatre choses que ce dossier ne peut pas faire, et qu'il vaut mieux dire tout de suite :

1. **Aucun chiffre n'est mesuré.** Tant qu'il n'y a ni RTL ni simulateur
   cycle-accurate calibré, l'incertitude sur l'IPC est de l'ordre de ±25 %, et
   celle sur la puissance de ±30 %. Le document 11 propage cette incertitude au
   lieu de la cacher.
2. **L'écosystème est le vrai risque, pas le silicium.** RISC-V en 2026 :
   Vulkan/OpenGL accéléré n'est mainline que depuis très peu de temps, Ubuntu
   bascule seulement sur RVA23, Android 16 vient d'être porté. Le document 8
   traite ce risque comme le risque principal du programme, parce qu'il l'est.
3. **Les extensions matricielles RISC-V ne sont pas ratifiées.** Les groupes
   IME / VME / AME travaillent encore. `Xaurmt` est donc une extension propre
   avec un plan de convergence explicite ([§1.3](01-isa-aurora.md)) — pas un
   standard qu'on prétendrait suivre.
4. **Le coût est réel.** Un programme de cette nature, à ces nœuds, se chiffre
   en centaines de millions à plus d'un milliard de dollars, avec un premier
   silicium à 36 mois au mieux. Le document 10 le dit sans arrondir vers le bas.

---

## Sources principales

- [RISC-V — ratification du profil RVA23](https://riscv.org/blog/risc-v-announces-ratification-of-the-rva23-profile-standard/)
- [RVA23 Profiles v1.0 — spécification ratifiée](https://docs.riscv.org/reference/rva23/v1.0/rva23-profiles.html)
- [TSMC — technologie 2 nm (N2)](https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_2nm)
- [TSMC — technologie A16 et Super Power Rail](https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_A16)
- [JEDEC — standard HBM4 JESD270-4](https://www.jedec.org/news/pressreleases/jedec%C2%AE-and-industry-leaders-collaborate-release-jesd270-4-hbm4-standard-advancing)
- [UCIe 3.0 — spécification](https://www.uciexpress.org/post/ucie-3-0-specification-redefining-chiplet-interconnects)
- [Horowitz — Computing's Energy Problem (ISSCC)](https://gwern.net/doc/cs/hardware/2014-horowitz-2.pdf)
- [Émulation x86-64 efficace sur RISC-V (EuroSys 2026)](https://dl.acm.org/doi/10.1145/3767295.3803574)
- [CHERI — université de Cambridge](https://www.cl.cam.ac.uk/research/security/ctsrd/cheri/)
- [Tenstorrent — disponibilité de TT-Ascalon](https://tenstorrent.com/en/newsroom/tenstorrent-announces-availability-of-tt-ascalon)
