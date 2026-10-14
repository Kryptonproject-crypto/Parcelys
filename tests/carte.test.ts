import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOND_PLAN_DEFAUT,
  FOND_SATELLITE,
  STYLE_PARCELLE,
  STYLE_PARCELLE_CHOISIE,
  lignesDEtiquette,
} from '@/lib/shared/carte';

/*
 * ───────────────────────────────────────────────────────────────────────────
 * Une seule carte, deux écrans
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Le site et l'application de terrain dessinent les mêmes parcelles, avec la
 * même bibliothèque. Ce qui se vérifie ici n'est pas le rendu — un test de la
 * racine ne peut pas ouvrir Leaflet — mais ce qui le ferait diverger : des
 * couleurs recopiées de part et d'autre, un fond redéfini dans son coin, un
 * libellé qui nommerait la parcelle autrement d'un écran à l'autre.
 *
 * C'est exactement ce qui s'était produit : une carte « pour le mobile »
 * dessinée à la main, avec ses propres couleurs, à côté de celle du site.
 */

const racine = path.resolve(__dirname, '..');
const lire = (relatif: string): string =>
  readFileSync(path.join(racine, relatif), 'utf8');

describe('La carte du site et celle de l’application', () => {
  describe('Les couleurs et les fonds ne sont définis qu’une fois', () => {
    it('le site les prend dans le terrain commun', () => {
      const source = lire('src/components/map/leaflet-setup.ts');
      expect(source).toContain("from '@/lib/shared/carte'");

      // Une couleur réécrite ici repasserait inaperçue : le site garderait
      // l'ancienne teinte, l'application la nouvelle, et l'exploitant ne
      // reconnaîtrait plus ses parcelles d'un écran à l'autre.
      for (const couleur of ['#2f6b34', '#4b8b3d', '#b4841a', '#e8b93f']) {
        expect(source).not.toContain(couleur);
      }
      expect(source).not.toContain('server.arcgisonline.com');
    });

    it('l’application les prend au même endroit', () => {
      const source = lire('mobile/src/screens/Carte.tsx');
      expect(source).toContain("from '@commun/carte'");
      for (const couleur of ['#2f6b34', '#4b8b3d', '#b4841a', '#e8b93f']) {
        expect(source).not.toContain(couleur);
      }
      expect(source).not.toContain('server.arcgisonline.com');
      // Le fond « plan » vient du serveur, pas d'une adresse inscrite dans
      // l'APK : changer de fournisseur ne doit pas demander de réinstaller.
      expect(source).toContain('snapshot?.carte?.tileUrl');
    });

    it('la parcelle désignée se distingue vraiment de celle au repos', () => {
      // Deux styles identiques rendraient la sélection invisible — et le défaut
      // ne se verrait qu'en tapant sur une parcelle.
      expect(STYLE_PARCELLE_CHOISIE.color).not.toBe(STYLE_PARCELLE.color);
      expect(STYLE_PARCELLE_CHOISIE.fillColor).not.toBe(STYLE_PARCELLE.fillColor);
      expect(STYLE_PARCELLE_CHOISIE.fillOpacity).toBeGreaterThan(
        STYLE_PARCELLE.fillOpacity,
      );
    });

    it('les deux fonds portent une attribution et un modèle d’URL complet', () => {
      for (const fond of [FOND_SATELLITE, FOND_PLAN_DEFAUT]) {
        // La licence des fournisseurs de tuiles impose l'attribution ; un fond
        // affiché sans elle est un fond qu'on n'a pas le droit d'afficher.
        expect(fond.attribution.length).toBeGreaterThan(10);
        for (const marqueur of ['{z}', '{x}', '{y}']) {
          expect(fond.url).toContain(marqueur);
        }
        expect(fond.maxZoom).toBeGreaterThanOrEqual(18);
      }
    });
  });

  describe('Le libellé d’une parcelle', () => {
    const SABLES = {
      name: 'Les Sables',
      internalNumber: 'P-003',
      commune: 'Artenay',
      areaHa: 12.3456,
      cropName: 'Blé tendre d’hiver',
    };

    it('met le numéro interne devant le nom', () => {
      // C'est ainsi qu'on désigne une parcelle dans un dossier PAC comme au
      // téléphone : « la P-003, Les Sables ».
      expect(lignesDEtiquette(SABLES)[0]).toBe('P-003 · Les Sables');
    });

    it('se contente du nom quand il n’y a pas de numéro', () => {
      expect(lignesDEtiquette({ ...SABLES, internalNumber: null })[0]).toBe(
        'Les Sables',
      );
    });

    it('écrit la superficie à la française, sans arrondir à la louche', () => {
      // La superficie vient de PostGIS ; la tronquer à l'hectare ferait perdre
      // ce qui distingue 12,34 ha de 12,35 ha sur une déclaration.
      expect(lignesDEtiquette(SABLES)[1]).toBe('12,3456 ha');
    });

    it('n’invente pas les lignes absentes', () => {
      const lignes = lignesDEtiquette({
        ...SABLES,
        cropName: null,
        commune: null,
      });
      expect(lignes).toEqual(['P-003 · Les Sables', '12,3456 ha']);
      // Ni « culture inconnue », ni « commune non renseignée » : une ligne
      // vide dirait quelque chose de faux sur l'exploitation.
      expect(lignes.join(' ')).not.toMatch(/inconnu|non renseign/i);
    });
  });
});
