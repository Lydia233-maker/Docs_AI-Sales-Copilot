# 项目背景与开发约定

读代码时以本文件和 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准。`docs/01` 到 `docs/04` 是已确认的完整版目标，许多条目还没有对应实现。

## 背景

- 买家是跨境中小卖家的店主、销售或运营（To B）。
- 收件人是卖家自己的海外个人顾客。演示数据默认欧美，语言为英语或西班牙语。
- 同一批客户里，每人一份文案，不是同一封群发。
- 第一版范围在需求里限定为独立站、Shopify 客户与订单 CSV。当前代码只灌入仓库内的演示 CSV，没有上传接口。
- 界面语言是中文（`apps/web/index.html` 为 `lang="zh-CN"`）。
- 没有 API Key 时必须能离线演示。当前生成路径只有本地模板。

产品名是 **AI定向营销助手**，当前版本 **V0.1**。试用服务器放在国内阿里云；Docker 部署还没做。许可证、要求的 Node 版本：待确认。

## 技术栈

以各 `package.json` 的依赖范围为准，锁文件里的精确版本会随安装变化。

| 部分 | 现状 |
| --- | --- |
| 包管理 | pnpm workspace（`pnpm-workspace.yaml`：`apps/*`、`packages/*`），`packageManager` 为 pnpm 10.33.3 |
| 前端 | React 19、React Router 7、Vite 6、TypeScript 5 |
| 后端 | Node、Fastify 5、`@fastify/cookie`、`@fastify/cors`、tsx 直接跑 TypeScript |
| 数据库 | better-sqlite3，单文件 SQLite，WAL |
| 共享校验 | `packages/shared` 使用 Zod 3 |
| 测试 | Node 内置 `node:test`（shared、eligibility、templates）。另有手动冒烟 `apps/api/src/smoke.ts` |
| 构建 | `tsc --noEmit`。api 没有单独的打包产物，`start` 仍用 tsx |

没有 Docker、没有 ORM、没有自动加载 `.env` 的依赖。

## 模块

| 路径 | 职责 |
| --- | --- |
| `apps/web/src/App.tsx` | 全部页面：登录、客户、档案、挑选、推广列表、审核与发送 |
| `apps/web/src/api.ts` | `fetch` 封装和前端类型。未依赖 `@copilot/shared` |
| `apps/web/vite.config.ts` | 开发服务器端口 5173，把 `/api` 代理到 `http://localhost:3000` |
| `apps/api/src/server.ts` | 监听 `0.0.0.0`，端口 `PORT` 或 3000 |
| `apps/api/src/app.ts` | 路由、会话、画像序列化、生成、审核、模拟发送 |
| `apps/api/src/db.ts` | 建表、`uuid`、`appToday()` |
| `apps/api/src/seed.ts` | 清空业务表并灌入演示数据 |
| `apps/api/src/csv.ts` | CSV 解析、金额转分、品类关键词、语言推断 |
| `apps/api/src/eligibility.ts` | 是否可发营销邮件 |
| `apps/api/src/templates.ts` | 本地文案、占位符检查、隐私遮盖、渲染 |
| `packages/shared/src/index.ts` | 请求体、错误码、占位符白名单、客户简报 schema |
| `fixtures/demo-pet/` | Shopify 风格 CSV、`notes.json`、生成脚本 |

`docs/02` 中的 `generation/brief.ts`、`email/smtp.ts`、`privacy/delete.ts`、Drizzle 迁移等路径在仓库中不存在。

## 开发约定

这些是代码里已经采用的规则。

1. **金额用整数分。** 显示时除以 100。消费层级：不少于 12000 分为高，不少于 5000 分为中，其余为低（`seed.ts` 的 `spendTier`）。
2. **接口字段用驼峰，SQLite 列用蛇形。** 例如列 `intent_zh`，JSON 为 `intentZh`。在 `app.ts` 返回前转换。`GET /api/v1/auth/me` 和 `GET /api/v1/store` 仍返回列名 `company_address`。
3. **客户简报不能含姓名、邮箱、手机号。** `CustomerBriefSchema` 是 strict object。姓名只通过占位符 `{{first_name}}` 在渲染时填入。
4. **占位符白名单**（`packages/shared`）：`first_name`、`last_product`、`discount_code`、`unsubscribe_url`、`company_address`。白名单外的占位符不能通过审核。
5. **可触达判断走 `isEmailEligible`。** 需要邮件营销同意，且 `unsubscribed_at` 为空。它同时接受驼峰和蛇形字段名。
6. **查询要带 `store_id`。** 当前种子只有一家店。
7. **没有正文的 POST 不要设置 `Content-Type: application/json`。** `api.ts` 仅在有 body 时设置。空 JSON 体会被 Fastify 拒绝为 400。
8. **改表结构后要重新 seed，或另写迁移。** `db.ts` 使用 `CREATE TABLE IF NOT EXISTS`，不会给旧库加列。库文件默认是进程工作目录下的 `data/app.db`。`pnpm --filter api` 的工作目录是 `apps/api`，因此文件为 `apps/api/data/app.db`（已 gitignore）。
9. **`pnpm seed` 会删除演示店的业务数据。**
10. **API Key 与 SMTP 密码只放环境变量。** 不要写入代码、文档或提交 `.env`。`.gitignore` 已忽略 `.env` 和 `*.db`。
11. **订单 CSV 一行是一个商品。** `seed.ts` 按订单 `Name` 合并。客户与订单用小写邮箱关联。
12. **品类由商品标题关键词决定**（`categoryOf`）：litter / arena → 猫砂；dog → 狗粮；chew / toy / catnip → 零食玩具；其余 → 猫粮。
13. **语言**：标签含 `lang:es` 或 `lang:en` 优先；否则国家为 MX、ES、AR、CO、CL、PE 时为西班牙语；其余为英语。
14. **“今天”** 来自 `APP_NOW`，否则 `2026-11-01`。天数按日期的 UTC 零点相减（`daysBetween`）。
15. **同时只跑一个 API 进程**，避免 SQLite 锁。
16. **演示邮箱使用 `@example.com`。**

前端页面与路由、后端 URL 见 [ARCHITECTURE.md](./ARCHITECTURE.md)。未完成项见 [TODO.md](./TODO.md)。

## 已确认、代码里仍是临时做法

- 有折扣码时，模板固定写 20% off，不解析中文意图里的折扣。这是 V0.1 的既定做法。
- 默认模型是 DeepSeek，失败再试 OpenAI，再失败用现在的模板。V0.1 没有调用模型，没有 Key 时只用模板。
- 试用部署目标是国内阿里云。仓库里还没有部署脚本。

## 待人工补充

- 许可证、要求的 Node 版本。
- 部分退款的订单算不算一次购买。公开订单样例里有 `partially_refunded`，现在只把 `paid` 计入画像。
