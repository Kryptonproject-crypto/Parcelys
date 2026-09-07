import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma partagé. En développement, Next recharge les modules à chaud :
 * on conserve l'instance sur `globalThis` pour éviter d'épuiser le pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
