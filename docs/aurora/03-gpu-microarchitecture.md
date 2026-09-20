# 3. Aurora-G — microarchitecture GPU

> Un GPU est une machine à déplacer des données qui, accessoirement, calcule.
> Toute la conception découle de là.

---

## 3.1 Hiérarchie

```
GPU  =  N Slices  (2 en mobile, 8 en desktop, 16 en serveur)
 └ Slice  =  4 Cores + 2 Mo L2 + 1 rasteriseur + 1 unité de binning
    └ Core  =  4 SIMD32 + 2 unités matricielles + 1 unité RT
              + 128 Ko de registres + 256 Ko de SRAM de tuile
       └ SIMD32 = 32 voies FP32 / 64 voies FP16
```

Par Slice, par cycle :

| Ressource | Débit |
|---|---|
| FP32 | 512 FLOP (× 2 avec FMA = 1 024) |
| FP16 / BF16 | 2 048 FLOP |
| Matriciel MXFP8 | 16 384 FLOP |
| Matriciel MXFP4 | 32 768 FLOP |
| Texels filtrés | 64 |
| Tests d'intersection rayon-boîte | 32 |
| Pixels écrits | 32 |

À 1,8 GHz, une configuration Aurora-D à 8 Slices atteint environ
**14,7 TFLOP/s FP32** et **472 TFLOP/s MXFP4** — sous réserve d'être alimentée
en données, ce qui est justement le sujet du reste du document.

---

## 3.2 Décision n°1 : SIMT avec scalarisation matérielle

Dans un warp de 32 voies, une fraction considérable des valeurs est
**identique** sur toutes les voies : indices de constantes, adresses de base,
paramètres de matériau, identifiants d'objet. Les exécuter 32 fois est un
gaspillage pur.

Aurora détecte l'uniformité **en matériel**, au niveau du banc de registres :

- Chaque registre vectoriel porte un bit `UNIFORM`, mis à jour à l'écriture
  (comparaison arborescente des 32 voies, coût ~0,4 % de la surface du core).
- Une instruction dont toutes les sources sont uniformes est routée vers une
  **unité scalaire** de 32 bits, et le résultat est marqué uniforme.
- L'adressage mémoire uniforme déclenche un **accès unique** au lieu de 32
  requêtes coalescées.

Mesures publiées dans la littérature sur les charges graphiques et de calcul :
**25 à 40 % des instructions dynamiques sont uniformes**. Le gain énergétique
est proportionnel, et le gain en pression sur le banc de registres — qui est
l'un des plus gros consommateurs d'un GPU — l'est également.

Les compilateurs font déjà de la scalarisation statique. Le matériel attrape ce
que le compilateur ne peut pas prouver, c'est-à-dire l'essentiel des cas
dépendant de l'exécution.

---

## 3.3 Décision n°2 : rendu par tuiles, hybride

### Le calcul qui tranche

Un rendu 4K en immédiat écrit et relit le tampon de profondeur et le tampon de
couleur en mémoire externe. Pour une scène avec un surdessin moyen de 3× :

| Poste | Trafic externe |
|---|---|
| Écritures profondeur | 8,3 M pixels × 3 × 4 o = ~100 Mo/image |
| Lectures profondeur | ~100 Mo/image |
| Écritures couleur | ~100 Mo/image |
| **Total à 60 Hz** | **~18 Go/s, uniquement pour le framebuffer** |

À ~200 pJ par accès de 32 bits, cela représente plusieurs watts consommés à ne
faire que déplacer des pixels.

En **TBDR**, la tuile 32 × 32 tient en SRAM (32 × 32 × 8 o = 8 Ko pour couleur
+ profondeur). Profondeur et couleur intermédiaires **ne sortent jamais de la
puce**. Seul le résultat final est écrit : ~100 Mo/image devient ~33 Mo/image,
et les lectures disparaissent.

### Le mode hybride, et pourquoi il est nécessaire

Le TBDR pur a un défaut réel : la phase de binning doit traiter **toute la
géométrie** avant de commencer le shading, et stocke une liste de primitives
par tuile. Sur les scènes à géométrie extrême (dizaines de millions de
triangles, géométrie générée par mesh shaders), cette liste peut dépasser la
mémoire disponible et devenir elle-même un poste de trafic.

Aurora bascule par passe de rendu, selon un critère matériel :

| Condition | Mode |
|---|---|
| Géométrie < seuil, cible ≤ 4K, MSAA actif | **TBDR** (défaut) |
| Débordement de la liste de primitives | bascule automatique en immédiat pour la passe |
| Passe marquée « géométrie lourde » par l'application | immédiat avec tampon de tuile en cache |
| Passe de calcul pure | ni l'un ni l'autre — ordonnancement direct |

