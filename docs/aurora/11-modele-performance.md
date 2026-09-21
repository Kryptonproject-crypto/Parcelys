# 11. Modèle de performance — méthode, résultats, limites

> Tous les chiffres de ce document sortent de
> [`modele/aurora_model.py`](modele/aurora_model.py). Pour les reproduire :
> `python3 docs/aurora/modele/aurora_model.py --mc 20000`
>
> Ce sont des **objectifs de conception**, pas des mesures. Un objectif
> d'ingénierie se reconnaît à ce qu'on sait dire comment il serait réfuté ;
> la section §11.9 le dit pour chacun.

---

## 11.1 Méthode

Le modèle est analytique et de premier ordre. Sa valeur n'est pas sa
précision — elle est faible — mais le fait que **chaque hypothèse soit
nommée, chiffrée et modifiable**. Un désaccord sur une conclusion devient un
désaccord sur une ligne précise du code, ce qui est un progrès considérable
sur une discussion d'opinions.

Trois briques :

1. **IPC** — construction multiplicative à partir d'un point de départ publié
   (TT-Ascalon, > 2,3 SPECint2017/GHz), avec un contributeur par décision
   d'architecture, positif ou négatif, chacun assorti d'une fourchette.
2. **Puissance** — `P = C_eff · V² · f + fuite(V)` par bloc, où `C_eff` est
   calibré à partir de la surface logique et d'une densité de capacité
   commutée extrapolée de dies publiés, puis mise à l'échelle N2P/A16 avec
   les facteurs annoncés par TSMC.
3. **Énergie mémoire** — coût par accès et par bit transporté, aux ordres de
   grandeur de Horowitz et aux chiffres publiés sur le 3D V-Cache.

L'incertitude est propagée par Monte-Carlo avec des distributions
triangulaires : bornes basse et haute par contributeur, mode au point médian.

### La décote de recouvrement

Un modèle additif **surestime toujours**. Les améliorations se recouvrent : un
meilleur préchargement rend un ROB plus grand moins utile, une meilleure
prédiction rend la reprise rapide moins déterminante. Et une première
génération n'atteint jamais le rendement d'une microarchitecture mûrie sur
trois itérations.

Le modèle applique donc une **décote explicite de 10 %** (fourchette 5–16 %)
plutôt que de dissimuler ce pessimisme dans des deltas rabotés un par un. La
différence est méthodologique : une décote visible se discute, un
rabotage diffus ne se discute pas.

---

## 11.2 IPC du cœur P

| Contribution | Gain médian | IPC cumulé |
|---|---|---|
| Base : TT-Ascalon (annoncé) | — | 2,300 |
| Fetch découplé + prédicteur 3 niveaux (MPKI 4,0 → 2,5) | +5,5 % | 2,426 |
| Fusion contractuelle 18–22 % | +7,0 % | 2,596 |
| Largeur 8 au lieu de 6 | +5,0 % | 2,726 |
| ROB 512 + 384 registres physiques | +3,5 % | 2,822 |
| 3 chargements/cycle + store-set 4 K | +3,5 % | 2,920 |
| Préchargement à précision contrôlée + `Xaurdma` | +4,5 % | 3,052 |
| SLC 3D : latence LLC 48 → 35 cycles | +3,5 % | 3,159 |
| Élimination au renommage | +2,0 % | 3,222 |
| Threads découplés `Xaurdt` | +1,5 % | 3,270 |
| Files d'émission distribuées | −1,5 % | 3,221 |
| Absence de cache d'µops | −1,0 % | 3,189 |
| **Décote de recouvrement (1re génération)** | **−10,0 %** | **2,870** |

**IPC cible : 2,87 SPECint2017/GHz.** Cœur E : 1,78. Cœur L : 0,80.

À 4,2 GHz, cela donne un score mono-cœur SPECint2017 estimé à **12,1**.

Comparaison honnête : c'est dans la zone des meilleurs cœurs de 2026, sans les
dépasser franchement. **L'argument d'Aurora n'est pas la performance brute,
c'est la performance par watt** (§11.4) — et la performance brute doit
simplement être suffisante pour ne pas constituer un motif de rejet.

---

## 11.3 Points de fonctionnement

Référence des colonnes relatives : cœur P en boost = 100 %.

### Cœur P

