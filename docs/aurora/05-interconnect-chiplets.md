# 5. Interconnexion, chiplets et packaging

---

## 5.1 Le die de base actif : la décision centrale

![Coupe du package Aurora-D](schemas/01-coupe-package.svg)


La plupart des architectures à chiplets juxtaposent des dies sur un interposeur
**passif** et les relient latéralement (UCIe, Infinity Fabric). Aurora fait
l'inverse : un **die de base actif**, sur lequel tous les chiplets logiques
sont empilés par hybrid bonding.

```
       ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
       │ CCD-P│ │ CCD-P│ │ CCD-E│ │ GCD  │   ← chiplets logiques (N2P/A16)
       └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘
   ════════╪════════╪════════╪════════╪══════  hybrid bonding, pas ~6–9 µm
       ┌───┴────────┴────────┴────────┴────┐
       │        DIE DE BASE (N5/N6)        │
       │  NoC maillé · SLC · répertoire    │
       │  ctrl. mémoire · near-memory      │
       └──────────────┬────────────────────┘
                      │ UCIe 3.0 (latéral, hors package)
                 ┌────┴────┐
                 │  IOD    │  PCIe 6, CXL 3.1, USB4v2, réseau
                 └─────────┘
```

### Le calcul qui justifie ce choix

| Chemin | Énergie par bit | Bande passante atteignable | Latence ajoutée |
|---|---|---|---|
| Hybrid bonding vertical | ~0,05 pJ/bit | > 2,5 To/s | ~1 ns |
| UCIe avancé (latéral) | ~0,25–0,5 pJ/bit | ~0,5–1 To/s par module | ~5–10 ns |
| Sérialiseur hors package | ~2–5 pJ/bit | — | ~30 ns+ |

Sur Aurora-D, le trafic chiplet↔die de base est estimé à ~6 To/s en pointe,
soit 48 Tb/s :

- en hybrid bonding : 48 × 10¹² × 0,05 × 10⁻¹² = **2,4 W** ;
- en UCIe latéral à 0,3 pJ/bit : **14,4 W**.

**12 watts d'écart sur une enveloppe de 65 W.** C'est la décision
d'architecture la plus rentable du dossier, et elle ne coûte rien en
performance — au contraire, elle réduit aussi la latence.

Le prix à payer est réel et doit être dit : le hybrid bonding impose des
contraintes thermiques (le die logique chaud est *au-dessus*, mais il est aussi
collé au die de base), des contraintes de test (il faut tester les dies avant
empilement, *known good die*), et un rendement d'assemblage à maîtriser. Le
document 9 traite ces points.

---

## 5.2 Le réseau sur puce

**Topologie : maille 2D** sur le die de base.

| Paramètre | Valeur |
|---|---|
| Topologie | maille 2D, 4 × 4 (Aurora-D), 6 × 6 par quadrant (Aurora-S) |
| Largeur de lien | 512 bits par direction |
| Fréquence | 2,0 GHz |
| Bande passante par lien | 128 Go/s par direction |
| Bissection (Aurora-D) | ~1,5 To/s |
| Routage | dimension-ordonné (XY), sans interblocage par construction |
| Canaux virtuels | 4 (requête, réponse, snoop, priorité) |
| Contrôle de flux | crédits, commutation par wormhole |
| Latence par saut | 2 cycles |

**Pourquoi une maille et pas un anneau ni un crossbar ?** L'anneau ne passe pas
l'échelle en latence (O(N) sauts). Le crossbar ne passe pas l'échelle en
surface ni en énergie (O(N²)). La maille est en O(√N) en latence et O(N) en
surface : c'est le compromis qui tient de 8 à 100 nœuds, et Aurora doit couvrir
cette plage avec un seul design.

**Économies d'énergie du NoC :**
- Liens en *low-swing* : ~40 % de l'énergie de commutation en moins.
- Portes d'horloge par canal virtuel.
- Extinction des liens inutilisés après 1 µs d'inactivité, réveil en 20 ns.
- Encodage à inversion de bus pour réduire l'activité de commutation.
- **Routage sensible à la localité** : les tranches SLC sont assignées par
  hachage d'adresse *pondéré par la proximité du demandeur habituel*, ce qui
  raccourcit le trajet moyen de ~20 % face à un hachage uniforme.

---

## 5.3 Catalogue de chiplets

