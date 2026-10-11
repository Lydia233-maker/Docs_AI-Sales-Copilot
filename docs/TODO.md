# 待办

来源只包括：当前代码里缺失或写死的行为，以及 `docs/01` 已确认但未实现的条目。优先级没有产品排序，待确认。

## 待开发功能

需求已确认、代码未做：

- 页面导入 Shopify CSV（客户、订单；弃单和商品为可选）。
- 复购提醒、首单转二单、弃购挽回。
- 按国家、语言、消费层级、品类、偏好标签、客户类型、有无备注筛选；列表勾选。单批上限默认 200。
- 销售修改语言；客户类型字段。客户 CSV 的电话、短信营销同意入库。
- 按小群生成一封共用文案，而不是只统计人数。
- 接入模型调用（需求暂定 DeepSeek → OpenAI → 模板），生成前费用预估，单份重新生成。
- 邮件预览文本；选择邮件 / WhatsApp；WhatsApp 复制、wa.me、CSV 导出。
- SMTP 真实发送，默认保持模拟。
- 退订确认页，写入 `unsubscribed_at`。
- 删除客户与清空店铺。
- 营销节点首页。
- 转化报表与 7 天归因。
- 店铺设置：公司地址、品牌语气（`brand_voice` 已入库，默认 `warm`，接口有返回，页面不能改）。

## 已知问题

代码里能直接看到的行为，还没当成缺陷修掉：

- 退订链接指向 `http://localhost:3000/u/<token>`，没有对应路由。发送用随机 token；预览渲染把 token 写成固定字符串 `preview`。
- 有折扣码时，外语正文固定为 20% off。中文意图原文被拼进外语正文。
- 备注和偏好标签的具体文字只出现在中文对照和定制要点。外语正文在有备注时只加一句笼统说明。
- 标签或备注在生成之后添加，不会改写已有草稿。
- `.env.example` 中的变量不会被进程自动加载。`SESSION_SECRET` 无读取处。
- `GET /api/v1/auth/me` 与 `GET /api/v1/store` 的地址字段仍是 `company_address`。
- 客户 CSV 的 Note 列不导入；备注只来自 `notes.json` 和页面新增。
- 生成循环中一人失败会导致整次请求失败，没有单客户重试。
- 页面没有驳回操作。草稿列表没有按「检查不通过 / 小群」排序。
- `apps/web` 的 `test` 脚本固定成功，不检查页面。

## 技术债

- 数据库变更没有迁移。改 `db.ts` 后旧的 `apps/api/data/app.db` 不会跟上。
- 前端类型手写在 `apps/web/src/api.ts`，与 `packages/shared` 的 Zod 不同步。
- `docs/02` 描述的目录、Drizzle、`pnpm acceptance` 与仓库不符。改代码时不要假设那些文件存在。
- 冒烟测试不在 `pnpm test` 里，要手动执行 `pnpm --filter api exec tsx src/smoke.ts`。
- 模板、路由、页面状态都集中在少数大文件（`app.ts`、`App.tsx`）。拆分方式待确认。
- `language_overridden`、`brand_voice`、`EMAIL_SENDER` 已预留但没有业务行为。

## 明确不做

与需求第 4.9 节一致，除非需求改写，否则不要排进开发：

Amazon、Temu、SHEIN、Shopee、Lazada、TikTok Shop；Shopify API 实时同步（只预留接口）；批发文案；WhatsApp 自动发送；短信；自动化流程编排；可视化邮件编辑器；广告投放；对外开放注册和计费。
