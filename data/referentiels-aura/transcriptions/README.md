# Transcriptions des textes réglementaires d'Auvergne-Rhône-Alpes

Les arrêtés sont publiés en PDF. Parcelys n'en lit pas le texte à l'exécution :
leurs règles sont **transcrites ici**, une fois, en JSON structuré, puis
importées en base par `npm run referentiels:aura`.

| Fichier | Texte | Format |
| --- | --- | --- |
| `par7-aura.json` | PAR7 — arrêté n° 24-135 du 19/07/2024 modifié par le n° 24-162 du 12/09/2024, annexes 2A, 2B, 2C | `parcelys-transcription/1` |
| `zar-aura.json` | Annexe 1 du PAR7 modifiée — captages classés en zone d'actions renforcée | `parcelys-transcription-zar/1` |
| `gren-aura.json` | GREN — arrêté n° 24-147 du 07/08/2024 et ses 21 fiches techniques | `parcelys-transcription/1` |

## Ce que porte une règle

```json
{
  "code": "periode-interdiction-epandage",
  "libelle": "…",
  "domaine": "NITRATES",
  "depuis": "2024-09-01",
  "jusquau": null,
  "condition": { "zone": "ZONE_VULNERABLE", "typesFertilisant": ["III"] },
  "valeur": { "periodes": [{ "du": "02-15", "au": "02-28" }] },
  "unite": null,
  "exception": "…",
  "source": { "document": "par7", "article": "art. 2, I, 1°, tableau 1", "page": 4, "citation": "…" }
}
```

- `depuis` / `jusquau` : la période où la règle s'applique. Une règle modifiée
  par un arrêté ultérieur prend une nouvelle entrée avec sa propre date ;
  l'ancienne reste, pour les campagnes passées.
- `source.document` renvoie à un document déclaré en tête du fichier, avec son
  **chemin et son empreinte SHA-256** : l'import vérifie chaque PDF cité et
  s'arrête s'il a changé.
- `source.citation` est **le texte mot pour mot** ; c'est elle que l'écran affiche
  sous « Ce que dit le texte ».
- `manques` (en tête de fichier) liste ce que le texte renvoie ailleurs ou ce qui
  n'a pas été fourni, avec la conséquence : ces manques s'affichent sur la page
  des référentiels.

## Règles de transcription

1. **Rien n'est complété.** Une cellule vide d'un tableau reste `null` ; une
   valeur renvoyée à un autre texte (programme national, tableau Arvalis) n'est
   pas recopiée d'ailleurs : elle devient un manque.
2. **Une ambiguïté du texte est transcrite comme telle** (`ambigus`), avec
   l'explication — le moteur ne la tranche pas.
3. **Les tableaux en image** ont été lus sur l'image à haute résolution, et
   marqués `lecture`. Les tableaux du GREN ont été vérifiés automatiquement
   contre le texte des PDF (597 lignes, 622 valeurs, aucun écart).
4. **Toute modification** d'une transcription se refait depuis le PDF, et se
   vérifie par les tests (`tests/programme-actions.test.ts`,
   `tests/gren-calcul.test.ts`), qui chargent ces fichiers tels quels.
