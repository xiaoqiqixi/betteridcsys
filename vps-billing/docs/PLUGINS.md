# 支付与邮件适配器约定

当前版本提供编译期扩展接口，只有安全禁用的支付和邮件实现。没有真实扣款、退款、邮件投递、webhook 落账或 VPS 开通；测试替身只存在于 `_test.go`，不注册为发布版服务商。

## 职责边界

`backend/internal/integrations` 定义接口、能力清单、配置校验、不可变注册表与有超时限制的调用。`billing.NewAppWithIntegrations` 注入经过验证的注册表；普通构造器使用禁用注册表。

核心负责账号/账单所有权、CNY/USD 独立价格、金额/币种与身份快照、订单幂等、账务状态和审计。支付插件负责声明支持币种及能力、创建支付会话，以及未来回调验签与规范化；插件不能决定“客户端报多少就收多少”，也不能直接修改账单。插件收到类型化业务数据和 context，不获得 SQL/Store 或任意管理权限。

这不是动态上传插件或恶意代码沙箱：适配器作为受信 Go 代码与 API 同进程运行。第三方不可信代码需要另行设计进程/RPC 隔离与权限；本轮没有这种机制。新增代码需要重建，已安装适配器的配置选择需要重启。

## 选择、配置与秘密

默认 `PAYMENT_PROVIDER=payment.disabled`、`EMAIL_PROVIDER=email.disabled`。选择不存在的 ID、重复注册、无效清单、无效选中配置或 nil 工厂结果均应拒绝启动，不能降级成假成功。

可选 `INTEGRATIONS_CONFIG_FILE` 是本地 JSON 的“适配器 ID → 字段值”映射，上限 64 KiB。拒绝重复键、未知提供商/字段、null、非字符串和尾随 JSON。清单字段声明 key、label、type、required、secret；秘密字段必须用 `secret_ref`，指向 `env:UPPER_CASE_NAME` 或 `file:/absolute/path`，不能直接写秘密值。

示意（此 example 适配器**没有安装**，不要配置到当前服务）：

```json
{"payment.example":{"api_key":"file:/run/secrets/payment_key","merchant":"example-merchant"}}
```

实际部署使用受限挂载文件或组织批准的秘密注入。解析错误、API、日志不应暴露秘密值、文件路径、引用字符串、回调原文或服务商原始错误。站点设置后台不接受服务商凭据。

配置中 URL 类型要求 HTTPS，但语法校验不能替代适配器的目标限制：未来插件要使用固定供应商目标/精确白名单并防止 SSRF，不默认开放任意上游 URL。原生服务模板未配置出口防火墙；新增外部服务需要独立审查受控出口、DNS、证书、超时与日志。

## 管理员只读清单

`GET /api/v1/admin/integrations` 返回 `{data:{items:[...]}}`，仅管理员可读。每项包含 id、kind、name、description、enabled、configured、status、capabilities、configuration_fields、configuration_mode、limitations 及实现声明的币种信息。项目按 ID 排序。

`enabled` 表示选择了非禁用实现；`configured` 表示所需配置存在，不证明外部服务可达；`ready` 表示工厂初始化成功，不是外部健康检查。`disabled` 用于未选择/安全禁用实现，`unavailable` 留给未来故障报告。清单不含配置值或秘密引用，不能 POST 修改。

匿名请求 401、客户 403；当前支付与邮件均禁用。界面可查看能力和配置要求，不把这个页面描述为已经接通服务商。

## 当前 checkout 行为

入口先检查会话、CSRF、Host、账单所有权及可支付状态（待付、正金额、无付款时间），只把核心保存的 account/order/invoice ID、金额和币种交给适配器。当前返回 503 `PAYMENT_NOT_CONFIGURED`。即使注入测试适配器返回会话地址，也不修改订单、账单、服务、账本或 outbox。

支付链接只允许注册时声明的精确 HTTPS 主机；调用有超时并传递取消信号。适配器错误用通用 502 返回，不能因一次超时自动重复产生外部副作用。未来提供商应声明支持币种，核心拒绝不支持的币种；两种核心币种不代表每个渠道都支持两种。

## 将来真实支付的独立验收

1. 对原始字节验签，校验时间窗/重放、事件类型、商户身份和请求大小。浏览器 CSRF 不能替代 webhook 签名；未来回调路由需专门设计，不复用 cookie 变更入口。
2. 规范化为 VerifiedPayment：provider/event/transaction/merchant ID、account/order/invoice ID、精确最小单位金额/币种、settled 状态与结算时间。
3. 从核心持久化记录和可信商户配置加载预期值；ValidateSettlement 比较所有标识与金额。不能用回调自己的声明构造“预期值”。
4. 在同一事务锁定并重新核验账单/订单，持久化 `(provider_id,event_id)` 与 `(provider_id,transaction_id)` 双重唯一约束，记录支付及平衡账务分录/审计，只改变状态一次，写入 payment.settled outbox。相同事件重试不重复结算，冲突重放需拒绝并调查。
5. 实现不确定结果对账、退款/争议、会话过期/重建、重试上限与恢复策略。固定账单幂等键本身不能解决所有提供商会话过期问题。
6. 只有通过审查的已结算事件才能触发开通。已有 order.created outbox 没有消费者，更不表示付款授权。

以上持久化结算去重、财务分录、回调路由和对账流程**当前均未实现**。服务商沙盒及受控资源测试完成后，仍需另行授权真实收款/邮件/开通。

## 新增适配器检查项

创建专用包，实现对应接口；使用有超时的 HTTP 客户端、受限目标、取消处理与脱敏日志。声明最小能力、支持币种、配置字段和 checkout 精确主机。代码注册工厂后，测试重复 ID、缺失配置、秘密引用、取消/超时、错误身份/金额/币种、URL 拒绝、重放、幂等和并发。默认测试不得访问真实支付/邮件服务。

SMS、对象存储和控制器只是未来方向，没有安装对应提供商。遇到实际需求再定义各自的类型化接口与权限，不用通用 Execute(map) 把不同安全边界混在一起。
