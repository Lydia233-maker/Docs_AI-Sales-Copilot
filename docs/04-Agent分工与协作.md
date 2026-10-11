# 04 Agent 分工与协作

> 版本：V1（第一版，可试用版）
> 状态：规划稿，等待负责人确认后开工
> 前置文档：[02 技术方案与目录结构](./02-技术方案与目录结构.md)、[03 验收标准](./03-验收标准.md)

## 1. 角色与边界

| 角色 | 职责 | 唯一可以修改的路径 | 对应的验收条目 |
| --- | --- | --- | --- |
| **主 Agent** | 定接口、搭仓库骨架、准备演示和契约数据、审查与合并 PR、协调接口变更、维护文档 | `packages/shared/`、`docs/`、`fixtures/`、根目录配置文件（`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json`、lint 配置、`.env.example`、`.gitignore`、`Dockerfile`、`docker-compose.yml`、`README.md`、`.github/`、`scripts/`） | G3、G4、K1、K2、P1、P4 |
| **Agent A：前端** | 卖家使用的全部中文界面 | **只能修改 `apps/web/`** | G6、S6、H1、H3、R4、R5 和 E2 的界面部分，以及各页面的组件测试 |
| **Agent B：后端** | API、数据导入、分群、大模型路由、文案检查、发送、追踪、合规、删除、脚本 | **只能修改 `apps/api/`** | D、S、H、M、R、E、T、C、K3～K5、P2、P3 的实现与单元测试 |
| **Agent C：端到端测试与验收** | 端到端测试、接口契约和合规测试、伪造的外部服务、一键验收报告、演示录屏 | **只能修改 `tests/e2e/`** | 03 中全部标注为 E2E 和 API 的条目，以及第 12 节的演示 |

硬性规则：

1. **子 Agent 之间不能修改对方的文件**，也不能修改主 Agent 的文件（第 5 节允许的 `pnpm-lock.yaml` 变化除外）。
2. **接口（`packages/shared`）只能由主 Agent 修改。** 子 Agent 不能在自己的目录中复制或重新定义接口类型来绕开这条规则。
3. 每个子 Agent 在**独立的 git worktree 和独立的分支**上工作。
4. 违反路径归属的 PR 会被 CI 中的归属检查拦截（见第 5 节）。

## 2. 里程碑

```
M0 接口与骨架（主）──► 负责人确认 ──► M1 并行实现（A / B / C）──► M2 联调 ──► M3 验收与试用准备
```

### M0：接口与骨架（主 Agent，负责人确认文档后开始）

主 Agent 提交一个 PR，合并后 A、B、C 才开始工作。内容如下：

1. **仓库骨架**：根目录的 `package.json`（脚本：`dev`、`build`、`test`、`lint`、`e2e`、`acceptance`）、`pnpm-workspace.yaml`、`tsconfig.base.json`、lint 和格式化配置、`.gitignore`、`.env.example`（只有变量名）。
2. **`packages/shared` 完整的第一版接口**：02 第 6 节中的全部枚举、占位符白名单、错误码、各领域的 Zod schema，以及 `api.ts` 接口清单。附带 schema 自身的单元测试和 `CHANGELOG.md`。
3. **三个应用的最小空壳**：`apps/web`、`apps/api`、`tests/e2e` 各自的 `package.json`、`tsconfig.json` 和空入口，并预先安装 02 第 2 节中计划使用的依赖，让 lockfile 基本稳定。**M0 合并后，这三个目录的归属分别转交给 A、B、C。**
4. **`fixtures/`**：宠物用品演示数据（Shopify 导出格式的客户、订单、弃单、商品 CSV，以及“发送后订单”文件）、错误样例，以及 `fixtures/README.md`。说明文件中写明各场景的期望人数、指定客户的期望画像和期望转化结果，供 B 的单元测试和 C 的验收测试共同使用。
   - 演示数据规模约为 300 位客户、900 笔订单；覆盖英语和西班牙语国家；覆盖 5 个场景、3 个消费层级；包含未同意营销、手机号无效、带 `lang:` 标签、多商品、退款等边界情况。
5. **CI**：`.github/workflows/ci.yml` 运行安装、构建、lint、测试、密钥扫描（K1、K2），以及路径归属检查脚本 `scripts/check-ownership.mjs`。

### M1：并行实现

三个子 Agent 同时开工，每人按下表顺序拆分成多个小 PR。每个 PR 都基于最新的 `main`。

