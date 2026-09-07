/**
 * Remplacement du module `server-only` pour les tests.
 *
 * Next l'utilise pour interdire l'import de modules serveur depuis un composant
 * client ; c'est une garantie de compilation, sans effet à l'exécution. Vitest
 * ne le résout pas : cet alias neutre permet de tester directement les modules
 * serveur.
 */
export {};
