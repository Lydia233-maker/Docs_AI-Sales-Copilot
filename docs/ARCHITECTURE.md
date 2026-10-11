# 架构

当前是一个 pnpm monorepo：浏览器只访问 Vite，开发时 `/api` 被代理到 Fastify。Fastify 读写一个 SQLite 文件。文案在 API 进程内用模板函数生成，不访问模型服务。

```
浏览器 (React, :5173)
    │  cookie 会话，fetch /api/v1
    ▼
Vite 代理 /api → Fastify (:3000)
    │
    ├─ packages/shared   校验请求体、占位符、客户简报
    ├─ templates.ts      生成与渲染文案
    ├─ eligibility.ts    是否可发营销邮件
    └─ better-sqlite3    apps/api/data/app.db
```

生产环境如何托管前端静态文件：待确认。仓库没有对应的部署配置。

## 目录

```
仓库根目录
├── package.json              # dev / build / test / seed
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example              # 只有变量名，程序不读取 .env
├── fixtures/demo-pet/        # customers.csv、orders.csv、notes.json
├── packages/shared/src/      # Zod schema
├── apps/web/src/             # App.tsx、api.ts、styles.css
├── apps/api/src/             # server、app、db、seed、csv、templates、eligibility、smoke
└── docs/                     # 需求文档与本批说明
```

## 前端路由

定义在 `apps/web/src/App.tsx`。除 `/login` 外都要求 `GET /api/v1/auth/me` 成功。

| 路径 | 页面 |
| --- | --- |
| `/login` | 登录 |
| `/` | 重定向到 `/customers` |
| `/customers` | 客户列表，可按语言筛选 |
| `/customers/:id` | 档案、订单、备注、偏好标签 |
| `/audience` | 挑选客户并触发生成 |
| `/outreach` | 推广列表 |
| `/outreach/:id` | 审核、一键通过、模拟发送、复制 |

## 后端路由

均在 `apps/api/src/app.ts`。除下表标明公开的接口外，需要 Cookie `session`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | 公开。进程状态，以及是否设置了各模型 Key、`EMAIL_SENDER` |
| POST | `/api/v1/auth/login` | 公开。校验邮箱密码，写入 `sessions`，Set-Cookie |
| POST | `/api/v1/auth/logout` | 删除会话 |
| GET | `/api/v1/auth/me` | 当前用户 id 与店铺行 |
| GET | `/api/v1/store` | 店铺 id、名称、地址、`brand_voice` |
| GET | `/api/v1/customers` | 列表。查询参数 `language`、`q` 在接口中存在；页面只用 `language` |
| GET | `/api/v1/customers/:id` | 档案、备注、订单、购买记录 |
| POST | `/api/v1/customers/:id/notes` | 添加备注，返回隐私警告 `email` / `phone` |
| POST | `/api/v1/customers/:id/tags` | 添加偏好标签。去首尾空格，1–40 字，完全相同的字符串不重复 |
| POST | `/api/v1/audience/preview` | 统计人数。body：`scenario`，可选 `language`、`hasNotes` |
| POST | `/api/v1/outreach` | 创建推广并冻结收件人 |
| GET | `/api/v1/outreach` | 推广列表 |
| GET | `/api/v1/outreach/:id` | 推广详情与草稿 |
| POST | `/api/v1/outreach/:id/generate` | 删除旧草稿，为可触达收件人各写一封 |
| PATCH | `/api/v1/drafts/:id` | 修改标题或正文，状态回到 `ready` |
| POST | `/api/v1/drafts/:id/review` | body.decision 为 `approve` 或 `reject`。页面只有通过 |
| POST | `/api/v1/outreach/:id/drafts/bulk-approve` | 通过没有阻止项的草稿 |
| GET | `/api/v1/drafts/:id/rendered` | 填好占位符的标题和正文 |
| POST | `/api/v1/outreach/:id/send` | 模拟发送已通过的草稿 |
| GET | `/api/v1/outreach/:id/messages` | 已写入的模拟消息 |

