# 1. Aurora-V — le jeu d'instructions

> **Principe directeur.** Une ISA n'est pas un concours de fonctionnalités.
> C'est un contrat entre le compilateur et le matériel. Les bonnes ISA disent
> peu de choses, mais les disent précisément, et rendent le matériel *prévisible*.

---

## 1.1 Décision fondatrice : partir de RVA23, pas de zéro

Concevoir une ISA nouvelle est un piège classique. On gagne quelques pourcents
de densité de code et on perd dix ans d'écosystème. Aurora-V est donc, au
niveau utilisateur, **strictement conforme à RVA23U64** : tout binaire RVA23
valide s'exécute sur Aurora sans modification, sans recompilation, sans mode
particulier.

Base obligatoire :

| Bloc | Contenu |
|---|---|
| RV64I + M, A, F, D, C | entier 64 bits, mult/div, atomiques, flottant simple et double, compressé |
| **V** (RVV 1.0) | vectoriel à longueur variable — `VLEN` = 256 bits sur Aurora-P/E |
| **H** | hyperviseur (virtualisation) |
| Zicbom/Zicboz/Zicbop | gestion de blocs de cache |
| Zba, Zbb, Zbs, Zbc | manipulation de bits |
| Zfh, Zvfh | demi-précision scalaire et vectorielle |
| Zkn, Zks | crypto (AES, SHA-2, SM4) |
| Sscofpmf | compteurs de performance |
| Svadu, Svnapot, Svpbmt | pagination avancée |

`VLEN = 256 bits` est un choix, pas une évidence. Argumentaire :
- 128 bits laisse trop de surcoût de boucle sur les charges vectorielles courtes ;
- 512 bits crée un problème de fréquence et d'énergie (l'unité entière commute
  même pour des vecteurs courts), et dégrade la latence de basculement ;
- 256 bits, avec `LMUL` jusqu'à 8, couvre les deux régimes et correspond à la
  largeur naturelle de deux FMA 128 bits — donc un datapath réutilisable.

---

## 1.2 Les extensions propres : `Xaur*`

Sept extensions, chacune répondant à un poste de consommation identifié au
document 0. Aucune n'est requise pour exécuter du code RVA23 standard : elles
sont **découvrables** via le bloc de configuration et activables par privilège.

| Extension | Rôle | Justification énergétique |
|---|---|---|
| `Xaurmt` | matrices : registres 2D, MMA, formats microscaling | sortir du régime 1 op = 1 instruction |
| `Xaurdma` | descripteurs de flux mémoire | supprimer les chaînes de chargements spéculatifs |
| `Xaurdt` | threads découplés de préchargement | masquer la latence sans spéculer |
| `Xaurx86` | aides à la traduction binaire x86 | compatibilité sans pénalité rédhibitoire |
| `Xaurcap` | capacités CHERI 128 bits | sécurité mémoire matérielle |
| `Xaurpq` | crypto post-quantique (NTT, Keccak) | éviter des milliers d'instructions par opération |
| `Xaurpm` | télémétrie et placement de threads | ordonnancement hétérogène informé |

Encodage : espace `custom-0` à `custom-3` de RISC-V, plus une demande
d'allocation d'opcode auprès de RISC-V International pour les extensions
destinées à la standardisation (`Xaurmt` en premier lieu).

---

## 1.3 `Xaurmt` — l'extension matricielle

### Le problème

Une multiplication de matrices 1024³ en FP16 représente ~2,1 milliards de MAC.
En vectoriel RVV 256 bits, cela fait environ 134 millions d'instructions
dynamiques. À ~15 pJ de surcoût par instruction (fetch, décode, renommage,
ordonnancement, écriture registre) — surcoût qui **n'inclut pas le calcul** —
on dépense **~2,0 mJ rien qu'en administration**, contre **~2,1 mJ de calcul
utile**. Le surcoût égale le travail. C'est exactement le régime qu'il faut
quitter.

### La solution : état architectural matriciel

Huit registres matriciels architecturaux `m0`–`m7`, chacun contenant une
**tuile** de 32 × 32 éléments, avec un type d'élément dynamique :