| 顺序 | Agent B（apps/api） | Agent A（apps/web） | Agent C（tests/e2e） |
| --- | --- | --- | --- |
| 1 | 配置读取、数据库 schema 与迁移、Fastify 应用、`/health`、登录与会话、`create-user` 脚本 | 应用框架：路由、布局、登录页、基于 shared 的请求客户端、MSW 模拟接口 | 测试基础设施：启动 API 和 Web、独立的测试数据库、伪造的大模型服务（可编程返回成功、500 错误或非法 JSON）、伪造的 SMTP 服务 |
| 2 | `shopify-csv` 适配器、导入预览与入库、客户画像重算、`seed-demo` 脚本 | 数据导入页（上传、预览、错误行、确认）、客户列表与详情 | 契约测试：按 `api.ts` 逐个接口校验响应结构（G5） |
| 3 | 场景分群与分层预览、营销节点 | 首页（营销节点、概览）、分群页 | 数据和分群的 API 测试（D、S、H） |
| 4 | 大模型路由链与模板供应商、文案生成、中文对照、规则检查与 AI 检查 | 活动创建向导、文案对比与中文对照、编辑与审核、问题提示 | 模型与审核测试（M、R），包括降级和个人信息隔离 |
| 5 | 收件人冻结、发送预览、模拟发送和 SMTP 发送、WhatsApp 导出、退订页面、追踪 | 发送确认页、WhatsApp 导出、活动报表 | 发送、追踪和合规测试（E、T、C） |
| 6 | 转化计算、客户删除与清空店铺、审计日志、对照组和频率限制（P1） | 设置页（店铺信息、语言映射、复购周期、删除客户、清空店铺） | 端到端流程测试、`acceptance/run.ts` 报告、安全测试（K3～K5） |

并行开发时的依赖处理：

- **A 不等 B**：A 始终可以使用 MSW 模拟接口开发，模拟数据由 shared schema 生成，结构保证和真实接口一致。通过 `VITE_USE_MOCKS=true/false` 切换。
- **C 不等 A 和 B 合并**：C 可以先完成测试基础设施和测试用例；为了运行测试，可以**只读地**把 A 或 B 已推送的分支检出到临时目录运行，但不能向对方的分支提交。尚未实现的功能对应的测试，先标记为 `test.fixme` 并注明依赖。
- **B 不依赖 A 和 C**：B 的单元测试使用 `fixtures/` 和自己的伪造服务。

### M2：联调

- 前提：B 的 1～5 和 A 的 1～5 已经合并。
- A 关闭 MSW，连接真实 API 逐页验证；C 去掉 `test.fixme`，运行全部测试。
- C 发现缺陷时，在**对应 Agent 的 PR 中评论**，或在 PR 描述中列出缺陷清单，写明复现步骤和对应的验收条目编号。由 A 或 B 在自己的分支中修复，C 不直接修改对方代码。
- 发现接口问题时，走第 4 节的接口变更流程。

### M3：验收与试用准备

- C 在干净、离线、没有 Key 的环境中运行 03 第 12 节的演示脚本，输出验收报告 `tests/e2e/reports/acceptance-report.md`，并录制演示视频。
- 主 Agent 根据报告逐条核对 03，补充 README 中的部署和试用说明，确认合规条目（C1～C10）全部通过后，交给负责人。
- 负责人提供 Key 和真实导出文件后，补充完成 M10 和 P5 的人工验收。

## 3. Worktree 与分支

主 Agent 在 M0 合并后创建三个 worktree，分别交给三个子 Agent：

```bash
git fetch origin main
git worktree add ../copilot-a-web -b cursor/agent-a-web-0805 origin/main
git worktree add ../copilot-b-api -b cursor/agent-b-api-0805 origin/main
git worktree add ../copilot-c-e2e -b cursor/agent-c-e2e-0805 origin/main
```

- 分支名格式为 `cursor/agent-<a|b|c>-<范围>-0805`，全部小写。一个 Agent 有多个 PR 时，每个 PR 单独开分支，例如 `cursor/agent-b-api-imports-0805`。
- 所有 PR 的目标分支都是 `main`，默认以草稿形式创建，满足 03 第 1 节的通用标准后再标记为可审阅。
- 同步上游时，只能 **rebase 到 `origin/main`**，不能合并其他子 Agent 的分支。
- 提交信息使用 `feat(web|api|e2e):`、`fix(...)`、`test(...)`、`chore(...)` 前缀；每个逻辑上独立的改动单独提交。
- 只有主 Agent 合并 PR。

## 4. 接口变更流程