Le pilote expose le choix via une extension Vulkan, mais le défaut matériel est
correct sans intervention. Une architecture qui exige que le développeur
comprenne son mode de rendu a déjà échoué.

### Suppression des surfaces cachées (HSR)

Avant de shader, le matériel résout la visibilité **exactement** dans la tuile,
par test de profondeur sur la liste de primitives. Seuls les fragments
réellement visibles sont shadés. Sur un surdessin de 3×, cela divise par ~3 le
travail de shading — le poste le plus coûteux en énergie du pipeline
graphique. Les fragments avec discard ou alpha-test sont traités dans une
passe séparée, comme l'exige la sémantique.

---

## 3.4 Décision n°3 : la matrice dans le GPU, pas à côté

Un NPU séparé pose trois problèmes :

1. Il duplique le chemin mémoire (son propre DMA, ses propres tampons).
2. Il reste inactif la plupart du temps, tout en fuyant.
3. Il force le logiciel à choisir une cible — et donc à *partitionner* les
   modèles, ce qui est précisément le genre de complexité qui tue l'adoption.

Apple a tranché dans l'autre sens avec le M5 en plaçant un accélérateur
neuronal **dans chaque cœur GPU**, et les gains annoncés (plus de 4× en calcul
IA face au M4) valident l'approche.

Aurora place donc la matrice à **trois** niveaux, chacun justifié :

| Emplacement | Pour quoi | Pourquoi là |
|---|---|---|
| Dans le cœur CPU (1 par paire) | petites GEMM, couches de sortie, pré/post-traitement, inférence à faible latence | évite le coût de transfert vers le GPU, qui domine pour les petits tenseurs |
| Dans le cœur GPU (2 par core) | le gros du calcul d'entraînement et d'inférence | réutilise le banc de registres, la SRAM de tuile et le chemin mémoire du GPU |
| Près de la mémoire (die de base) | GEMM géantes limitées par la bande passante, réductions, attention à long contexte | la donnée n'a pas besoin de remonter jusqu'au GPU (§4.7) |

Aucun bloc isolé. Aucun partitionnement demandé au développeur : le
compilateur IA (§8.5) choisit, avec un modèle de coût qui compare temps et
énergie.

---

## 3.5 Ray tracing

| Bloc | Caractéristiques |
|---|---|
| Structure | BVH8 compressé (8 enfants par nœud, 1 nœud = 64 o) |
| Intersection | 32 tests rayon-boîte/cycle/core, 8 rayon-triangle/cycle |
| Traversée | pile matérielle 32 niveaux, réordonnancement des rayons |
| Cache BVH | 128 Ko par Slice, dédié |
| Construction | unité matérielle de construction et de rafraîchissement |

**Le réordonnancement des rayons est le point clé.** En ray tracing, les rayons
d'un warp divergent rapidement, et la cohérence mémoire s'effondre — chaque
voie touche une partie différente de la scène. L'unité de réordonnancement
regroupe les rayons par région spatiale avant l'intersection, ce qui restaure
la localité. Effet mesuré dans la littérature et sur les implémentations
commerciales : facteur 1,5 à 2× sur le débit, avec une réduction du trafic
mémoire du même ordre. Là encore : le gain vient du **déplacement de données**,
pas du calcul.

La construction du BVH est matérielle. En logiciel, elle occupe le CPU et
constitue souvent le goulot réel sur les scènes dynamiques.

---

## 3.6 Hiérarchie mémoire du GPU

| Niveau | Taille | Bande passante | Remarque |
|---|---|---|---|
| Registres | 128 Ko / core | 4 To/s | banqués par 4, avec cache d'opérandes (§3.7) |
| SRAM de tuile | 256 Ko / core | 2 To/s | adressable, partagée par le groupe de threads |
| L1 / texture | 64 Ko / core | 1 To/s | filtrage matériel intégré |
| L2 | 2 Mo / Slice | 4 To/s | |
| SLC (partagé CPU/GPU) | 32–256 Mo | 6–12 To/s | die de base, §4.4 |
| Mémoire | LPDDR6 / HBM4 | 0,23–8 To/s | |

### Cache d'opérandes

