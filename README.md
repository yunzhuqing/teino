# Teino AI Gateway

AI 网关，基于 Next.js 16 (App Router) + TypeScript + Drizzle ORM + Neon Postgres，部署在 Vercel。

- **供应商**：Base URL、加密存储的 API Key、支持的 API 类型（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）、附加请求头
- **模型**：挂在供应商下，带对外模型名、上游模型名映射、**优先级**和**流量权重**
- **用户 / API Key**：Key 以 SHA-256 哈希存储，只在创建时显示一次；支持启用/停用与过期时间
- **标签**：可以打在供应商、模型、用户、API Key 上，用于路由
- **路由**：先按标签过滤，再按优先级分层，层内按权重加权随机，失败时自动故障转移
- **日志**：记录状态码、尝试次数、延迟、token 用量（支持流式）
- **界面**：深色玻璃磨砂风格（backdrop-blur + 动态光斑背景）

## 路由规则

1. 候选上游 = 所有供应商下与请求 `model` **同名**、已启用、且供应商支持当前接口类型的模型
2. **调用方标签** = API Key 标签 ∪ 用户标签
   - 不为空时：上游的（供应商标签 ∪ 模型标签）必须至少命中一个
   - 为空时：不受限制
3. 请求头 `X-Gateway-Tags: a,b`：上游必须**同时具备**这些标签
4. 按 `priority` 从高到低分层；同层内按 `weight` 加权随机（权重 0 = 仅兜底）
5. 遇到 429 / 408 / 409 / 5xx / 网络错误 / 超时，按顺序切换到下一个候选，最多 `GATEWAY_MAX_ATTEMPTS` 次
6. 响应头 `x-gateway-provider`、`x-gateway-attempts` 标明命中的供应商

## 本地开发

```bash
cp .env.example .env.local   # 填入 DATABASE_URL / ADMIN_PASSWORD / GATEWAY_SECRET
npm install
npm run db:migrate           # 或 npm run db:push
npm run dev
```

## 部署到 Vercel

1. 导入仓库到 Vercel，在 Storage 中添加 **Neon** 集成（会自动注入 `DATABASE_URL`）
2. 配置环境变量 `ADMIN_PASSWORD`、`GATEWAY_SECRET`（`openssl rand -base64 32`）
3. 运行一次迁移：`vercel env pull .env.local && npm run db:migrate`
4. 网关路由设置了 `maxDuration = 300`，用于长时间的流式响应（需要 Fluid Compute，新项目默认开启）

> ⚠️ `GATEWAY_SECRET` 同时用于会话签名和供应商密钥加密。修改后已保存的供应商密钥无法解密，需要重新填写。

## 接入

| 方法 | 路径 | 协议 |
| --- | --- | --- |
| POST | `/v1/chat/completions` | OpenAI Chat Completions |
| POST | `/v1/responses` | OpenAI Responses |
| POST | `/v1/messages` | Anthropic Messages |
| GET | `/v1/models` | 模型列表 |

鉴权：`Authorization: Bearer sk-tn-...` 或 `x-api-key: sk-tn-...`。

```ts
const openai = new OpenAI({ baseURL: "https://<your-app>.vercel.app/v1", apiKey: "sk-tn-..." });
const anthropic = new Anthropic({ baseURL: "https://<your-app>.vercel.app", apiKey: "sk-tn-..." });
```

## 目录结构

```
src/
  proxy.ts                    管理后台登录拦截（Next 16 Proxy）
  app/(admin)/                管理界面：概览、供应商与模型、用户、Keys、标签、日志、文档
  app/api/v1/*                网关端点（/v1/* 通过 rewrite 映射）
  lib/db/schema.ts            Drizzle 表结构
  lib/gateway/routing.ts      路由算法（纯函数，含单元测试）
  lib/gateway/handler.ts      请求转发、故障转移、流式透传、日志
  lib/gateway/upstream.ts     协议适配：URL、请求头、usage 解析、错误格式
  lib/actions/*               Server Actions（都会校验管理员会话）
drizzle/                      SQL 迁移
```

## 测试

```bash
npm test          # 路由算法与协议适配单元测试
npm run typecheck
```