`preHandler` 对以 `/u/` 开头的路径跳过登录，但没有注册退订处理函数。

## 会话与密码

- 密码以 `scrypt` 保存，格式 `salt:hash`（`seed.ts` 写入，`app.ts` 校验）。
- 登录成功写入 24 字节随机 token，Cookie 名 `session`，`httpOnly`、`sameSite=lax`、`path=/`、`maxAge` 7 天。未设置 `secure`。
- `SESSION_SECRET` 出现在 `.env.example`，代码未使用。

## 数据表

均由 `apps/api/src/db.ts` 创建。

| 表 | 存什么 |
| --- | --- |
| `stores` | 店名、公司地址、`brand_voice` |
| `users` | 邮箱、密码哈希、所属店 |
| `sessions` | token → 用户 |
| `customers` | 外部 id、邮箱、姓名、国家、语言、Shopify 标签、偏好标签、邮件同意、退订时间、订单数、消费分、最近订单日、消费层级、主要品类 |
| `orders` / `order_items` | 订单与商品行。金额为分 |
| `customer_notes` | 销售备注 |
| `outreach` | 一次推广：名称、中文意图、场景、折扣码、状态 |
| `outreach_recipients` | 冻结的收件人、是否可触达、排除原因、`personalized` 或 `cohort` |
| `drafts` | 每人一份草稿：外语标题正文、中文对照、定制要点、状态 |
| `messages` | 模拟发送结果、退订 token、渲染后的标题和正文 |

没有客户类型、电话、短信营销同意、小群表、模型调用记录。

客户状态与推广状态用字符串，没有数据库枚举。页面上看到的中文来自 `App.tsx` 的 `statusLabel`：`draft` 草稿，`reviewing` / `ready` 待审核，`approved` 已通过，`rejected` 已拒绝，`sent` 已发送。

## 数据流

1. `pnpm seed` 解析 `fixtures/demo-pet/customers.csv` 与 `orders.csv`，备注来自 `notes.json`（不读取客户 CSV 的 Note 列）。计算订单数、消费、层级、主要品类、语言。
2. 登录后，客户列表调用 `GET /api/v1/customers`。档案页再取详情。
3. 挑选页 `POST /api/v1/audience/preview`。场景 `winback_dormant` 时，`last_order_at <= date(今天, '-60 days')`。`all` 不过滤日期。
4. `POST /api/v1/outreach` 为筛选结果每人插入一行收件人。`isEmailEligible` 为假时 `eligible=0`。`generationMode`：订单数 ≥ 2，或有备注，或有偏好标签 → `personalized`，否则 `cohort`。
5. `POST .../generate` 只处理 `eligible=1`。组装简报（语言、国家、订单数、层级、距今天数、最近购买、标签、遮盖后的备注），调用 `generateTemplate`。先删除该推广的旧草稿。
6. 审核读写 `drafts`。`checkDraft` 要求正文包含 `{{unsubscribe_url}}` 和 `{{company_address}}`。一键通过跳过仍有阻止项的草稿。
7. 模拟发送只处理状态为 `approved` 的草稿。再次发送会先删除该推广已有的 `messages`。每封生成独立的退订 token，用 `renderCopy` 替换占位符，状态写成 `delivered`。接口返回 `sender: "mock"`。
8. 复制调用 `GET .../rendered`。这里的退订 token 固定为字符串 `preview`，与发送时的 token 不同。

## 模板行为

`generateTemplate` 不读取 `mode`。信息少的客户也是每人一封，句子结构相同，差异来自语言、距今天数、最近商品标题、是否有备注（外语正文只加一句笼统的话）、折扣码。

中文对照和 `personalizationPoints` 会写入备注摘录与偏好标签。备注摘录在要点里截到 24 个字。

有折扣码时，外语正文写 20% off。这是 V0.1 确认的固定模板，不解析推广意图里的折扣幅度。中文意图字符串会直接拼进外语正文。