| Point | GHz | V | P_dyn | P_fuite | Total | Perf rel. | Efficacité rel. |
|---|---|---|---|---|---|---|---|
| boost | 4,20 | 1,00 | 3,99 W | 0,55 W | **4,54 W** | 100 % | 100 % |
| nominal | 3,40 | 0,82 | 2,17 W | 0,25 W | **2,42 W** | 81 % | 152 % |
| efficace | 2,40 | 0,68 | 1,05 W | 0,13 W | **1,18 W** | 57 % | 219 % |
| minimal | 1,20 | 0,60 | 0,41 W | 0,09 W | **0,50 W** | 29 % | 261 % |

### Cœur E

| Point | GHz | V | P_dyn | P_fuite | Total | Perf rel. | Efficacité rel. |
|---|---|---|---|---|---|---|---|
| max | 2,80 | 0,78 | 0,58 W | 0,06 W | **0,64 W** | 41 % | 294 % |
| efficace | 1,20 | 0,55 | 0,12 W | 0,02 W | **0,14 W** | 18 % | 562 % |
| minimal | 0,60 | 0,48 | 0,05 W | 0,01 W | **0,06 W** | 9 % | 664 % |

### Le résultat qui justifie l'hétérogénéité

**4 cœurs E occupent la surface d'un cœur P** (1,90 mm² contre 4 × 0,48 mm²).
À leur point maximal, comparés à un cœur P en boost :

| | Valeur |
|---|---|
| Débit | **165 %** |
| Puissance | **56 %** |
| Perf/W | **294 %** |

Pour la même surface de silicium, on obtient 1,65× le débit pour un peu plus de
la moitié de la puissance. C'est le fondement quantitatif de l'architecture
hybride, et c'est la conséquence directe du terme en V² : baisser la tension
rapporte plus que ce que coûte la baisse de fréquence, tant que le travail est
parallélisable.

---

## 11.4 Budgets de puissance

### Aurora-M — 15 W, bureautique mixte (navigateur, vidéo, inférence légère)

| Poste | Puissance | Part |
|---|---|---|
| cœurs P | 2,62 W | 23,8 % |
| affichage | 2,10 W | 19,1 % |
| GPU (hors matrice) | 1,81 W | 16,4 % |
| E/S | 1,10 W | 10,0 % |
| DRAM + PHY | 1,03 W | 9,3 % |
| unités matricielles | 0,69 W | 6,3 % |
| cœurs E | 0,65 W | 5,9 % |
| horloges, PLL, régulation | 0,62 W | 5,7 % |
| SLC, NoC, liaisons 3D, cœurs L | 0,40 W | 3,5 % |
| **Total** | **11,01 W** | |

La charge modélisée consomme 11 W dans une enveloppe de 15 W. Ce n'est pas une
erreur de dimensionnement : l'enveloppe couvre les pointes soutenues (compilation,
jeu, inférence lourde), pas l'usage courant. **Le chiffre qui compte pour
l'autonomie est celui-ci, pas le TDP.**

### Aurora-D — 95 W, compilation et rendu 3D simultanés

| Poste | Puissance | Part |
|---|---|---|
| cœurs P | 29,03 W | 33,2 % |
| GPU (hors matrice) | 28,08 W | 32,1 % |
| cœurs E | 10,23 W | 11,7 % |
| unités matricielles | 5,94 W | 6,8 % |
| horloges, PLL, régulation | 4,95 W | 5,7 % |
| DRAM + PHY | 3,92 W | 4,5 % |
| E/S | 3,80 W | 4,3 % |
| SLC, NoC, liaisons 3D, cœurs L | 1,45 W | 1,7 % |
| **Total** | **87,39 W** | |

### Aurora-S — 420 W, entraînement / inférence IA

| Poste | Puissance | Part |
|---|---|---|
| unités matricielles | 158,84 W | 41,5 % |
| DRAM + PHY (HBM4) | 61,88 W | 16,2 % |
| cœurs P | 53,89 W | 14,1 % |
| horloges, PLL, régulation | 21,65 W | 5,7 % |
| E/S | 16,00 W | 4,2 % |
| L4 | 15,47 W | 4,0 % |
| SLC | 13,61 W | 3,6 % |
| GPU (hors matrice) | 13,03 W | 3,4 % |
| NoC | 13,01 W | 3,4 % |
| cœurs E | 9,35 W | 2,4 % |
| liaisons 3D | 5,81 W | 1,5 % |
| **Total** | **382,56 W** | |

Dans ce scénario, les cœurs CPU **alimentent** les accélérateurs : ils tournent
à 35 % d'activité, pas au plein régime SPEC. Modéliser un serveur IA avec des
cœurs CPU saturés serait une erreur classique, et elle gonflerait le budget de
plus de 70 W.

