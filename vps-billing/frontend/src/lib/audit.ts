import { tr } from "./i18n";
export const auditActionLabels: Record<string, [string, string]> = {
  "account.created": ["创建账户", "Account created"],
  "account.updated": ["更新账户", "Account updated"],
  "account.password_reset": ["重置账户密码", "Account password reset"],
  "account.sessions_revoked": ["撤销账户会话", "Account sessions revoked"],
  "catalog.created": ["新增商品", "Product created"],
  "catalog.updated": ["编辑商品", "Product updated"],
  "catalog.duplicated": ["复制商品草稿", "Product duplicated"],
  "catalog.published": ["上架商品", "Product published"],
  "catalog.unpublished": ["下架商品", "Product unpublished"],
  "order.created": ["创建订单", "Order created"],
  "order.cancelled": ["取消订单", "Order cancelled"],
  "payment.settled": ["支付入账", "Payment settled"],
  "site.settings.updated": ["更新站点设置", "Site settings updated"],
  "currencies.updated": ["更新币种", "Currencies updated"],
  "plan.prices.updated": ["更新套餐价格", "Plan prices updated"],
  "email.settings_updated": ["更新邮件设置", "Email settings updated"],
  "email.test_requested": ["请求邮件测试", "Email test requested"],
  "email.test_accepted": ["邮件服务器已接受", "Email server accepted"],
  "email.test_failed": ["邮件测试失败", "Email test failed"],
  "email.test_uncertain": ["邮件测试结果未确认", "Email test uncertain"],
  "update.handoff_requested": [
    "请求主机更新交接",
    "Host update handoff requested",
  ],
  "update.asset_verified": ["核验更新产物", "Update asset verified"],
};
export const auditActionLabel = (action: string) =>
  Object.hasOwn(auditActionLabels, action)
    ? tr(...auditActionLabels[action]!)
    : tr("其他操作", "Other action");