| Format | Éléments par tuile | Taille du registre |
|---|---|---|
| FP32 / TF32 | 32 × 32 | 4 Ko |
| FP16 / BF16 | 32 × 32 | 2 Ko |
| MXFP8 (E4M3/E5M2) | 32 × 32 | 1 Ko + échelles |
| MXFP6, MXFP4 | 32 × 32 | 768 / 512 o + échelles |
| INT8 / MXINT8 | 32 × 32 | 1 Ko + échelles |

Total : 32 Ko d'état matriciel par cœur P (16 Ko sur le cœur E, 4 tuiles).
C'est significatif pour le changement de contexte — d'où la règle ci-dessous.

### Instructions principales

```
mtcfg    rs1                 ; configure type d'élément, taille effective (M,N,K)
mtld.a   md, rs1, rs2        ; charge une tuile A depuis (base, stride)
mtld.b   md, rs1, rs2        ; charge une tuile B (transposée à la volée)
mtld.c   md, rs1, rs2        ; charge un accumulateur C
mtst.c   ms, rs1, rs2        ; stocke un accumulateur
mmacc    md, ms1, ms2        ; md += ms1 × ms2   (le cœur de l'extension)
mmacc.s  md, ms1, ms2        ; idem, version sparse 2:4
mtzero   md                  ; met à zéro
mtmov    md, ms              ; copie
mtbcast  md, rs1             ; diffusion d'un scalaire
mtact    md, ms, imm         ; activation fusionnée (ReLU, GELU, SiLU, tanh)
mtquant  md, ms, rs1         ; quantification / changement d'échelle de bloc
```

Une seule instruction `mmacc` en FP16 déclenche 32 768 MAC. Le surcoût
d'administration par MAC tombe de ~15 pJ à **moins de 0,001 pJ**. C'est là que
se joue le facteur d'efficacité de l'IA, pas dans le nombre de TOPS affichés.

### Format microscaling en matériel

Les formats MX (un facteur d'échelle partagé par bloc de 32 éléments) sont
gérés dans le datapath : le facteur est appliqué à l'accumulation, sans
instruction supplémentaire. C'est ce qui permet d'espérer l'ordre de grandeur
observé sur les prototypes de recherche (≈4 TOPS/W en MXFP4 contre
≈0,66 TOPS/W en MXINT8).

### Changement de contexte

L'état matriciel est **paresseux** : un bit `MS` dans `mstatus` marque les
tuiles sales. Le noyau ne sauvegarde que si le bit est levé, comme pour l'état
flottant. Une instruction `mtrelease` permet au logiciel de déclarer l'état
mort, ce qui évite complètement la sauvegarde — les bibliothèques de GEMM
l'émettent en sortie de noyau de calcul.

### Plan de convergence avec RISC-V

`Xaurmt` est délibérément proche de l'approche **AME** (registres matriciels
dédiés). Engagement du programme :

1. Contribuer la spécification `Xaurmt` au groupe de travail matrice.
2. Maintenir une couche d'abstraction dans LLVM (`aurora.matmul.*` en
   intrinsèques génériques) de sorte qu'un changement d'encodage ne recompile
   que le backend, pas les bibliothèques.
3. S'engager à supporter l'extension ratifiée en parallèle dès la génération
   suivante, avec `Xaurmt` maintenu en compatibilité pendant deux générations.

C'est la position honnête : on n'attend pas un standard qui n'existe pas, et on
ne fait pas semblant que notre extension en est un.

---

## 1.4 `Xaurdma` — décrire les flux au lieu de les deviner

### Le problème

Un processeur out-of-order consacre une part considérable de son énergie à
redécouvrir, à chaque itération, un motif d'accès mémoire que le compilateur
connaissait à la compilation. Les préchargeurs matériels sont des devins
statistiques : ils se trompent, et une prédiction fausse coûte à la fois de
l'énergie et de la bande passante.

### La solution : le descripteur de flux

```
sdesc    sd, rs1, rs2, rs3   ; définit un flux : base, motif, longueur
sopen    sd, imm             ; ouvre le flux vers la mémoire de tuile
snext    rd, sd              ; consomme l'élément suivant (registre)
sadv     sd, rs1             ; avance de n éléments
sclose   sd                  ; ferme et libère
sfence.s sd                  ; barrière sur un flux précis
```

