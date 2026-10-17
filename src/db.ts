import { PrismaClient } from '@prisma/client';

// One client per process. Prisma pools connections, so a fresh client per
// request would exhaust the pool as soon as traffic picks up.
export const prisma = new PrismaClient();
