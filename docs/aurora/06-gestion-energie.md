# 6. Gestion de l'énergie

> La performance est une question d'architecture. L'efficacité énergétique est
> une question de **discipline** : des centaines de décisions qui rapportent 1 à
> 3 % chacune, et qui se composent.

---

## 6.1 D'où vient la consommation

Décomposition d'un SoC moderne, et ce qu'on peut faire sur chaque poste :

| Poste | Part typique | Levier |
|---|---|---|
| Dynamique : commutation logique | 45–55 % | tension, activité, travail inutile |
| Dynamique : horloge (arbre) | 15–25 % | clock gating fin |
| Déplacement de données (fils, PHY) | 15–25 % | hiérarchie mémoire (doc. 4) |
| Fuite statique | 10–20 % | power gating, transistors HVT, Vmin |

Les trois formules qui gouvernent tout :

```
P_dyn   = α · C · V² · f        (activité × capacité × tension² × fréquence)
P_stat  ≈ V · I_fuite(V, T)     (croît fortement avec la température)
E/op    = P / débit             (la vraie métrique)
```

Deux conséquences que les discussions sur les processeurs oublient
régulièrement :

1. **La tension domine** (au carré). Faire tourner deux cœurs à mi-fréquence et
   tension réduite bat un cœur à pleine vitesse, chaque fois que la charge est
   parallélisable. C'est la justification mathématique des cœurs E.
2. **Le travail inutile est le pire poste**, parce qu'il ne figure sur aucune
   fiche technique : spéculation jetée, préchargement inexact, données
   déplacées sans être lues, threads réveillés pour rien.

---

## 6.2 Domaines d'alimentation

![Arbre d'alimentation d'Aurora-D](schemas/07-arbre-alimentation.svg)


| Domaine | Régulation | Plage | Granularité |
|---|---|---|---|
| Chaque cœur P | IVR (LDO numérique) | 0,60–1,05 V | par cœur |
| Grappe de cœurs E | IVR partagé + LDO par cœur | 0,50–0,90 V | par cœur |
| Cœurs L | LDO dédié | 0,45–0,70 V | par domaine |
| Chaque Slice GPU | IVR | 0,55–1,00 V | par slice |
| SLC | IVR | 0,60–0,85 V | par groupe de tranches |
| NoC | IVR | 0,65–0,90 V | global |
| PHY mémoire | LDO | selon standard | par canal |
| Domaine always-on | LDO ultra-basse conso | 0,45 V | — |

**Régulateurs intégrés (IVR) dans le die de base.** Placer la régulation sur la
puce permet des transitions en **moins de 100 ns** au lieu des ~20 µs d'un
régulateur externe. Cela change la nature de la gestion d'énergie : on peut
suivre la charge *instruction par instruction* au lieu de réagir avec un
retard qui interdit toute finesse.

Coût : un IVR a un rendement de ~88–92 %, contre ~93–95 % pour un bon buck
externe. On perd ~4 % en conversion et on gagne beaucoup plus en agilité —
l'échange est largement positif, et c'est pourquoi toute l'industrie y va.

Architecture retenue : buck externe multi-phases vers un rail intermédiaire à
1,2 V, puis IVR par domaine. Le meilleur des deux.

---

## 6.3 DVFS : les points de fonctionnement

Sortie du modèle ([§11.3](11-modele-performance.md)). Référence des colonnes
relatives : cœur P en boost = 100 %.

### Cœur P

| Point | Fréquence | Tension | P_dyn | P_fuite | Total | Perf rel. | Efficacité rel. |
|---|---|---|---|---|---|---|---|
| Boost | 4,2 GHz | 1,00 V | 3,99 W | 0,55 W | **4,54 W** | 100 % | 100 % |
| Nominal | 3,4 GHz | 0,82 V | 2,17 W | 0,25 W | **2,42 W** | 81 % | 152 % |
| Efficace | 2,4 GHz | 0,68 V | 1,05 W | 0,13 W | **1,18 W** | 57 % | 219 % |
| Minimal | 1,2 GHz | 0,60 V | 0,41 W | 0,09 W | **0,50 W** | 29 % | 261 % |