Un descripteur décrit un accès jusqu'à 4 dimensions : base, `stride` et
`count` par dimension, type d'élément, mode (lecture, écriture, lecture-modif).
Huit descripteurs par hart.

Le moteur de flux est un DMA cohérent placé dans le die de base, sous le
contrôleur mémoire. Il :

- lit **séquentiellement et à pleine largeur de rafale** (pas de gaspillage :
  une ligne DRAM ouverte est exploitée entièrement) ;
- écrit dans la mémoire de tuile du cœur demandeur, hors des caches, ce qui
  évite de polluer le L2 avec des données à usage unique ;
- participe au protocole de cohérence, donc la programmation reste sûre ;
- prend en charge les motifs `gather` par liste d'index, cas typique des
  graphes et des tables d'embedding.

**Gain attendu :** sur une boucle de convolution ou de GEMM, les instructions
d'adressage et de chargement disparaissent du flot d'instructions. Le modèle du
document 11 estime la réduction d'énergie du front-end à 30–45 % sur les
noyaux à motif régulier — avec la mise en garde qu'il s'agit d'une estimation
analytique, à confirmer en simulation.

### Pourquoi ce n'est pas un retour au Cell/SPE

Le Cell a échoué parce que sa mémoire locale était **obligatoire, non
cohérente, et gérée à la main**. Ici : le mécanisme est **optionnel** (le code
standard n'en sait rien et fonctionne), **cohérent** (aucun risque de
corruption silencieuse) et **généré par le compilateur** (LLVM émet les
descripteurs depuis l'analyse polyédrique des nids de boucles). Le programmeur
n'a rien à faire.

---

## 1.5 `Xaurdt` — les threads découplés

Pour les motifs *irréguliers* que ni le compilateur ni un préchargeur ne
peuvent prévoir (parcours de listes chaînées, d'index, de graphes), Aurora
propose un mécanisme de *decoupled access-execute* :

```
dtspawn  rd, rs1, rs2        ; lance un thread d'accès à l'adresse rs1
dtpush   rs1                 ; le thread d'accès publie une adresse touchée
dtjoin   rs1                 ; termine
```

Un « thread d'accès » est un contexte matériel léger (PC + 8 registres, pas de
FPU, pas de matrice) qui exécute une version élaguée de la boucle — la partie
qui calcule les adresses — et qui n'a **aucun effet architectural** : ses
écritures sont interdites, ses fautes de page sont ignorées. Son seul effet est
de remplir les caches en avance.

Coût matériel : ~0,04 mm² par cœur P (2 contextes). Gain attendu : 10–20 % sur
les charges à pointeurs, sans spéculation supplémentaire dans le cœur principal
— donc **sans le coût énergétique de la mauvaise spéculation**.

---

## 1.6 `Xaurx86` — la compatibilité binaire, traitée sérieusement

Un processeur qui ne fait pas tourner le logiciel existant est un objet de
laboratoire. La recherche publiée en 2026 place l'émulation x86-64 sur RISC-V
à moins de 40 % de surcoût moyen, ce qui est déjà exploitable
([EuroSys 2026](https://dl.acm.org/doi/10.1145/3767295.3803574)). Quatre aides
matérielles doivent ramener ce chiffre **sous 25 %**, au niveau de ce que
Rosetta 2 a rendu acceptable pour le grand public.

### (a) Mode TSO commutable par thread

Le surcoût dominant de la traduction x86→RISC-V n'est pas le calcul : c'est la
**cohérence mémoire**. Le traducteur doit insérer des barrières partout parce
qu'il ne peut pas prouver l'absence de partage.

```
csrw   auroramem, 1   ; ce hart passe en ordonnancement TSO
```

Le mode TSO est un bit du contexte, sauvegardé et restauré par le noyau. Coût
matériel : le tampon de stores doit valider dans l'ordre et le LSU désactive la
réorganisation des chargements. Perte mesurée sur les implémentations
comparables : quelques pourcents sur le code natif — mais le code natif ne
l'active pas. **Gain : élimination de l'essentiel des barrières émises par le
traducteur**, soit la moitié environ du surcoût observé.

### (b) Calcul de drapeaux en une instruction

x86 écrit `EFLAGS` à chaque opération arithmétique. Émuler ce comportement
coûte typiquement 3 à 6 instructions RISC-V par opération x86.

```
x86flags.add  rd, rs1, rs2   ; produit ZF,SF,CF,OF,AF,PF dans rd
x86flags.sub  rd, rs1, rs2
x86flags.log  rd, rs1, rs2
x86flags.shl  rd, rs1, rs2
```

Une instruction, un cycle, un registre d'état compact. Le traducteur n'émet
l'instruction que si les drapeaux sont effectivement lus plus loin — l'analyse
de vivacité étant triviale dans un traducteur.

### (c) Adressage complexe fusionné

L'adressage x86 `base + index×échelle + déplacement` demande 2 à 3 instructions
RISC-V. Aurora garantit la fusion de la séquence canonique
`shNadd` + `addi` + `load` en **une seule µop** dans l'AGU. Ce n'est pas une
nouvelle instruction : c'est un engagement contractuel (§1.7).

### (d) Sémantique flottante x87/SSE

Un bit de mode active l'arrondi et la gestion des dénormaux conformes à x87
(précision étendue 80 bits émulée via une paire de registres double) et les
sémantiques SSE de `NaN` et de comparaison. Sans cela, chaque opération
flottante émulée demande une correction logicielle.

### Ce que ça donne

| Poste (points de surcoût sur le temps natif) | Sans aide | Avec `Xaurx86` |
|---|---|---|
| Barrières mémoire | ~16 | ~2 |
| Drapeaux | ~9 | ~2 |
| Adressage | ~6 | ~2 |
| Flottant | ~3 | ~1 |
| Traduction, dispatch, retour au traducteur | ~7 | ~7 (coût logiciel, inchangé) |
| **Total estimé** | **~41 %** | **~14 %**, soit 16–25 % avec marge |

Ces valeurs sont des **estimations analytiques** dérivées de la décomposition
publiée du surcoût d'émulation ; elles doivent être confirmées par un prototype
de traducteur sur simulateur avant tape-out (jalon M18, document 10).

### Traduction Arm64

Le même appareillage sert pour Arm64, qui est beaucoup plus simple à traduire
(pas de drapeaux implicites coûteux, modèle mémoire déjà faible). Surcoût
estimé : 8–12 %, sans besoin du mode TSO.

---

## 1.7 La fusion contractuelle : une idée qui manque à tout le monde

Tous les processeurs modernes fusionnent des paires d'instructions. Mais la
liste est **secrète, instable et non documentée** : le compilateur devine, et
une génération suivante peut casser l'optimisation.

Aurora publie, **dans l'ABI**, une liste de séquences dont la fusion est
**garantie sur toute la famille**, présente et future :

| Séquence | Devient | Cas d'usage |
|---|---|---|
| `slli rd,rs,n` + `add rd,rd,rt` | 1 µop AGU | indexation de tableau |
| `lui` + `addi` | 1 µop | constante 32 bits |
| `auipc` + `addi` | 1 µop | adresse PC-relative |
| `add` + `ld` | 1 µop d'adressage | déréférencement |
| `slt` + `beq/bne` | 1 µop de branchement | comparaison + saut |
| `and` + `beqz` | 1 µop | test de bit |
| `srli` + `andi` | 1 µop | extraction de champ |
| `mul` + `add` (entier) | 1 µop MAC | produit scalaire entier |
| `fmul` + `fadd` | déjà FMA | — |
| `addi sp` + `sd` (prologue) | 1 µop | prologue de fonction |

Conséquences :

1. **Le compilateur optimise pour de vrai**, parce que la garantie est
   contractuelle. LLVM peut préférer une séquence fusible à une séquence plus
   courte mais non fusible.
2. **La densité de code redevient un non-problème.** On obtient l'effet d'un
   jeu d'instructions CISC (une instruction fait plus de travail) sans le coût
   du décodage CISC.
3. **Le budget de ROB s'allonge virtuellement** : moins d'entrées pour le même
   travail utile.

Sur du code entier typique, la mesure de référence des implémentations
existantes situe le taux de fusion entre 8 et 15 % des instructions. Avec une
liste publiée et un compilateur qui la cible explicitement, l'objectif est
**18–22 %**, ce qui représente environ 8 % d'IPC effectif et une réduction
proportionnelle de l'activité du front-end.

---

## 1.8 `Xaurpq` — crypto post-quantique

Les opérations coûteuses de ML-KEM (Kyber) et ML-DSA (Dilithium) sont la
transformée théorique en nombres (NTT) et Keccak. En logiciel, une NTT de
degré 256 coûte des milliers d'instructions.

```
pqntt.f   vd, vs1, vs2, imm   ; papillon NTT avant sur registre vectoriel
pqntt.i   vd, vs1, vs2, imm   ; inverse
pqmr      vd, vs1, vs2        ; réduction de Montgomery modulo q
pqcbd     vd, vs1, imm        ; échantillonnage binomial centré
keccakf   vd                  ; permutation Keccak-f[1600], 24 rondes
```

Gain attendu : facteur 10 à 30 sur les primitives, ce qui fait passer le coût
d'une poignée de main post-quantique sous le seuil perceptible. À l'échelle
d'un centre de données qui chiffre tout son trafic, c'est un poste de
consommation entier qui disparaît.

---

## 1.9 `Xaurpm` — la télémétrie pour l'ordonnanceur

Le placement des threads sur des cœurs hétérogènes est traditionnellement mal
résolu : soit l'OS devine, soit le matériel décide en aveugle.

Aurora expose un **bloc de conseil** en lecture seule, accessible en une
instruction :

```
pmread   rd, imm    ; lit un compteur agrégé du cœur courant
```

Champs disponibles, agrégés sur une fenêtre glissante de 10 µs :

| Champ | Usage par l'ordonnanceur |
|---|---|
| IPC effectif | thread limité par le calcul ou par la mémoire ? |
| MPKI L2 et SLC | sensibilité au cache |
| Fraction d'instructions vectorielles / matricielles | intérêt d'un cœur P |
| Cycles de stall mémoire | un cœur E suffirait-il ? |
| Énergie consommée sur la fenêtre (J, compteur matériel) | équité énergétique |
| Prédiction de gain P→E et E→P | **estimation matérielle du gain de migration** |

Le dernier champ est le plus utile : le matériel connaît le comportement réel
du thread, l'OS connaît les priorités et l'état du système. **Le matériel
propose, l'OS dispose.** C'est le bon partage — l'inverse produit les
pathologies d'ordonnancement bien connues sur les architectures hybrides.

---

## 1.10 Ce qu'Aurora-V n'a délibérément pas

| Écarté | Pourquoi |
|---|---|
| Prédication généralisée | l'expérience Itanium ; coûte des ports de registres pour un gain que la prédiction de branchement moderne rend marginal |
| VLIW | reporte sur le compilateur une décision qui dépend de la latence mémoire, inconnue à la compilation |
| SMT sur les cœurs P | partage de structures = surface d'attaque par canal auxiliaire, et gain de perf/W négatif sur charges client (voir §2.9) |
| Registres à fenêtres | complexité de changement de contexte, gain nul avec 32 registres |
| Cache d'µops | inutile quand le décodage est bon marché : c'est une rustine x86 |
| Instructions transactionnelles (HTM) | historiquement source de failles et d'errata ; `Xaurdma` couvre les besoins réels |

Dire non est une décision d'architecture au même titre que dire oui. Chaque
fonctionnalité non implémentée est de la surface, de la fuite, de la
vérification et des errata en moins.

---

## 1.11 Récapitulatif de l'espace d'encodage

| Espace | Usage |
|---|---|
| Opcodes standard RVA23 | inchangés, conformité stricte |
| `custom-0` (0x0B) | `Xaurmt` (matrices) |
| `custom-1` (0x2B) | `Xaurdma` + `Xaurdt` |
| `custom-2` (0x5B) | `Xaurx86` + `Xaurpq` |
| `custom-3` (0x7B) | `Xaurcap` (CHERI) + `Xaurpm` |
| CSR 0x8C0–0x8FF | configuration Aurora (mode TSO, découverte, télémétrie) |

Découverte : le CSR `auroraid` expose un vecteur de bits d'extensions présentes.
La bibliothèque C d'exécution le lit au démarrage et sélectionne les variantes
de fonctions (`ifunc`), exactement comme la détection AVX sur x86 — mécanisme
éprouvé, aucun risque pour la distribution logicielle.

---

**Suite :** [2. Microarchitecture CPU](02-cpu-microarchitecture.md)
