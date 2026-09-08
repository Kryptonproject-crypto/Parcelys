# Image de production Parcelys — multi-étages, sortie « standalone ».
# Compatible amd64 et arm64 (Raspberry Pi 64 bits).

# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# openssl est requis par le moteur Prisma.
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# `DATABASE_URL` est requis pour `prisma generate` ; aucune connexion n'est
# ouverte pendant la compilation.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl tini

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S parcelys -G nodejs

# Sortie « standalone » : serveur minimal, sans les dépendances de build.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=parcelys:nodejs /app/.next/standalone ./
COPY --from=builder --chown=parcelys:nodejs /app/.next/static ./.next/static

# Migrations, schéma et client Prisma, nécessaires au démarrage.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/scripts ./scripts

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /data/documents /data/ephy \
    && chown -R parcelys:nodejs /data

USER parcelys
EXPOSE 3000

# `/api/health` touche réellement la base et l'extension PostGIS. L'ancienne
# sonde interrogeait `/api/auth/session`, qui répond 200 même avec une base
# éteinte : le conteneur était déclaré sain alors que rien ne fonctionnait.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
