# AI 定向营销助手

面向中国跨境卖家（店主、销售、运营）的定向营销工具。卖家用中文写下这次推广要说什么，系统按每位海外顾客的购买记录和备注，生成一封英语或西班牙语邮件，并给出中文对照。审核后目前以模拟方式发送。

当前代码在 V0.1 演示路径上做完了画像定向的前 3 项：导入客户和订单、改语言、改公司地址。产品名是 **AI定向营销助手**。做到哪一步、还缺什么，见 [画像定向当前版本总结.md](./画像定向当前版本总结.md)。它还不是 `docs/01-产品定位与需求.md` 里的完整试用版。

仓库：<https://github.com/Lydia233-maker/Docs_AI-Sales-Copilot>

给人看的最短启动说明在仓库根目录 [README.md](../README.md)。本目录是给后续开发者和 AI 的项目文档。

## 安装与启动

需要已安装的 pnpm。`package.json` 指定 `pnpm@10.33.3`。Node 版本：待确认（仓库没有 `engines` 字段）。

在仓库根目录：

```bash
pnpm install
pnpm seed
pnpm dev
```

- 前端：http://localhost:5173 （页面标题「AI 定向营销助手」）
- 后端：http://localhost:3000
- 账号：`demo@example.com` / `demo1234`
- 演示店：Paws Demo

打开网址进入登录页。未登录访问其他页面会跳回登录。

`pnpm seed` 清空演示店的客户、订单、备注、标签和推广，再灌入 `fixtures/demo-pet/`。人数应以 [fixtures/demo-pet/README.md](../fixtures/demo-pet/README.md) 为准：客户 40、西班牙语 16、沉睡 32、可触达 27、未同意营销 5。

如果 `pnpm seed` 报 better-sqlite3 缺少 `.node`，在根目录执行 `pnpm rebuild better-sqlite3` 后再 seed。

其他命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm test` | 跑 shared 与 api 的单元测试。web 的 test 脚本直接退出 0 |
| `pnpm build` | 各包执行 TypeScript 检查；web 还会 `vite build` |
| `pnpm --filter api exec tsx src/smoke.ts` | 接口冒烟：登录、沉睡人数、生成、退订拦截、模拟发送 |

程序不读取 `.env`。`.env.example` 只列出变量名。要固定“今天”，在启动后端的进程里设置 `APP_NOW`（默认 `2026-11-01`）。

逐步点击见根目录 README 的「端到端操作清单」。

## 文档索引

按代码整理的入口（本批）：

| 文件 | 内容 |
| --- | --- |
| [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) | 背景、技术栈、模块、开发约定 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 目录、请求路径、数据流 |
| [ROADMAP.md](./ROADMAP.md) | 已完成、未开工、需求里已确认但未实现 |
| [CHANGELOG.md](./CHANGELOG.md) | 按提交整理的变更 |
| [TODO.md](./TODO.md) | 下一版必做清单、已知问题、技术债 |
| [SHOPIFY_SAMPLE_TEST.md](./SHOPIFY_SAMPLE_TEST.md) | 用 Shopify 公开样例对过导入后的结果 |
| [05-当前版本总结.md](./05-当前版本总结.md) | V0.1 初稿说明。当前代码见下面的画像定向总结 |
| [画像定向当前版本总结.md](./画像定向当前版本总结.md) | 任务 1 到 3 做完后的功能、限制、启动和踩坑 |

画像定向这一版的范围：

| 文件 | 内容 |
| --- | --- |
| [画像定向需求文档.md](./画像定向需求文档.md) | 这一版锁定的需求 |
| [画像定向技术文档.md](./画像定向技术文档.md) | 采用的方案一。文中有几条踩坑已被任务 1 到 3 做掉，以当前版本总结为准 |
| [画像定向任务清单.md](./画像定向任务清单.md) | 14 项任务。做到第 3 项 |

需求与方案（描述目标，不等于当前代码）：

| 文件 | 内容 |
| --- | --- |
| [01-产品定位与需求.md](./01-产品定位与需求.md) | 已确认的产品需求 |
| [02-技术方案与目录结构.md](./02-技术方案与目录结构.md) | 完整版目标结构。其中很多目录尚未创建 |
| [03-验收标准.md](./03-验收标准.md) | 完整版验收项 |
| [04-Agent分工与协作.md](./04-Agent分工与协作.md) | 完整版的多 Agent 分工。初稿由单一代码路径实现 |
| [AI定向营销助手技术方案.md](./AI定向营销助手技术方案.md) | 选定方案与踩坑说明 |
| [AI定向营销助手任务清单.md](./AI定向营销助手任务清单.md) | 两小时初稿的 16 项任务 |