---

## 11.5 Où va vraiment l'énergie

| Configuration | Hors cœur | Intra-cœur (estimé) | **Total déplacement** |
|---|---|---|---|
| Aurora-M | 1,40 W (12,7 %) | 2,32 W (21,0 %) | **33,7 %** |
| Aurora-D | 5,35 W (6,1 %) | 29,32 W (33,5 %) | **39,7 %** |
| Aurora-S | 109,77 W (28,7 %) | 94,05 W (24,6 %) | **53,3 %** |

Deux précisions de méthode, parce que ce tableau est facile à mal lire :

1. **Le déplacement intra-cœur est déjà compté** dans la puissance des cœurs et
   du GPU (il est inclus dans leur `C_eff`). Il est isolé ici à titre de
   diagnostic, en retenant la part de 40 % que la littérature attribue aux
   bancs de registres, aux caches privés et aux réseaux d'opérandes dans un
   cœur large ou un GPU.
2. Ces chiffres sont ceux d'une architecture **déjà optimisée** pour le
   déplacement : SLC empilé, TBDR, compression, near-memory. Sans ces choix, le
   poste serait nettement plus lourd — c'est précisément ce que la hiérarchie
   mémoire du document 4 achète.

Sur Aurora-S, **plus de la moitié de l'énergie sert à déplacer des données.**
C'est la validation quantitative de la thèse du dossier : optimiser les unités
de calcul d'une architecture IA, c'est optimiser moins de la moitié du problème.

---

## 11.6 Débit de calcul

| | Aurora-M | Aurora-D | Aurora-S |
|---|---|---|---|
| GPU FP32 | 2,46 TFLOP/s | 14,75 TFLOP/s | 29,49 TFLOP/s |
| GPU FP16 | 4,92 TFLOP/s | 29,49 TFLOP/s | 58,98 TFLOP/s |
| GPU MXFP4 | 78,6 TFLOP/s | 471,9 TFLOP/s | 943,7 TFLOP/s |
| Matrice CPU MXFP4 | 39,3 TFLOP/s | 167,1 TFLOP/s | 891,3 TFLOP/s |
| Indice SPECint2017 cumulé (indicatif) | 62 | 214 | 818 |

L'indice cumulé additionne les contributions théoriques des cœurs. Il ne
prédit aucun score réel : il sert uniquement à comparer les configurations
entre elles.

---

## 11.7 Efficacité IA, deux régimes qu'il ne faut pas confondre

### (a) Régime limité par le calcul — GEMM de grande taille

Repère publié le plus favorable, sur un prototype de recherche :
**4,07 TOPS/W en MXFP4**. Une cible très au-delà ne serait pas défendable.

| | TOPS soutenus | TOPS/W sous-système | TOPS/W **système** |
|---|---|---|---|
| Aurora-M | 73,1 | 5,33 | 6,64 (sur 11 W) |
| Aurora-D | 396,2 | 5,33 | 4,53 (sur 87 W) |
| Aurora-S | 1 137,7 | 5,63 | 2,97 (sur 383 W) |

Soit **1,3 à 1,4× le meilleur prototype publié** au niveau du sous-système
matriciel. Ce qui justifie cet écart, et rien de plus : un procédé plus
avancé, et l'absence de NPU séparé (pas de chemin de données dupliqué).

La colonne « système » est celle qu'un acheteur constate, puisqu'il paye la
prise murale. Elle est plus basse, et c'est normal : elle inclut les cœurs, la
mémoire, les E/S. **Communiquer le chiffre du sous-système en le présentant
comme celui du système est la tromperie la plus répandue du secteur.**

Remarque sur Aurora-M : un GEMM soutenu y demande 13,7 W, à comparer à une
enveloppe de 15 W. En pratique, l'inférence soutenue sur mobile sera **limitée
par la thermique**, pas par le silicium. C'est vrai de toutes les puces
mobiles, et il vaut mieux le dire.

### (b) Régime limité par la mémoire — décodage d'un LLM

Modèle de 7 milliards de paramètres en MXFP4, soit 3,5 Go de poids à relire
**à chaque token**. Le calcul est négligeable ; tout se joue sur le chemin des
données.

