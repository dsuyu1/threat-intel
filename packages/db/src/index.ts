import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

// Singleton for use in server-side Next.js and agents
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = createDb(url);
  }
  return _db;
}

export * from "./schema";
