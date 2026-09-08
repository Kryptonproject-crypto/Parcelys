import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { App } from './App';
import './styles.css';

/**
 * Amorçage de l'application native.
 *
 * Deux réglages propres à Android : la barre d'état, qui doit suivre le thème,
 * et le bouton retour physique, qui sans traitement quitte l'application au
 * premier appui — comportement déroutant quand on est au milieu d'une saisie.
 */

if (Capacitor.isNativePlatform()) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(
    () => undefined,
  );

  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void CapacitorApp.exitApp();
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine introuvable.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
