#!/bin/sh
# Applique les migrations avant de démarrer l'application.
set -e

echo "→ Application des migrations de base de données…"
npx prisma migrate deploy

echo "→ Démarrage de Parcelys"
exec "$@"
