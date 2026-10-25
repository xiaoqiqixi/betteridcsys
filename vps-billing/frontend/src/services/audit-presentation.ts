import type { Locale } from "../types/idc";

// Presentation only: the original event action, owner, target and detail stay intact.
const ACTION_LABELS: Record<string, readonly [string, string]> = {
  "order.created": ["订单已创建", "Order created"],
  "order.cancelled": ["订单已取消", "Order cancelled"],
  "payment.settled": ["付款已入账", "Payment settled"],
  "account.created": ["账户已创建", "Account created"],
  "account.updated": ["账户信息已更新", "Account updated"],
  "account.password_reset": ["账户密码已重置", "Account password reset"],
  "account.sessions_revoked": ["账户会话已撤销", "Account sessions revoked"],
  "catalog.created": ["商品已创建", "Product created"],
  "catalog.duplicated": ["商品已复制为草稿", "Product duplicated as a draft"],
  "catalog.updated": ["商品已更新", "Product updated"],
  "catalog.published": ["商品已上架", "Product published"],
  "catalog.unpublished": ["商品已下架", "Product unpublished"],
  "catalog.taxonomy_updated": ["商品分类已更新", "Product categories updated"],
  "currencies.updated": ["币种设置已更新", "Currency settings updated"],
  "plan.prices.updated": ["套餐价格已更新", "Plan prices updated"],
  "product.configuration.updated": [
    "产品配置已更新",
    "Product configuration updated",
  ],
  "site.settings.updated": ["站点设置已更新", "Site settings updated"],
  "email.settings_updated": ["邮件设置已更新", "Email settings updated"],
  "email.test_requested": ["已请求发送测试邮件", "Test email requested"],
  "email.test_accepted": [
    "邮件服务器已接受测试邮件",
    "Test email accepted by mail server",
  ],
  "email.test_failed": ["测试邮件发送失败", "Test email failed"],
  "email.test_uncertain": [
    "测试邮件结果待核对",
    "Test email result unconfirmed",
  ],
  "provisioning.queued": ["开通任务已排队", "Provisioning task queued"],
  "provisioning.sending": ["开通任务正在发送", "Provisioning task being sent"],
  "provisioning.accepted": [
    "主控已受理开通任务",
    "Provisioning task accepted by controller",
  ],
  "provisioning.succeeded": ["开通任务已完成", "Provisioning task completed"],
  "provisioning.rejected": ["开通任务被拒绝", "Provisioning task rejected"],
  "provisioning.uncertain": [
    "开通任务结果待核对",
    "Provisioning task result unconfirmed",
  ],
  "update.handoff_requested": [
    "主机更新交接已申请",
    "Host update handoff requested",
  ],
  "update.asset_verified": ["更新文件已校验", "Update artifact verified"],
};

export function auditActionLabel(action: string, locale: Locale): string {
  const labels = Object.hasOwn(ACTION_LABELS, action)
    ? ACTION_LABELS[action]
    : undefined;
  return (
    labels?.[locale === "en" ? 1 : 0] ??
    (locale === "en" ? "Other activity" : "其他操作")
  );
}
