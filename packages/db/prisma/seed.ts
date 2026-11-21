// Seeds reference data only (categories). No fake users, challenges or activity.
import "dotenv/config";
import { INITIAL_CATEGORIES } from "@goalfi/core";
import { prisma } from "../src/index";

async function main() {
  for (const [i, c] of INITIAL_CATEGORIES.entries()) {
    const data = { name: c.name, icon: c.icon, description: c.description, sortOrder: i };
    await prisma.category.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } });
  }
  console.log(`seeded ${INITIAL_CATEGORIES.length} categories`);
}

main().finally(() => prisma.$disconnect());
