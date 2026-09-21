# 10. Feuille de route, organisation et budget

---

## 10.1 Calendrier sur cinq ans

```
Année 1  ├─ Architecture, spécification Sail, simulateur, recrutement
         ├─ LLVM: backend Aurora démarre
         └─ M12 : gel de l'architecture

Année 2  ├─ RTL des cœurs, GPU, die de base
         ├─ Prototype FPGA cœur P
         ├─ M24 : navette MPW (cœur P, PHY, slice GPU)
         └─ Pilote Mesa en amont, prototype de traduction binaire

Année 3  ├─ Intégration SoC, émulation, Linux démarre (M28)
         ├─ Conformité Vulkan sur émulateur (M30)
         ├─ M33 : gel du RTL
         └─ M36 : TAPE-OUT A0

Année 4  ├─ M41 : retour silicium, bring-up
         ├─ Validation, caractérisation, correctifs
         ├─ M48 : tape-out B0 (correctif + optimisation)
         └─ Échantillons clients

Année 5  ├─ M52 : silicium de production
         ├─ Qualification, certifications, montée en production
         └─ M60 : premier produit commercial (serveur Linux)
```

**Soixante mois du premier jour au premier client.** C'est la durée réaliste.
Les programmes annoncés à trois ans sont soit des dérivés d'une base existante,
soit en retard sans le savoir encore.

---

## 10.2 Jalons décisionnels (go / no-go)

Chaque jalon a un critère quantitatif. Si le critère n'est pas atteint, on
arrête ou on réoriente — pas on continue en espérant.

| Jalon | Échéance | Critère | Si échec |
|---|---|---|---|
| G1 — Architecture | M12 | modèle de perf donne ≥ 2,6 SPECint/GHz avec des hypothèses défendables ; revue externe favorable | réviser l'architecture, +6 mois |
| G2 — Traduction | M18 | prototype x86 sur simulateur sous 35 % de surcoût | renforcer `Xaurx86` avant gel |
| G3 — MPW | M26 | cœur P atteint ≥ 3,8 GHz ; PHY LPDDR6 fonctionnel | revoir le pipeline ou la cible de fréquence |
| G4 — Émulation | M29 | Linux démarre ; conformité Vulkan ≥ 95 % | décaler le tape-out |
| G5 — Gel RTL | M33 | couverture 100 %, zéro bogue bloquant | décaler, jamais geler avec un bloquant |
| G6 — Bring-up | M44 | Linux stable, perf à ±15 % du modèle | analyse de cause, B0 |
| G7 — Production | M56 | rendement ≥ 60 %, qualification passée | ajuster les SKU |

Le critère G1 est le plus important et le plus facile à contourner par
optimisme. Il exige une **revue par des architectes externes** précisément pour
cette raison.

---

## 10.3 Organisation

### Montée en charge

| Fonction | An 1 | An 2 | An 3 | An 4 | An 5 |
|---|---|---|---|---|---|
| Architecture | 35 | 45 | 40 | 30 | 25 |
| RTL CPU | 25 | 70 | 85 | 55 | 40 |
| RTL GPU | 20 | 55 | 70 | 45 | 35 |
| RTL die de base / NoC | 12 | 35 | 40 | 25 | 20 |
| Vérification | 30 | 110 | 160 | 110 | 70 |
| Physical design | 8 | 40 | 75 | 50 | 40 |
| DFT | 5 | 18 | 25 | 20 | 15 |
| Packaging / thermique | 4 | 12 | 18 | 15 | 12 |
| Compilateurs | 22 | 45 | 55 | 50 | 45 |
| Noyau / OS | 15 | 40 | 55 | 55 | 50 |
| **Pilote graphique** | 12 | 35 | 45 | 45 | 40 |
| Traduction binaire | 10 | 25 | 30 | 25 | 20 |
| Pile IA | 8 | 25 | 35 | 35 | 30 |
| Firmware / sécurité | 8 | 20 | 28 | 25 | 20 |
| Systèmes / applications | 5 | 15 | 30 | 45 | 55 |
| Support (RH, achats, juridique, PI) | 15 | 30 | 45 | 50 | 50 |
| **Total** | **234** | **620** | **836** | **680** | **567** |

Personnes-années cumulées : **~2 940**.

### Ce que ces chiffres disent

- **La vérification est le premier poste.** 480 personnes-années. Quiconque
  budgète un processeur sans cela se trompe d'un facteur 2.