| Chiplet | Contenu | Procédé | Cotes | Surface |
|---|---|---|---|---|
| **CCD-P** | 8 cœurs P, 16 Mo L2, 4 unités matricielles | N2P | 8,60 × 7,20 mm | 61,9 mm² |
| **CCD-E** | 16 cœurs E, 4 Mo L2, 4 unités matricielles | N2P | 9,50 × 4,00 mm | 38,0 mm² |
| **GCD-4** | 4 Slices GPU | N2P | 9,40 × 8,30 mm | 78,0 mm² |
| **BASE-M** | SLC 32 Mo, NoC 3 × 3, 4 ctrl. LPDDR6, near-memory | N6 | 11,40 × 11,40 mm | 130 mm² |
| **BASE-D** | SLC 64 Mo, NoC 4 × 4, 8 ctrl. LPDDR6, 16 IVR | N6 | 20,50 × 20,50 mm | 420 mm² |
| **BASE-S** | SLC 128 Mo, NoC 6 × 6, 4 ctrl. HBM4, 24 IVR | N5 | 21,90 × 21,90 mm | 480 mm² |
| **L4** | 512 Mo de SRAM | N6 | 13,40 × 13,40 mm | 180 mm² |
| **IOD** | PCIe 6, CXL 3.1, USB4v2, réseau, affichage, sécurité | N6 | 9,60 × 7,30 mm | 70 mm² |

### Compositions produit

| Produit | Assemblage | Silicium logique porté |
|---|---|---|
| Aurora-M | 1 BASE-M + 1 CCD-P trié à 4P + 1 CCD-E trié à 8E + 1 GCD-2 | 89 mm² |
| Aurora-D | 1 BASE-D + **2 CCD-P** + 1 CCD-E + 2 GCD-4 + 1 IOD | 318 mm² |
| Aurora-S | **2 × BASE-S**, chacun + 4 CCD-P + 1 CCD-E + 2 GCD-4 + 1 L4 + 1 IOD | 884 mm² |

**La taille du die de base n'est pas un choix.** Il doit être au moins aussi
grand que la somme des chiplets qu'il porte : c'est ce qui fixe BASE-D à
420 mm², et non les 150 mm² que le contenu fonctionnel suggérerait. Pour
Aurora-S, 884 mm² de chiplets dépassent la limite de réticule, d'où **deux
quadrants** sur interposeur CoWoS-L, reliés par un pont UCIe-A — ce qui fait
d'Aurora-S une machine NUMA à deux nœuds. Les plans cotés sont au
[document 12](12-plans-de-construction.md).

Les SKU à 12 cœurs P d'Aurora-D sont obtenus par **tri** de deux CCD-P dont
deux cœurs sont désactivés chacun, pas par un CCD-P unique.

### Ce que les chiplets rapportent vraiment

