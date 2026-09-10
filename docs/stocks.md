# Stocks et lots

## 1. La question à laquelle ça répond

Ce n'est pas « combien me reste-t-il ». C'est celle que pose un contrôle :

> **Quel lot a été appliqué sur quelle parcelle, et d'où venait-il ?**

Un registre qui note « Karaté Zéon, 0,075 L/ha » sans numéro de lot n'y répond
pas. Le chaînage achat → lot → traitement → parcelle est la raison d'être de ce
module ; le solde n'en est qu'un sous-produit.

---

## 2. Ce que Parcelys ne dira jamais

**Il ne dira pas que le stock affiché est le stock réel.** C'est le solde des
**mouvements enregistrés**. Un bidon entamé sans saisie reste compté ; un achat
oublié manque. L'écran l'affiche en toutes lettres, au-dessus du premier
chiffre.

Présenter ce solde comme un inventaire serait exactement le genre d'information
fabriquée que le projet s'interdit partout ailleurs.

---

## 3. Pourquoi une somme, et pas un compteur

Le solde n'est **jamais stocké**. Il est recalculé à chaque lecture, en
additionnant les mouvements.

Un champ « quantité restante » mis à jour à chaque écriture finit toujours par
mentir : une écriture ratée, une reprise de sauvegarde, un import, et le chiffre
affiché ne correspond plus à rien — sans que rien ne le signale. La somme, elle,
est exacte par construction.

Les quantités sont donc **signées** : positives à l'entrée, négatives à la
sortie. Le solde est un `SUM`, pas un calcul à branches. C'est aussi ce qui
permet à l'ajustement d'inventaire d'aller dans les deux sens sans champ
supplémentaire à tenir cohérent.

L'interface, elle, fait saisir « 20 litres sortis » — jamais « −20 ». La
conversion se fait en un seul endroit (`quantiteSignee`).

---

## 4. Les unités : ce qui se convertit et ce qui ne se convertit pas

| Famille | Unités | Se convertissent entre elles |
| --- | --- | --- |
| Volume | mL, cL, dL, L, hL, m³ | oui |
| Masse | mg, g, kg, q, t | oui |
| Dénombrables | unité, dose, sac, bidon, palette, big-bag | **non**, sauf avec elles-mêmes |

**Une masse ne se convertit jamais en volume.** Cela supposerait une densité que
Parcelys ne connaît pas : elle varie d'un produit à l'autre et l'étiquette ne la
donne pas toujours. Une conversion approximative sortirait un solde faux — et un
solde faux sur un produit phytosanitaire, c'est un écart de traçabilité lors
d'un contrôle.

Face à deux unités incomparables, Parcelys **refuse** le mouvement et dit
pourquoi, plutôt que de rendre un solde partiel qu'il faudrait ensuite
expliquer. Deux dénombrables de noms différents sont refusés pour la même
raison : rien ne dit combien un « sac » vaut de « bidons ».

Quand des mouvements inconvertibles existent déjà en base, le solde les **écarte
et les liste** (`ecartes`), au lieu de les ignorer : un solde amputé sans le dire
vaudrait moins que pas de solde.

---

## 5. Le stock ne se décrémente pas tout seul

Il serait facile de retirer automatiquement du stock à chaque traitement saisi.
Ce serait une erreur : un exploitant qui ne tient pas de stock verrait apparaître
des articles fantômes et des soldes négatifs sur tout ce qu'il enregistre — un
bruit permanent qui masquerait les vrais écarts.

Le rattachement est donc **choisi**. Et pour que ce choix ne devienne pas un trou
silencieux, l'écran liste en premier les **utilisations non rattachées** : les
traitements et apports qui ont consommé un produit suivi en stock sans qu'aucun
lot ne leur soit rattaché.

Ce n'est pas une anomalie réglementaire, c'est un écart de saisie — présenté
comme tel, avec le moyen de le combler. Au rattachement, la quantité est reprise
du registre plutôt que ressaisie : deux chiffres pour le même geste finiraient
par diverger.

---

## 6. Ce qui est refusé, et ce qui ne l'est pas

**Refusé** — tout ce qui rendrait le solde faux ou trompeur :

- une unité inconnue, ou inconvertible vers celle de l'article ;
- un lot appartenant à un autre article ;
- une quantité nulle ;
- un article d'une autre exploitation.

**Autorisé, et signalé** — ce qui relève de la décision de l'exploitant :

- **sortir plus que le solde.** C'est le plus souvent un achat non saisi ;
  refuser produirait un registre incomplet, exactement ce qu'on cherche à
  éviter. Le solde négatif est affiché comme une anomalie, avec sa cause
  probable — pas comme un vol.
- **employer un lot périmé.** Parcelys signale la date dépassée et la quantité
  restante. La décision d'emploi ou d'élimination appartient à l'exploitant.

---

## 7. Alertes

| Code | Niveau | Quand |
| --- | --- | --- |
| `solde-negatif` | anomalie | les sorties dépassent les entrées |
| `unites-melangees` | attention | des mouvements ne sont pas comptés dans le solde |
| `lot-perime` | attention | date limite dépassée **et** il reste du produit |
| `lot-bientot-perime` | information | date limite dans 90 jours ou moins |
| `sous-seuil` | information | sous le seuil **fixé par l'exploitant** |

Un lot périmé mais vide n'est pas signalé : il n'y a plus rien. Et aucun seuil
n'est inventé — sans seuil renseigné, pas d'alerte : un seuil par défaut n'a
aucun sens agronomique.

---

## 8. Vérifier

```bash
# Le calcul lui-même (unités, solde, signes, alertes)
npx vitest run tests/stock.test.ts

# Le chemin complet sur une vraie base : achat → lot → traitement → parcelle,
# cloisonnement entre exploitations, refus, alertes
npm run check:stocks
```

Le second compte autant que le premier. Les tests unitaires prouvent que le
calcul est juste ; ils ne prouvent ni les jointures, ni le cloisonnement entre
exploitations — et c'est là que se logent les erreurs qui comptent. Le script
crée ses propres données (préfixées `VERIF`), y compris le produit et
l'exploitation voisine dont il a besoin : sans eux, la partie la plus importante
ne s'exécuterait pas et l'absence de `✗` passerait pour une réussite.
