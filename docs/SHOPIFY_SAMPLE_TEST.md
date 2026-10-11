# Shopify 公开样例测试

日期：2026-10-11。样例在 `fixtures/shopify-public/`。测试是 `apps/api/src/csv.test.ts`。

## 客户导入模板

来源：https://help.shopify.com/csv/customer_template.csv

| 字段 | 结果 |
| --- | --- |
| First Name、Last Name、Email | 能读到 |
| Accepts Email Marketing（yes / no） | 能读到。样例第一人是 no，第二人是 yes |
| Default Address Country Code | 能读到。`CA` 会推断为英语 |
| Note | 文件里有，种子导入目前不写入备注表 |
| Accepts SMS Marketing、Phone | 文件里有，数据库没有对应列 |
| Customer ID、Total Spent、Total Orders | **导入模板没有这些列**。导出文件才有。没有 Customer ID 时，外部编号改用邮箱 |

## 订单导出样例

来源：https://tryprofitroot.com/samples/sample-shopify-orders-SAMPLE.csv  
表头对照：https://help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders

样例有 8 笔订单、13 行商品。`#1001`、`#1003`、`#1004` 的后续商品行把订单号和邮箱留空。

修正前：空订单号会被收成另一笔订单，多商品订单丢掉后续商品。  
修正后：空订单号沿用上一笔，`#1001` 同时包含 Cotton Tee 和 Ceramic Mug。`Created at` 带时区（`2025-03-02 10:14:00 -0500`）时，日期仍按前 10 位计算。

只把 `Financial Status` 为 `paid` 的订单计入购买次数和消费金额。样例里的 `partially_refunded`、`refunded`、`voided` 会入库，但不进画像。是否把部分退款算作购买：待确认。

这不是卖家自己的导出文件。试用前仍要用一份脱敏的真实导出再对一次。