1. 子 Agent 发现 shared 中的接口不够用或有错误时，**不能自行修改**，也不能在自己的目录里临时定义替代类型。
2. 在自己的 PR 描述中增加“接口变更请求”小节，写明：涉及的接口名称、现状、期望的修改、原因，以及对其他 Agent 的影响。在新接口合并之前，可以用 `// TODO(shared-change): <请求标题>` 标记临时的绕行代码。
3. 主 Agent 评估后，单独提交一个 shared PR，同时更新 02 第 6 节和 `packages/shared/CHANGELOG.md`。修改不兼容时，需要在 PR 中写明 A、B、C 各自需要做的修改。
4. 合并后，主 Agent 在受影响的子 Agent PR 中评论，通知 rebase。
5. 在 M1 期间，主 Agent 优先只做**向后兼容**的修改（新增字段、新增接口）。

## 5. 共享资源规则

| 资源 | 规则 |
| --- | --- |
| `pnpm-lock.yaml` | 由主 Agent 所有。子 Agent **只能**在自己的 `package.json` 中新增依赖，并提交由此产生的 lockfile 变化；PR 描述中说明新增依赖的用途。发生 lockfile 冲突时，由主 Agent 在合并时重新执行 `pnpm install` 解决，子 Agent 不需要处理 |
| 根目录 `package.json` 的脚本 | 由主 Agent 所有。子 Agent 需要新增根目录脚本时，通过接口变更请求的方式提出 |
| `fixtures/` | 由主 Agent 所有。C 需要额外的边界数据时，放在 `tests/e2e/fixtures/`；B 的单元测试需要的私有数据放在 `apps/api/test/fixtures/` |
| `.env.example` | 由主 Agent 所有。B 需要新的环境变量时，通过接口变更请求提出 |
| 端口 | API 使用 3000，Web 开发服务器使用 5173；C 的测试使用 3100 和 5273，伪造的大模型服务使用 3901，伪造的 SMTP 服务使用 3902，避免与开发环境冲突 |

路径归属检查（`scripts/check-ownership.mjs`）：根据分支前缀 `cursor/agent-a-*`、`cursor/agent-b-*`、`cursor/agent-c-*` 检查相对 `main` 的改动文件。只允许改动对应目录，以及上表允许的 `pnpm-lock.yaml` 变化；否则 CI 失败。

## 6. PR 要求

每个子 Agent 的 PR 描述包含：

- **对应任务**：例如“B-M1-2 导入与画像”。
- **覆盖的验收条目**：例如 D1～D9。
- **验证方式**：执行了哪些命令，结果如何。
- **已知限制和 `test.fixme`**（如果有）。
- **接口变更请求**（如果有）。
- **对其他 Agent 的影响**（如果有）。

## 7. 子 Agent 启动说明（主 Agent 派发任务时使用）

**通用部分（三个子 Agent 都包含）：**

> 你在 worktree `<路径>`、分支 `<分支名>` 上工作。开始前先完整阅读 `docs/01`～`docs/04`。你只能修改 `<目录>`；接口只能使用 `packages/shared`，需要修改接口时按 04 第 4 节提出请求。所有测试必须能在离线、没有任何 API Key 的环境中通过。不要把 Cursor 作为模型接口。不要在代码、测试或日志中写入任何密钥。按 04 第 2 节中你负责的那一列的顺序拆分 PR，每完成一项就提交、推送并创建或更新草稿 PR。

**Agent A 补充：** 界面全部使用中文；每个页面至少有一个覆盖主要交互的组件测试；所有请求都通过 `src/api/` 中基于 `api.ts` 的客户端发出；在联调前使用 MSW。

**Agent B 补充：** 合规逻辑（退订链接、同意过滤、删除）必须在服务端强制执行；三个适配器（数据来源、大模型、邮件）都要先实现离线版本；发给大模型的请求只能使用人群统计特征；所有响应都使用 shared schema 校验。

**Agent C 补充：** 测试按 03 的条目编号命名，例如 `C4-only-consented.spec.ts`；伪造的大模型服务要记录全部请求内容，用于检查个人信息隔离；`acceptance/run.ts` 输出逐条结果，有失败时以非零退出码结束；M3 时录制演示视频。

## 8. 负责人需要确认的事项

1. 01、02、03 中标为“建议”的内容是否可以采用，尤其是：
   - 真实邮件发送使用 SMTP；
   - WhatsApp 使用“短信营销同意”字段作为同意依据；
   - 转化归因窗口为 7 天；
   - 沉睡召回以外的场景口径。
2. 02 第 6 节的接口清单和枚举是否可以作为 M0 中 `packages/shared` 的依据。
3. 合规条目 C1～C10 是否完整。
4. 是否在 Cloud Agent 的 Secrets 中提供 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`（可选：`DOUBAO_API_KEY`）。没有提供时，第一版只能用模板验收，M10 留待之后完成。
5. 能否提供 1 份脱敏的真实 Shopify 客户和订单导出文件，用于核对字段（P5）。