### Cœur E

| Point | Fréquence | Tension | P_dyn | P_fuite | Total | Perf rel. | Efficacité rel. |
|---|---|---|---|---|---|---|---|
| Max | 2,8 GHz | 0,78 V | 0,58 W | 0,06 W | **0,64 W** | 41 % | 294 % |
| **Efficace** | 1,2 GHz | 0,55 V | 0,12 W | 0,02 W | **0,14 W** | 18 % | **562 %** |
| Minimal | 0,6 GHz | 0,48 V | 0,05 W | 0,01 W | **0,06 W** | 9 % | 664 % |

Lecture : **un cœur E à son point d'efficacité fait 5,6× mieux par joule qu'un
cœur P en boost**, et à surface égale quatre cœurs E délivrent 1,65× le débit
d'un cœur P pour 56 % de sa puissance. Toute la politique d'ordonnancement en
découle.

### La granularité qui compte

- Changement de fréquence : **< 100 ns** (PLL à verrouillage rapide + horloge
  adaptative).
- Changement de tension : **< 2 µs** pour 100 mV.
- Décision du gouverneur : toutes les **50 µs** en régime normal, **10 µs** en
  mode réactif.

---

## 6.4 Clock gating et power gating

### Clock gating

Objectif : **> 92 % des bascules sous porte d'horloge**, avec trois niveaux
(bascule, bloc, arbre régional). L'arbre d'horloge représente 15 à 25 % de la
puissance d'un SoC moderne ; c'est la première économie, et elle est
essentiellement gratuite au niveau du flot de synthèse.

Mesure qualité : une revue de couverture de clock gating est un livrable de
chaque bloc RTL, avec seuil bloquant à 90 % (document 9).

### Power gating et états de repos

| État | Description | Latence de sortie | Puissance résiduelle (cœur P) |
|---|---|---|---|
| C0 | actif | — | selon DVFS |
| C1 | horloge coupée | 10 ns | ~18 % |
| C2 | horloge coupée + tension réduite | 200 ns | ~7 % |
| C3 | rétention (registres conservés) | 3 µs | ~2 % |
| C6 | coupé, état sauvegardé en SRAM | 25 µs | ~0,1 % |
| C10 | grappe entière coupée | 120 µs | ~0 |

**La décision d'entrée en C6 est la plus délicate.** Y entrer trop tôt coûte
plus en transition qu'on n'économise. Aurora calcule un **seuil de rentabilité
énergétique** dynamique : on entre en C6 uniquement si la durée d'inactivité
prédite dépasse le point mort. Le prédicteur d'inactivité est un compteur à
saturation par cœur alimenté par l'historique des périodes d'inactivité — un
mécanisme simple et éprouvé, pas une innovation, mais correctement calibré.

---

## 6.5 Le gouverneur prédictif

Un microcontrôleur dédié dans le die de base (un cœur Aurora-L à 400 MHz,
128 Ko de SRAM) exécute la politique de puissance.

### Entrées, toutes les 10 µs

| Signal | Source |
|---|---|
| IPC par cœur | compteurs `Xaurpm` |
| MPKI L2 et SLC | compteurs de cache |
| Occupation des files | ordonnanceurs |
| Fraction vectorielle/matricielle | décodage |
| Température par tuile | 64 capteurs par die |
| Courant par domaine | capteurs des IVR |
| Profondeur des files d'exécution OS | interface noyau |
| État de charge de la batterie | PMIC |

### Modèle de décision

Un **arbre de décision à gradient** (32 arbres, profondeur 6) quantifié en
INT8, entraîné hors ligne sur des traces de charges réelles, et exécuté en
~4 µs sur le microcontrôleur.

