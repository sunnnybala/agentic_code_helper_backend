import { PrismaClient } from '@prisma/client';

// Use a singleton in dev to avoid exhausting connections during hot reloads
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prismaClient || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prismaClient = prisma;
}

export default prisma;