- **Le logiciel dépasse le RTL** dès l'année 2 et ne redescend jamais.
- **L'équipe décroît après le tape-out**, mais pas de beaucoup : la validation,
  le B0 et la préparation de la génération suivante absorbent la capacité.

### Répartition géographique

Un site principal (architecture, RTL, intégration), deux sites secondaires
(vérification, logiciel). Répartir le RTL sur plus de deux sites coûte plus en
coordination que ce qu'il apporte en accès aux talents — un enseignement
constant du secteur.

---

## 10.4 Budget

### Hypothèses

- Coût chargé par personne-année : 250 k$ (moyenne mondiale pondérée pour de
  l'ingénierie silicium et logicielle senior).
- Estimations de coût de conception 2 nm : ordre de **725 M$** pour un design
  complet, EDA, IP, masques et validation inclus. C'est une estimation
  d'analystes, pas un tarif.

### Détail sur cinq ans

| Poste | Coût | Notes |
|---|---|---|
| Personnel (2 940 pers.-an × 250 k$) | **735 M$** | poste dominant |
| Licences EDA | 95 M$ | synthèse, P&R, signoff, formel, émulation |
| Émulateur matériel | 28 M$ | achat + maintenance |
| Ferme FPGA | 12 M$ | ~300 cartes |
| Ferme de calcul | 45 M$ | ~40 000 cœurs en pointe + stockage |
| IP tierce (PHY, contrôleurs, USB, PCIe) | 75 M$ | ne pas réinventer les PHY |
| Masques N2P (3 chiplets logiques) | 65 M$ | |
| Masques N6/N5 (die de base, IOD, L4) | 30 M$ | |
| Navette MPW | 8 M$ | |
| **Respin A0→A1 (provision)** | **25 M$** | 50 % de probabilité, provisionné à 100 % |
| Tape-out B0 | 45 M$ | |
| Wafers de prototypage et validation | 38 M$ | |
| Développement du packaging | 32 M$ | hybrid bonding, CoWoS |
| Certifications (Khronos, PCI-SIG, JEDEC, sécurité) | 12 M$ | |
| Ferme de construction pour l'amont | 4 M$ | le meilleur rapport adoption/coût |
| Juridique, PI, brevets, liberté d'exploitation | 28 M$ | |
| Marketing technique, relations développeurs | 22 M$ | |
| **Sous-total** | **1 299 M$** | |
| **Contingence 20 %** | **260 M$** | |
| **TOTAL** | **≈ 1,56 Md$** | |

### Interprétation

Ce chiffre est cohérent avec l'ordre de grandeur publié pour un design 2 nm
(725 M$ pour *un* design), Aurora comptant **six dies distincts**, un GPU
complet et une pile logicielle intégrale. Il est plus élevé que les estimations
minimales parce qu'il inclut ce que celles-ci omettent systématiquement : le
logiciel, la vérification exhaustive, le respin, et l'amorçage de l'écosystème.

**Ce que le budget ne couvre pas :** la production de masse (fonds de
roulement, engagements de capacité chez le fondeur), la distribution, le
support client. Il faut prévoir 300 à 600 M$ supplémentaires pour passer du
premier silicium à un produit livré en volume.

Le **coût de revient unitaire** — nomenclature, rendements par die, assemblage,
test — est établi au [§12.10](12-plans-de-construction.md) : environ 341 $ pour
Aurora-D et 3 283 $ par socket Aurora-S, dont 49 % de HBM4. C'est ce dernier
chiffre qui détermine la marge, et il dépend d'un marché mémoire que le
programme ne contrôle pas.

---

## 10.5 Financement et modèle économique

Trois voies, non exclusives :

| Modèle | Description | Avantage | Risque |
|---|---|---|---|
| **A. Licence d'IP** | vendre les cœurs et le GPU comme IP, façon Arm | capital requis divisé par ~3, revenus plus tôt | marge limitée, dépendance aux clients |
| **B. Fabless produit** | vendre des puces | marge, contrôle | capital, accès au packaging, force de vente |
| **C. Consortium** | co-financement par plusieurs acheteurs (cloud, souveraineté) | risque partagé, clients garantis dès le départ | gouvernance lente, compromis techniques |

**Recommandation : C puis B.** Amorcer par un consortium d'acheteurs (opérateurs
de cloud, acteurs publics de souveraineté numérique) qui garantit un volume
initial, puis basculer sur un modèle produit une fois l'écosystème établi. Le
modèle A reste disponible comme source de revenus complémentaire sur les cœurs
E et L, qui intéressent l'embarqué.

