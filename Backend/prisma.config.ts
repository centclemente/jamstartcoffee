import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const config = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});

export default config;