Un détail d'implémentation à fort impact énergétique : un petit cache de 4
entrées par voie, devant le banc de registres, qui capte les réutilisations
immédiates (le résultat d'une instruction consommé par la suivante). Le banc de
registres d'un GPU est l'un de ses trois plus gros postes de consommation ; ce
cache en retire **30 à 40 % des accès** pour une surface négligeable.

---

## 3.7 Compression, partout

Chaque octet non transféré est ~200 pJ économisés.

| Type | Technique | Ratio typique |
|---|---|---|
| Framebuffer couleur | delta-compression par tuile, sans perte | 1,6–2,2× |
| Profondeur | plan + résidu, sans perte | 2–4× |
| Textures | ASTC, BCn, décompression matérielle | 4–8× |
| Trafic L2 ↔ mémoire | compression générique par ligne | 1,3–1,8× |
| Poids de modèles IA | MXFP4/MXFP6 natif + sparsité 2:4 | 4–8× vs FP16 |

La compression du trafic L2 ↔ mémoire est transparente : les lignes sont
stockées compressées en mémoire avec des métadonnées dans le SLC. Le gain n'est
pas seulement de la bande passante, c'est de la **capacité effective**.

---

## 3.8 Ordonnancement et occupation

- Jusqu'à **64 groupes de threads** résidents par core.
- Ordonnanceur à deux niveaux : un ordonnanceur de groupes qui décide de la
  résidence, un ordonnanceur de warps par SIMD.
- Politique par défaut : **GTO** (*greedy-then-oldest*), meilleure pour la
  localité de cache qu'un tourniquet — on finit ce qu'on a commencé plutôt que
  d'entrelacer et de faire s'évincer les lignes mutuellement.
- **Limitation d'occupation adaptative** : une occupation maximale n'est pas
  toujours optimale. Trop de warps résidents font s'expulser mutuellement leurs
  lignes de cache. Le matériel surveille le taux d'échec L1 et **réduit
  volontairement** le nombre de warps actifs quand le thrashing est détecté.
  Contre-intuitif, et c'est l'un des réglages les plus rentables d'un GPU
  moderne.
- **Préemption au niveau instruction** pour les charges de calcul, ce qui rend
  possible un vrai partage du GPU entre applications (un manque criant sur la
  plupart des GPU actuels, où une charge de calcul longue gèle l'affichage).

---

## 3.9 Mémoire unifiée : ce que ça change concrètement

Le GPU partage l'espace d'adressage virtuel du processus CPU (SVM complet) :

- mêmes tables de pages, même MMU, mêmes permissions ;
- **fautes de page prises en charge par le GPU** — un noyau de calcul peut
  toucher de la mémoire non résidente et attendre la pagination, comme du code
  CPU ;
- cohérence à granularité de ligne pour les régions marquées cohérentes,
  cohérence à granularité de tampon (acquire/release) par défaut ;
- **zéro `memcpy`** : passer un pointeur suffit.

Ce que ça supprime : sur une charge d'inférence typique, les copies
hôte↔périphérique représentent souvent 20 à 40 % du temps total et une part
comparable de l'énergie. Le supprimer n'est pas une optimisation, c'est un
changement de nature.

---

## 3.10 Sortie d'affichage et média

| Bloc | Capacité |
|---|---|
| Sorties | 4 × DisplayPort 2.1 UHBR20 / HDMI 2.2 |
| Résolution max | 8K à 120 Hz, ou 4 × 4K à 144 Hz |
| Composition | moteur de composition dédié, hors GPU |
| Encodage | AV1, H.266/VVC, HEVC, H.264 — 2 flux 8K60 simultanés |
| Décodage | idem + AV2, 4 flux 8K60 |
| VRR, HDR | oui, tone mapping matériel |

Le **moteur de composition séparé** est important pour l'énergie : afficher une
interface statique ne doit pas réveiller le GPU. Sur un usage bureautique, le
GPU peut rester en power gating la quasi-totalité du temps.

---

## 3.11 Le logiciel graphique : la vraie difficulté

Le matériel GPU est la partie facile. Le pilote est la partie qui fait échouer
les projets — l'état de l'art RISC-V le montre crûment (§0.9 : accélération 3D
mainline très récente, bureau souvent en rendu logiciel).

Stratégie, détaillée au document 8 :

1. **Mesa, en amont, dès le premier jour.** Pilote Gallium + backend NIR,
   développé publiquement, jamais en interne.
2. **Conformité Vulkan 1.4 avant le silicium**, sur simulateur puis sur FPGA.
   La suite de conformité Khronos tourne sur l'émulateur bien avant le tape-out.
3. **Vulkan comme API unique.** OpenGL via Zink, OpenCL et SYCL via Rusticl et
   l'infrastructure existante. Pas d'API propriétaire — c'est une charge de
   maintenance permanente pour un bénéfice qui n'existe que si l'on possède
   déjà le marché.
4. **DXVK et vkd3d-proton** pour la compatibilité des jeux Windows, plutôt
   qu'une couche maison.

Budget : **environ 40 personnes sur le pilote graphique pendant 4 ans**, ce qui
est plus que l'équipe RTL du GPU. Ce n'est pas un déséquilibre, c'est le bon
ordre de priorité.

---

**Suite :** [4. Hiérarchie mémoire](04-hierarchie-memoire.md)