**Rendement.** Le rendement décroît exponentiellement avec la surface. Avec le
modèle de Murphy, `Y = [(1 − e^(−AD₀)) / (AD₀)]²`, et une densité de défauts
D₀ = 0,15/cm² (hypothèse d'un nœud N2 encore jeune au moment du lancement) :

| Surface du die | Rendement estimé |
|---|---|
| 62 mm² (CCD-P) | ~91 % |
| 620 mm² (monolithique équivalent) | ~42 % |

Sur un N2 mûri (D₀ = 0,07/cm²), l'écart se resserre — 96 % contre 66 % — mais
ne disparaît pas.

Le coût du silicium utilisable est donc environ **2× moindre** en chiplets, ce
qui compense largement le surcoût d'assemblage.

**Réutilisation.** Un CCD-P sert aux trois produits. L'effort de conception, de
vérification et de qualification est amorti sur toute la gamme.

**Nœud approprié.** La SRAM et les PHY analogiques ne tirent presque aucun
bénéfice de N2, et son coût par mm² est plusieurs fois celui de N6. Les mettre
sur le die de base est une décision économique évidente une fois qu'on la
formule.

**Binning.** Un CCD-P dont un cœur est défectueux devient un CCD-P à 7 cœurs.
Un die monolithique avec le même défaut est perdu ou fortement déclassé.

---

## 5.4 UCIe 3.0 : là où il sert vraiment

UCIe 3.0 (64 GT/s, publié en août 2025) est utilisé pour :

1. **Die de base ↔ IOD** : le die d'E/S n'a pas à être empilé.
2. **Package ↔ package** sur Aurora-S : relier deux sockets à faible latence.
3. **Chiplets tiers** : c'est l'intérêt stratégique majeur. Un client peut
   attacher son propre accélérateur au die de base d'Aurora via une interface
   standard. Le sideband étendu à 100 mm d'UCIe 3.0 rend ces topologies
   réalisables.

Configuration retenue : UCIe-A (avancé), 64 GT/s, modules de 64 voies, 4
modules par port, soit ~2 To/s par port bidirectionnel.

La recalibration TX en fonctionnement introduite par UCIe 3.0 est exploitée :
elle permet de faire dériver la tension du lien avec la température sans perdre
la marge, donc de fonctionner plus bas en tension nominale.

---

## 5.5 Packaging et thermique

| Élément | Choix |
|---|---|
| Intégration verticale | hybrid bonding (type SoIC), pas ~6–9 µm |
| Substrat | CoWoS-L pour Aurora-S, substrat organique + pont pour M et D |
| Mémoire | sur package (Aurora-M), LPCAMM3 (Aurora-D), HBM4 sur interposeur (Aurora-S) |
| Alimentation | **par la liaison hybride, depuis le die de base** (voir ci-dessous) |
| Régulation | IVR par domaine, dans le die de base, à l'aplomb de la charge |

### Pas de backside power delivery sur les chiplets empilés — et c'est un gain

Un chiplet collé **face à face** au die de base a sa face avant en bas et sa
face arrière contre le dissipateur. Y faire passer un réseau d'alimentation par
l'arrière s'interposerait dans le chemin thermique : le BSPD et cet empilement
sont incompatibles.

Ce n'est pas une concession. L'objectif du BSPD est de retirer le réseau
d'alimentation des couches de routage de signal ; ici, le réseau n'est pas sur
le chiplet **du tout** — il est dans le die de base, avec son régulateur à
~60 µm de la charge, contre plusieurs centimètres pour un régulateur de carte.
Le die de base fait donc ce que fait le BSPD, en mieux.

Le Super Power Rail d'A16 reste employé **à l'intérieur du die de base** et sur
les variantes non empilées. Le détail est au
[§12.3](12-plans-de-construction.md).

### Le problème thermique de l'empilement, traité de front

![Pile thermique et point chaud local](schemas/08-pile-thermique.svg)

Empiler crée un problème réel : le die logique chaud est thermiquement couplé
au die de base, et la chaleur doit traverser l'ensemble pour atteindre le
dissipateur. Quatre mesures :

1. **Le die logique est au-dessus**, côté dissipateur. Le die de base, moins
   dense en puissance (SRAM + PHY), est en dessous.
2. **TSV thermiques** dédiés (sans fonction électrique) dans les zones chaudes,
   ~8 % de la surface du die de base.
3. **Placement des points chauds décalé** : les unités matricielles des CCD-P
   ne sont pas alignées verticalement avec les tranches SLC les plus actives.
   Le floorplan est co-optimisé thermiquement entre les deux dies — ce qui
   n'est possible que parce qu'on conçoit les deux.
4. **Limitation thermique par tuile** : 64 capteurs thermiques par die,
   échantillonnés à 1 MHz, avec limitation localisée plutôt que globale. Brider
   toute la puce parce qu'un bloc chauffe est une perte de performance inutile.

Densité de puissance cible : **< 1,1 W/mm²** sur les chiplets logiques, ce qui
reste gérable avec un refroidissement à air conventionnel. Aurora-S dépasse ce
seuil et prévoit un refroidissement liquide direct, avec une variante à plaque
froide intégrée au couvercle.

---

## 5.6 Latences de bout en bout (estimations)

| Chemin | Latence cible |
|---|---|
| Cœur → L1D | 5 cycles (1,2 ns) |
| Cœur → L2 | 14 cycles (3,3 ns) |
| Cœur → SLC (même quadrant) | ~35 cycles (8,3 ns) |
| Cœur → SLC (traversée) | ~48 cycles (11,4 ns) |
| Cœur → L4 | ~80 cycles (19 ns) |
| Cœur → LPDDR6 | ~90 ns |
| Cœur → HBM4 | ~110 ns |
| Cœur → mémoire CXL | ~300 ns |
| CPU → GPU (message, même package) | ~60 ns |
| Package → package (UCIe) | ~90 ns |

La latence SLC est le chiffre à surveiller : elle détermine directement l'IPC
sur les charges à grand jeu de travail. L'objectif de 35 cycles n'est atteignable
que grâce à la liaison verticale ; en UCIe latéral, il faudrait compter 55 à 65
cycles, ce qui coûterait 3 à 6 % d'IPC sur SPECint.

---

## 5.7 Validation de la stratégie chiplet

Risques identifiés, avec les parades :

| Risque | Gravité | Parade |
|---|---|---|
| Rendement d'assemblage hybrid bonding | élevée | test *known good die* complet avant empilement ; ligne pilote dès M18 |
| Couplage thermique | moyenne | co-optimisation du floorplan, TSV thermiques, limitation par tuile |
| Test après empilement | moyenne | JTAG hiérarchique, BIST par chiplet, ports de test dédiés dans le die de base |
| Capacité de packaging avancé | **élevée** | c'est la contrainte industrielle réelle en 2026 : la capacité CoWoS/SoIC est rare. Réservation contractuelle en amont, et conception d'une variante de repli à empilement réduit |
| Dépendance à un seul fondeur | élevée | die de base portable vers un second fondeur (conception avec IP de fonderie standard) |

Le risque de capacité de packaging est traité au document 10 comme un risque
de programme de premier rang, au même titre que le budget. Ce n'est pas un
détail d'exécution : en 2026, l'accès au packaging avancé conditionne davantage
un calendrier que l'accès aux wafers.

---

**Suite :** [6. Gestion de l'énergie](06-gestion-energie.md)
