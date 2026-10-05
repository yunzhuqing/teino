// 执行 drizzle/ 下尚未应用的迁移（幂等，已执行的迁移会被跳过）
// Vercel 构建时通过 `vercel-build` 自动调用；本地可用 `npm run db:migrate:run`
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // 文件不存在时使用进程环境变量
  }
}

const url = process.env.DATABASE_URL;

if (!url) {
  if (process.env.VERCEL) {
    console.error("[migrate] DATABASE_URL 未配置，请在 Vercel 项目中连接 Neon 或手动设置该环境变量");
    process.exit(1);
  }
  console.warn("[migrate] 未设置 DATABASE_URL，跳过数据库迁移");
  process.exit(0);
}

try {
  console.log("[migrate] 正在执行数据库迁移...");
  await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
  console.log("[migrate] 迁移完成");
} catch (error) {
  console.error("[migrate] 迁移失败:", error);
  process.exit(1);
}
