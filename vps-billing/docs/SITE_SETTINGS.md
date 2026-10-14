# 站点设置、语言与币种

默认站点名为“星屿云”。运营方名称、支持方式、账单开具身份和界面外观都由后台“站点设置”管理；内部代码和路径保留 Aster 命名，不影响展示名称。客户不能修改站点级设置。

## 常用设置与预览

| 项目 | 当前范围 | 生效边界 |
|---|---|---|
| 站点名、公司名 | 纯文本 | 导航/登录及运营身份展示；不改变账号或权限 |
| 标志、主题 | star/cloud/server 预设；blue/teal/violet 主题 | 预览后保存；没有文件上传、自定义 HTML/CSS/脚本或远程图片 |
| 支持邮箱、支持链接 | 邮箱地址；经验证的 HTTPS 地址 | 展示与跳转，不由服务器抓取内容 |
| 展示地址 | HTTPS 来源 | 只展示；不会申请域名、修改 DNS、证书、APP_ORIGIN 或邮件发件域 |
| 默认语言、币种 | zh-CN / en；CNY / USD | 无个人偏好的首次访问使用；两项独立选择 |
| 账单抬头、地址 | 纯文本 | 新订单/账单创建时保存快照；历史记录不改 |
| 邮件署名 | 纯文本 | 保存供未来邮件模板使用；SMTP 管理员测试使用固定正文，不采用此署名 |

界面将常用选项与高级选项分开，显示保存状态和本地预览。预览不是发布成功；只有服务端返回保存成功才更新持久化设置。同一时间多位管理员编辑时，后保存者会收到版本冲突，应重新加载并核对差异，避免无提示覆盖别人修改。

所有写入都需管理员会话、CSRF、来源限制和当前 revision；更新与审计是同一事务。公开读取只返回展示所需字段，不公开邮件署名和账单地址。支持链接/展示地址不接受 IP、localhost、单标签域名、用户密码、端口或片段；API 不尝试解析 DNS 或代理访问该地址，因此不是 SSRF 出口。运营方仍应确认链接指向自己控制的正确站点。

没有自定义上传标志、无限主题编辑器、任意域名绑定、发票 PDF/税票系统或所见即所得邮件模板。SMTP 凭据在独立管理员页面加密保存，不属于站点展示设置。保存署名或公司名不代表发信或税票能力已经可用。

## 语言和币种分别控制什么

语言选择只控制界面文案、日期与金额格式，支持简体中文和 English，回退语言为简体中文。用户输入的公司名、产品名、地址和历史记录不会自动翻译。

币种选择控制该币种的套餐报价及相应统计。CNY 和 USD 都使用整数最小单位，100 分对应 1 CNY，100 美分对应 1 USD；金额必须是 JavaScript 可精确表示范围内的整数（最大 9007199254740991）。这里没有汇率表、自动兑换或币种间余额转移。切换币种不会替换既有订单的币种符号。

新下单明确带币种，API 只读取该套餐对应 plan_prices 的独立定价，并检查套餐及该币种价格均已启用。缺少报价或被禁用时不能下单，不会悄悄使用另一币种价格。幂等指纹包括币种；同一个键改币种重试属于冲突。网络结果不确定时保留原请求体和原键重试。

概览的金额、服务数和账单数按选择币种查询；客户总数仍是全局数量。订单、账单历史保留各自原币种，最近订单可出现多种币种，每条都单独标明。不要把 CNY 和 USD 相加生成一个“总金额”，也不要把截断到 1,000 条的列表当作完整财务导出。

## 套餐价格的受控管理

当前提供站点设置后台，**没有套餐定价编辑器**。真实运营价格必须由负责人分别审核 CNY 与 USD 的产品、税务、容量和销售政策，再由授权数据库操作人员更新。plans.price_minor / plans.currency 是旧版兼容字段，新下单权威价格是 plan_prices。不应继续仅更新旧字段。

初始迁移中的示例套餐不可售，新增 CNY 示例价也不可售。升级可能继承原 USD 可售状态，操作前逐项检查：

```sql
SELECT p.id, p.name, p.available AS plan_available,
       pp.currency, pp.amount_minor, pp.available AS price_available
FROM plans AS p LEFT JOIN plan_prices AS pp ON pp.plan_id = p.id
ORDER BY p.id, pp.currency;
```

下面是**仅供隔离测试库使用的合成价格示例**，不是建议售价、汇率或正式上线授权。实际金额要独立审批；如只允许一个币种，不启用另一个币种行。

```sql
START TRANSACTION;
SELECT id, available FROM plans WHERE id = 'starter' FOR UPDATE;
-- 示例为 CNY 39.00 和 USD 6.00，两者分别定价。
INSERT INTO plan_prices(plan_id,currency,amount_minor,available)
VALUES ('starter','CNY',3900,FALSE), ('starter','USD',600,FALSE)
ON DUPLICATE KEY UPDATE amount_minor = VALUES(amount_minor), available = FALSE;
-- 先复核以上待启用值，再按批准的币种开启。
UPDATE plan_prices SET available = TRUE
WHERE plan_id = 'starter' AND currency IN ('CNY','USD');
UPDATE plans SET available = TRUE WHERE id = 'starter';
COMMIT;
```

执行前确认影响行数，失败时回滚，不在未知状态下盲目重跑。直接 SQL 不是站点设置 API，不会自动生成应用审计事件；需要数据库操作工单、前后查询结果和独立运维审计。优先在停写窗口完成价格调整并用新幂等键验证新订单；现有订单/账单的金额、币种与 issuer 快照必须保持不变。

## 支付插件边界

币种、价格、订单金额与账单状态由后端核心负责。未来支付插件声明支持币种和能力，创建支付会话、验签并规范化回调；核心仍负责金额/币种/订单绑定校验及幂等落账。支付保持禁用；官方 SMTP 默认关闭，只支持管理员测试邮件，不存在真实 webhook 结算或退款。详见 [PLUGINS.md](PLUGINS.md)。