Le marché a une raison structurelle d'accueillir un troisième acteur : la
dépendance à deux fournisseurs x86 et à un détenteur d'ISA Arm est devenue un
sujet de politique industrielle dans plusieurs régions, et RISC-V est
précisément la réponse qui ne dépend de personne.

---

## 10.6 Analyse des risques

| Risque | Probabilité | Impact | Exposition | Mitigation |
|---|---|---|---|---|
| Pilote graphique en retard | 70 % | critique | **très élevée** | 40 pers. dès M0, conformité en CI, repli logiciel |
| Capacité de packaging avancé indisponible | 45 % | critique | **très élevée** | réservation contractuelle en amont ; variante de repli sans empilement L4 |
| Fréquence sous la cible | 60 % | moyen | élevée | gamme de SKU ; le modèle de perf ne repose pas que sur la fréquence |
| Respin nécessaire | 50 % | moyen | moyenne | budgété |
| Traduction binaire décevante | 30 % | élevé | moyenne | jalon G2 à M18 avec décision avant gel |
| Dérive budgétaire > 30 % | 40 % | élevé | élevée | jalons go/no-go, contingence 20 % |
| Concurrence prend deux générations d'avance | 35 % | élevé | moyenne | avantage structurel sur la perf/W, pas sur la perf brute |
| Fragmentation RISC-V | 25 % | élevé | moyenne | conformité stricte, participation aux groupes de travail |
| Départ d'ingénieurs clés | 50 % | moyen | moyenne | documentation, revues croisées, pas de point de défaillance unique |
| Litige de propriété intellectuelle | 30 % | élevé | moyenne | analyse de liberté d'exploitation dès l'année 1, budget juridique |

Les deux risques en tête ne sont **pas** des risques de conception. Ce sont un
risque logiciel et un risque industriel. C'est presque toujours le cas, et
c'est presque toujours sous-estimé dans les plans initiaux.

---

## 10.7 Ce qui pourrait rendre le projet inutile

Un exercice d'honnêteté rarement fait : qu'est-ce qui, en cinq ans, rendrait
cette architecture sans objet ?

1. **Un saut de performance des concurrents supérieur à l'avance visée.** Si
   les acteurs établis gagnent 2× en perf/W d'ici 2031, l'avantage disparaît.
   *Atténuation partielle :* les gains de procédé sont partagés par tous ; notre
   avantage vient d'un choix d'architecture (hiérarchie mémoire, front-end bon
   marché) qu'ils ne peuvent pas adopter sans casser leur compatibilité.
2. **Un changement de paradigme de calcul** (optique, analogique pour l'IA,
   neuromorphique) qui rende l'architecture von Neumann marginale sur les
   charges dominantes. *Probabilité faible à cinq ans, réelle à quinze.*
3. **Un effondrement de la demande de calcul local** au profit d'un modèle
   entièrement infonuagique. *Improbable : la latence, le coût et la
   confidentialité poussent dans l'autre sens.*
4. **L'écosystème RISC-V se fragmente** au point de perdre sa promesse de
   binaire unique. *C'est le risque le plus réel des quatre, et il se combat par
   la participation aux instances de standardisation, pas par la technique.*

---

## 10.8 Critère de succès

À M60, le programme est un succès si, et seulement si :

- [ ] Aurora-S se vend chez au moins trois opérateurs, avec un avantage mesuré
      de perf/W **supérieur à 30 %** sur au moins deux charges de production
      réelles, mesuré par le client, pas par nous.
- [ ] Debian et Fedora publient des images Aurora officielles avec ≥ 95 % des
      paquets.
- [ ] Le pilote graphique est conforme Vulkan 1.4 et fusionné dans Mesa amont.
- [ ] Le surcoût de traduction x86 est inférieur à 25 % sur une suite
      d'applications réelles publiée.
- [ ] Au moins dix contributeurs externes significatifs travaillent sur la pile
      logicielle.
- [ ] `Xaurmt` est soit en voie de standardisation RISC-V, soit remplacé par le
      standard ratifié avec un chemin de migration livré.

Aucun de ces critères n'est un chiffre de benchmark de lancement. Ce sont des
critères d'**écosystème**, parce que c'est ce qui détermine si une architecture
existe encore à dix ans.

---

**Suite :** [11. Modèle de performance](11-modele-performance.md)
