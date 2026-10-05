import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = NeonHttpDatabase<typeof schema>;

let instance: DB | undefined;

function getDb(): DB {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 未配置");
    instance = drizzle(neon(url), { schema });
  }
  return instance;
}

/** 延迟初始化，避免在构建阶段缺少环境变量时报错 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