| Chemin (Aurora-S) | Énergie / token | Gain |
|---|---|---|
| Naïf : HBM → SLC → NoC → unités | 71,82 mJ | — |
| Étagement L4 (poids servis depuis le L4) | 27,52 mJ | ×2,6 |
| GEMV près de la mémoire | 49,22 mJ | ×1,5 |
| **L4 + near-memory (point de conception Aurora-S)** | **8,20 mJ** | **×8,8** |

Le gain combiné est très supérieur à la somme des gains isolés, et la raison
est structurelle : **le L4 et les unités de proximité vivent tous deux sur le
die de base.** Les poids ne quittent jamais ce die — ni NoC, ni liaison
verticale, ni SLC. C'est l'argument central en faveur du die de base actif
(§5.1), et il ne se voit qu'en modélisant les deux mécanismes ensemble.

Plafond de débit imposé par la bande passante : 2 286 tokens/s sur Aurora-S,
131 sur Aurora-D, 66 sur Aurora-M (pour un seul flux, sans lot).

---

## 11.8 Propagation d'incertitude (20 000 tirages)

| Grandeur | p05 | Médiane | p95 |
|---|---|---|---|
| IPC (SPECint2017/GHz) | 2,71 | **2,87** | 3,03 |
| Fréquence boost (GHz) | 3,67 | **4,06** | 4,30 |
| SPECint2017 mono-cœur | 10,40 | **11,62** | 12,65 |
| Puissance cœur P en boost (W) | 3,17 | **3,87** | 4,77 |

La distribution de fréquence est volontairement **asymétrique vers le bas** :
rater la fréquence visée est l'échec le plus fréquent d'un premier silicium
(§9.8). Celle de la puissance est asymétrique vers le haut, pour la raison
symétrique.

Lecture : dans 90 % des tirages, le cœur P se situe entre 10,4 et 12,7 en
SPECint2017 mono-cœur. C'est l'intervalle qu'il faut retenir, **pas la
médiane**.

---

## 11.9 Falsifiabilité

| Cible | Mesure qui la réfute | Jalon | Seuil d'échec |
|---|---|---|---|
| IPC 2,87 | simulateur cycle-accurate calibré sur RTL | M14 | < 2,6 → revoir l'architecture |
| Fréquence 4,2 GHz | navette MPW | M24 | < 3,8 GHz → revoir le pipeline |
| Puissance cœur P | extraction post-layout puis mesure MPW | M26 | > +30 % → revoir le mix de Vt |
| Traduction x86 < 25 % | prototype de traducteur sur simulateur | M18 | > 35 % → renforcer `Xaurx86` |
| 5,3 TOPS/W MXFP4 | noyaux GEMM réels sur FPGA | M26 | < 4,0 → revoir l'unité matricielle |
| Gain décodage ×8,8 | noyau de décodage sur émulateur | M30 | < ×4 → revoir L4 et near-memory |
| Déplacement < 40 % (Aurora-D) | compteurs d'activité sur émulateur | M30 | > 50 % → revoir la hiérarchie |

---

## 11.10 Ce que ce modèle ne peut pas faire

Il faut être précis sur ses limites, sinon il devient dangereux :

1. **Il ne simule pas.** Aucun effet de cache réel, aucune contention, aucune
   interaction entre threads, aucun comportement de charge réelle. Un
   simulateur cycle-accurate donnera des chiffres différents, et ce sont eux
   qui compteront.
2. **L'IPC est construit, pas mesuré.** Les contributions sont des estimations
   issues de la littérature et de l'expérience du domaine. Elles peuvent se
   recouvrir plus que la décote ne le suppose.
3. **`C_eff` est le paramètre le plus fragile.** Il est extrapolé de dies
   publiés, dont les conditions de mesure sont incomplètement connues. Une
   erreur de 30 % sur ce seul paramètre décale tous les budgets de puissance.
4. **Aucun effet de second ordre** : variabilité du procédé, dégradation en
   température, vieillissement, marges de signoff, pertes de conversion des
   régulateurs au-delà du forfait retenu.
5. **Les comparaisons aux produits existants sont indicatives.** Les
   revendications constructeurs ne sont pas mesurées dans des conditions
   comparables, et les ramener à une base commune introduit une erreur qu'on
   ne sait pas borner.

**Conclusion de méthode :** ce modèle sert à *dimensionner* et à *comparer des
options d'architecture entre elles*. Il ne sert pas à promettre un chiffre à
un client. Un architecte qui confond les deux usages produit une brochure, pas
une conception.

---

**Suite :** [12. Plans de construction](12-plans-de-construction.md) — où ces
chiffres rencontrent les cotes, les watts par millimètre carré et le prix de
revient.
