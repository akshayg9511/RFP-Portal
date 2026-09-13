import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// The ONE place Prisma is constructed. Rule 2 of the build plan: no Prisma
// call ever appears in a component — every read and write goes through
// /app/api/*, and that API surface is the contract Spring Boot reimplements
// at V1.
//
// Prisma 7 takes the connection through a driver adapter rather than a url in
// schema.prisma.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env, then run: docker compose up -d",
    );
  }
  return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

// Reused across hot reloads in dev so we don't exhaust the connection pool.
export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
