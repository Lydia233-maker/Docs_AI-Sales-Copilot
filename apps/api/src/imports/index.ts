/** 客户和订单 CSV 从 customers.ts 进入。弃单读取以后加在这里。 */
export type ImportKind = "customers" | "orders" | "abandoned";
export { applyCustomerOrders, previewCustomerOrders } from "./customers.ts";
