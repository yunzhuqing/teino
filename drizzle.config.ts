import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    // 使用进程环境变量
  }
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
});
