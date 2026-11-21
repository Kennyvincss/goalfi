import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` (run on install) needs no database, so DATABASE_URL is only required by
// commands that connect (migrate, seed). This lets fresh installs and CI build without secrets.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  ...(url ? { datasource: { url } } : {}),
});
