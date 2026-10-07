# Teino AI Gateway

AI 网关，基于 Next.js 16 (App Router) + TypeScript + Drizzle ORM + Neon Postgres，部署在 Vercel。

- **供应商**：Base URL、加密存储的 API Key、支持的 API 类型（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）、附加请求头
- **模型**：挂在供应商下，带对外模型名、上游模型名映射、**上游协议**、**优先级**和**流量权重**
- **协议转换**：请求协议与模型的上游协议不同时，经中间格式自动互转（含流式与工具调用）
- **用户 / API Key**：Key 以 SHA-256 哈希存储，只在创建时显示一次；支持启用/停用与过期时间
- **标签**：可以打在供应商、模型、用户、API Key 上，用于路由
- **路由**：先按标签过滤，再按优先级分层，层内按权重加权随机，失败时自动故障转移
- **日志**：记录状态码、尝试次数、延迟、token 用量（支持流式）
- **用户控制台**（`/console`）：管理员给用户设置邮箱 + 登录密码后，用户可自助创建 / 停用 / 删除自己的 Key，查看可用模型与价格、按 Key 与模型统计的费用和 token，以及按 Key / 模型 / 日期筛选的请求明细
- **界面**：深色玻璃磨砂风格（backdrop-blur + 动态光斑背景）

## 角色

| 角色 | 登录方式 | 可访问 |
| --- | --- | --- |
| 管理员 | 登录页「管理员」标签 + `ADMIN_PASSWORD` | 除 `/console` 外的全部管理页面 |
| 普通用户 | 登录页「用户登录」标签 + 邮箱 / 密码（在「用户」页设置） | 仅 `/console/*`，所有数据按会话中的用户 id 过滤 |

- 用户不能给 Key 打标签或充值，这两项会影响路由范围和余额，仍由管理员操作；还有积分余额的 Key 不允许用户删除
- 用户被停用后，其控制台会话在下一次请求时立即失效
- `/v1/models` 只列出该 Key 按标签规则能路由到的模型，与控制台「模型」页一致
- 请求明细里的上游错误会隐藏供应商名和上游响应体，只保留状态码

## 路由规则

1. 候选上游 = 所有供应商下与请求 `model` **同名**、已启用、且供应商支持该模型上游协议（未设置时为请求协议）的模型
2. **调用方标签** = API Key 标签 ∪ 用户标签
   - 不为空时：上游的（供应商标签 ∪ 模型标签）必须至少命中一个
   - 为空时：不受限制
3. 请求头 `X-Gateway-Tags: a,b`：上游必须**同时具备**这些标签
4. 按 `priority` 从高到低分层；同层内按 `weight` 加权随机（权重 0 = 仅兜底）
5. 遇到 429 / 408 / 409 / 5xx / 网络错误 / 超时，按顺序切换到下一个候选，最多 `GATEWAY_MAX_ATTEMPTS` 次
6. 响应头 `x-gateway-provider`、`x-gateway-attempts` 标明命中的供应商

## 协议转换

模型的「上游协议」为空时沿用请求协议，请求原样透传；设置后，其他协议的请求会被转换：

```
客户端协议 ──parseRequest──▶ IR（中间格式，Anthropic block 模型）──buildRequest──▶ 上游协议
客户端协议 ◀─buildResponse / encodeStream── IR ◀─parseResponse / decodeStream── 上游协议
```

- 覆盖文本、图片、system、函数工具 / tool_choice / 工具结果、temperature、top_p、停止词、max_tokens，以及完整的 SSE 流式事件
- 转换为 Anthropic 且未传 `max_tokens` 时，依次使用模型的 `defaultMaxTokens`、`GATEWAY_DEFAULT_MAX_TOKENS`（默认 4096）
- 推理内容（thinking / reasoning）跨协议时丢弃，同协议透传不受影响
- 无法跨协议表达的字段直接返回 400，不静默忽略：`previous_response_id`、`conversation`、`store: true`、`background`、`include`（`reasoning.encrypted_content` 除外）、`text.format`、内置工具、`response_format`、`logprobs`、`logit_bias`、`n > 1`、`presence/frequency_penalty`、`top_k`、音频与文件输入；Responses 上游不支持停止词
- 上游错误体会改写为客户端协议的错误格式；响应头 `x-gateway-upstream-api` 标明上游协议

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
3. 数据库迁移会在每次部署时自动执行（`vercel-build` 脚本先运行 `scripts/migrate.mjs` 再 `next build`，已执行的迁移会跳过）。也可以手动执行：`vercel env pull .env.local && npm run db:migrate`
   - 如果在 Vercel 项目设置里覆盖过 Build Command，请改回默认值或改成 `npm run vercel-build`
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
  proxy.ts                    登录拦截与按角色分流（Next 16 Proxy）
  app/(admin)/                管理界面：概览、供应商与模型、用户、Keys、标签、日志、文档
  app/console/                用户控制台：用量、Keys、模型、请求明细、文档
  lib/console.ts              用户控制台的数据读取（全部按当前用户限定）
  app/api/v1/*                网关端点（/v1/* 通过 rewrite 映射）
  lib/db/schema.ts            Drizzle 表结构
  lib/gateway/routing.ts      路由算法（纯函数，含单元测试）
  lib/gateway/handler.ts      请求转发、故障转移、流式透传、日志
  lib/gateway/upstream.ts     协议适配：URL、请求头、usage 解析、错误格式
  lib/gateway/ir.ts           协议转换中间格式（IR）
  lib/gateway/protocol/*      三种协议 ⇄ IR 的编解码器（含 SSE）
  lib/gateway/convert.ts      转换编排：请求、响应、流式、错误
  lib/gateway/sse.ts          SSE 帧解析与序列化
  lib/actions/*               Server Actions（管理端校验管理员会话，my-keys.ts 校验用户会话）
drizzle/                      SQL 迁移
```

## 测试

```bash
npm test          # 路由算法、协议适配与协议转换单元测试
npm run typecheck
```