Sorties : point DVFS par domaine, suggestion de placement de thread (transmise
à l'OS, jamais imposée), état de repos cible, seuils de limitation thermique.

**Précisions nécessaires**, parce que le terme « IA » est galvaudé :

- Ce n'est **pas** un réseau de neurones profond, encore moins un modèle de
  langage. C'est un classifieur de quelques kilo-octets.
- Il est **déterministe** et **bornée en temps** : une décision en moins de
  10 µs, garantie.
- Il est **doublé d'une politique de repli** classique à seuils, utilisée au
  démarrage, en cas de charge inconnue, et en mode certifié (certains domaines
  industriels exigent un comportement analysable).
- Son entraînement est **reproductible et versionné** : le modèle fait partie
  du firmware, signé, avec le jeu de traces d'entraînement archivé.

Gain attendu face à un gouverneur à seuils bien réglé : **6 à 12 %** d'énergie
sur charges mixtes. Modeste en apparence, mais c'est l'équivalent d'un demi-nœud
de procédé, pour un coût en surface de ~0,3 mm².

---

## 6.6 Horloge adaptative et suppression des marges

Tout processeur fonctionne avec une **marge de tension** pour survivre aux
chutes de tension transitoires (*droop*) quand l'activité augmente brutalement.
Cette marge coûte typiquement 5 à 10 % de tension, soit 10 à 20 % de puissance
dynamique — dépensés en permanence pour un événement rare.

Aurora installe :

1. Des **détecteurs de droop** (16 par cœur) qui mesurent le délai de chemins
   critiques répliqués.
2. Une **horloge adaptative** qui étire la période en quelques cycles lorsqu'un
   droop est détecté, au lieu de forcer une marge permanente.
3. Un **limiteur de dI/dt** : le matériel détecte un changement d'activité
   brutal (sortie de repos, début de boucle matricielle) et **rampe**
   l'activité sur quelques centaines de cycles.

Gain : suppression d'environ **5 % de marge de tension**, soit ~10 % de
puissance dynamique. C'est l'un des meilleurs rapports gain/complexité du
dossier.

Le backside power delivery d'A16, employé dans le die de base (§12.3),
contribue au même objectif par un autre
chemin : en réduisant la résistance du réseau d'alimentation, il réduit le
droop à la source.

---

## 6.7 Budget de puissance détaillé

Les trois budgets détaillés sont produits par le modèle et présentés au
[§11.4](11-modele-performance.md). Résumé, avec le scénario de charge qui va
avec — un budget sans scénario ne veut rien dire :

| | Aurora-M | Aurora-D | Aurora-S |
|---|---|---|---|
| Scénario | bureautique mixte | compilation + rendu 3D | entraînement / inférence IA |
| Enveloppe | 15 W | 95 W | 420 W |
| **Total modélisé** | **11,01 W** | **87,39 W** | **382,56 W** |
| Cœurs P | 2,62 W | 29,03 W | 53,89 W |
| Cœurs E | 0,65 W | 10,23 W | 9,35 W |
| GPU hors matrice | 1,81 W | 28,08 W | 13,03 W |
| Unités matricielles | 0,69 W | 5,94 W | 158,84 W |
| Mémoire + PHY | 1,03 W | 3,92 W | 61,88 W |
| SLC + L4 + NoC + liaisons 3D | 0,38 W | 1,43 W | 47,90 W |
| Affichage + E/S | 3,20 W | 3,80 W | 16,00 W |
| Horloges, PLL, régulation | 0,62 W | 4,95 W | 21,65 W |

Trois observations qui méritent plus qu'un tableau :

1. **Aurora-M consomme 11 W dans une enveloppe de 15 W.** Ce n'est pas un
   sous-dimensionnement : l'enveloppe couvre les pointes soutenues, pas l'usage
   courant. Pour l'autonomie, c'est le chiffre de l'usage courant qui compte.
2. **Sur Aurora-S, les cœurs CPU tournent à 35 % d'activité**, parce qu'ils
   alimentent les accélérateurs au lieu d'exécuter du code intensif. Modéliser
   un serveur IA avec des cœurs saturés est une erreur classique qui gonfle le
   budget de plus de 70 W.
3. **Les unités matricielles dominent Aurora-S à 41 %** — et le poste suivant
   n'est pas un autre poste de calcul, c'est la mémoire à 16 %.

Incertitude ±30 % avant RTL. Ces budgets servent à **dimensionner**
(alimentation, refroidissement, packaging), pas à promettre.

---

## 6.8 Course au repos, ou marche lente ?

Question classique : vaut-il mieux finir vite et s'endormir (*race to idle*),
ou aller lentement à basse tension ?

La réponse dépend de deux quantités mesurables :

```
Course au repos gagne si :  P_repos · T_supplémentaire  >  E_économisée_par_V²
```

En pratique :

| Situation | Bonne stratégie |
|---|---|
| Fuite élevée (puce chaude, nœud avancé) | course au repos |
| Fuite faible (puce froide, HVT) | marche lente |
| Tâche avec échéance stricte | course au repos puis repos profond |
| Tâche de fond sans échéance | marche lente sur cœur E |
| Charge en rafales (interface graphique) | course au repos, puis C6 |

Le gouverneur applique cette arbitrage explicitement, avec les valeurs mesurées
en temps réel de la fuite (dérivée des capteurs thermiques et de courant) — pas
une heuristique figée à la conception. La fuite variant d'un facteur 3 entre
25 °C et 95 °C, une politique figée se trompe la moitié du temps.

---

## 6.9 Ordonnancement hétérogène : la partie logicielle

Le matériel expose (§1.9) ; l'OS décide. La politique de référence fournie avec
le portage Linux :

| Type de thread | Placement initial | Règle de migration |
|---|---|---|
| Interactif (a reçu une entrée utilisateur) | cœur P, boost | redescend après 100 ms d'inactivité |
| Fond, sans échéance | cœur E, point efficace | monte sur P si la file d'attente dépasse le seuil |
| Limité par la mémoire (MPKI élevé) | cœur E | **ne jamais promouvoir** : un cœur P n'apportera rien, il attendra plus vite |
| Vectoriel/matriciel soutenu | cœur P (unité matricielle) | |
| Service système, capteurs | cœur L | |
| Temps réel | cœur P, DVFS verrouillé | pas de migration |

La troisième ligne est la plus importante et la plus souvent ratée par les
ordonnanceurs existants : **un thread bloqué sur la mémoire ne profite pas d'un
cœur rapide.** Le champ « prédiction de gain de migration » de `Xaurpm` donne à
l'OS l'information pour ne pas commettre cette erreur — c'est exactement pour
cela qu'il existe.

---

## 6.10 Idle : ce qui se passe quand rien ne se passe

Un ordinateur passe l'essentiel de sa vie à ne rien faire. L'énergie consommée
au repos détermine l'autonomie réelle bien plus que les performances de pointe.

| État système | Consommation cible (Aurora-M) |
|---|---|
| Écran allumé, interface statique | 1,2 W |
| Écran éteint, réseau actif | 180 mW |
| Veille moderne (notifications) | 45 mW |
| Veille profonde | 6 mW |

Mécanismes pour y parvenir :

- **Cohérence de l'affichage en veille** : un tampon d'image compressé permet
  de rafraîchir un écran statique sans réveiller ni le GPU ni la DRAM.
- **Regroupement des interruptions** : le matériel agrège les interruptions à
  faible priorité dans une fenêtre de 10 ms. Chaque réveil évité, c'est une
  transition C6→C0 non payée.
- **Réveil sélectif** : seul le domaine always-on traite les événements réseau
  et capteurs. Le reste ne se réveille que si l'événement l'exige réellement.
- **Auto-rafraîchissement DRAM partiel** : seules les banques contenant des
  données vivantes sont rafraîchies, le noyau compactant la mémoire avant la
  veille.

---

**Suite :** [7. Sécurité](07-securite.md)
