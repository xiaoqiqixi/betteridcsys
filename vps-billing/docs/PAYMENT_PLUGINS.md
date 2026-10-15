# 第三方支付适配器接入

支付渠道由运营者选择商户和服务商，由开发者维护对应的第三方插件／适配器。Core 提供类型化的支付扩展接口，保留账单金额、币种、身份绑定和财务状态的权威。渠道适配器负责服务商协议、结账会话及回调验签；创建支付入口、确认渠道交易和核心入账是三个不同步骤。

本文以已发布 Core 0.5.2 的支付接口为准。支付扩展目前采用 **Go 编译期注册**；独立程序的运行时发现、审批、安装与替换目前仅适用于 [SMTP](PLUGINS.md) 的 `aster.smtp/1`。不能把 SMTP manifest、Unix socket 或 `plugin-manager.py` 当作支付插件安装接口。

## 当前接口与接入位置

| 能力         | 当前实现                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| 支付适配器   | `integrations.PaymentProvider`、`Definition.PaymentFactory` 和不可变注册表                                   |
| 客户结账     | `POST /api/v1/invoices/{id}/checkout`，按持久化账单创建渠道结账会话                                          |
| 当前发行入口 | 只注册 `payment.disabled`；未知选择和非空支付配置在启动校验中拒绝                                            |
| 渠道回调     | Go 方法 `Registry.VerifyCallback` 已定义，HTTP 应用尚未路由该方法；没有可直接配置给服务商的支付 callback URL |
| 账单比对     | `ValidateSettlement` 是纯校验函数，不写账、不去重、不授权开通                                                |
| 持久化结算   | 回调接收、跨进程去重、原子财务状态转换及对账仍需作为接入工程实现和审查                                       |

源码入口：[接口类型](https://github.com/xiaoqiqixi/betteridcsys/blob/main/vps-billing/backend/internal/integrations/types.go)、[注册与结果检查](https://github.com/xiaoqiqixi/betteridcsys/blob/main/vps-billing/backend/internal/integrations/registry.go)、[结算比对谓词](https://github.com/xiaoqiqixi/betteridcsys/blob/main/vps-billing/backend/internal/integrations/settlement.go)、[HTTP 路由及 checkout](https://github.com/xiaoqiqixi/betteridcsys/blob/main/vps-billing/backend/internal/billing/http.go)、[服务器注册与启动校验](https://github.com/xiaoqiqixi/betteridcsys/blob/main/vps-billing/backend/cmd/server/main.go)。这些 `internal` 包用于当前 Go 模块内的源码集成，不是可以从任意外部项目导入的运行时 SDK。

运营者先与开发者约定渠道商户、币种与精度、结账域名、回调协议、重复通知和结果不确定时的处理，再安排受审查的构建与部署。官方安装／升级执行器继续采用 `PAYMENT_PROVIDER=payment.disabled`，不会自动接管定制支付部署。单独设置另一个 `PAYMENT_PROVIDER` 或上传文件不会安装适配器。

## 编译期注册与配置

实际接口签名如下，参数类型均来自 `integrations`：

```go
type PaymentProvider interface {
    CreateCheckout(context.Context, CheckoutRequest) (Checkout, error)
    VerifyCallback(context.Context, CallbackRequest) (VerifiedPayment, error)
}
```

受信应用代码通过 `integrations.New(ctx, definitions, options)` 提供 `[]Definition`，并在 `Options.PaymentID` 中选择 ID。每个支付 `Definition` 必须提供 `PaymentFactory func(context.Context, Config) (PaymentProvider, error)`，不能同时提供 `EmailFactory`。工厂取得的 context 有期限，适配器必须主动遵守；编译期代码与 Core 同进程，context 不是强制终止或进程沙箱。

接入时需要同时审查以下代码位置，不能只修改环境变量：

1. 当前 `cmd/server/main.go` 给注册表传入 `nil` definitions；需由受信代码加入经过审查的定义。
2. 同文件的 `loadLocalConfiguration` 目前只允许未设置／`payment.disabled`，配置文件也只接受两个禁用 ID 的空对象；定制注册必须与启动配置校验一致，不能删除未知 ID／未知字段的拒绝检查。
3. 官方 `core-operation.py` 的环境合同仍要求禁用 provider；定制部署需要独立审查安装、预检与升级兼容，不能声称现有执行器已经支持它。

| 定义项                 | 注册表实际约束                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Manifest.ID` / `Kind` | ID 匹配 `^[a-z][a-z0-9_.-]{1,63}$`，Kind 为 `integrations.Payment`；禁用内置 ID 保留，重复 ID 拒绝                                                        |
| 币种声明               | `SupportedCurrencies` 为不重复的三个大写 ASCII 字母代码，最多 64 项；`CurrencyDecimalPlaces` 必须逐代码完整对应且值为 0–6，不能多声明、缺省或推断两位小数 |
| `CheckoutHosts`        | 代码中固定的非空 DNS 主机清单，使用小写；拒绝 IP、通配符、端口和 URL。返回链接只允许精确主机匹配                                                          |
| 配置 schema            | `ConfigurationFields` 声明键、标签、类型和必填性；类型仅 `string`、`url`、`secret_ref`，秘密标记必须与 `secret_ref` 一致                                  |
| 工厂与超时             | 只构造选中的适配器，拒绝空实例；默认 8 秒，配置范围 1 毫秒至 10 秒；调用也传递受限 context                                                                |

`Config` 是 `map[string]string`，秘密字段只传 `env:NAME` 或 `file:/absolute/path` 引用，由工厂使用 `ResolveSecret` 读取；秘密值和引用都不应进入 API、错误或日志。配置文件为 provider ID 到字段对象的 JSON，最多 64 KiB，重复键、null、非字符串和未知字段拒绝。文件权限、秘密的用途、撤销和轮换仍由部署及适配器审查；通用 `ResolveSecret` 本身不是文件属主／权限验证器。`Capabilities` 是定义中的能力描述，不能据它推导已经存在退款、查询、订阅等方法。

## 客户结账 HTTP 合同

客户针对本人账单调用 `POST /api/v1/invoices/{id}/checkout`。请求需要有效会话 Cookie、正确的 `X-CSRF-Token` 和匹配的 Host；请求若带 `Origin`，必须精确匹配配置来源。管理员专用 `/api/v1/admin/invoices/{id}/checkout` 不支持该操作，返回 405；客户路径仍按当前用户过滤所有权。

当前 handler **不解析请求体**，调用方可发送 `{}`。金额、币种、精度、账户、订单、账单和幂等键均不从浏览器读取；额外 body 字段不会成为付款参数，也不能描述成已被逐字段校验的输入合同。

Core 先确认账单为 `unpaid`、没有 `paid_at`、金额为正、历史币种快照有效，且该币种仍登记／启用、当前精度与账单快照一致，再构造：

| `CheckoutRequest` 字段                  | 来源                                            |
| --------------------------------------- | ----------------------------------------------- |
| `InvoiceID`、`OrderID`、`AccountID`     | 已读取的账单及其业务绑定                        |
| `AmountMinor int64`                     | 账单保存的整数最小单位；范围 1–9007199254740991 |
| `Currency`、`CurrencyDecimalPlaces int` | 账单币种及历史精度；必须与适配器声明精确匹配    |
| `IdempotencyKey`                        | 核心生成的 `"invoice:" + invoice.ID`            |

例如 CNY 精度 2 的 `3900` 表示 39.00；精度 3 的 `3900` 表示 3.900。币种注册不等于渠道支持，适配器不能换汇、舍入或用另一币种金额替代。

`CreateCheckout` 返回 `Checkout{ProviderID, SessionID, URL, ExpiresAt}`。注册表检查 provider 与选中 ID 一致、session 非空、到期时间在未来，以及 URL 为 HTTPS、精确获准 DNS 主机、无凭据、无显式端口（包括 `:443`）、无 fragment。成功 HTTP 200 的 JSON 为：

```json
{
  "data": {
    "provider_id": "渠道ID",
    "session_id": "渠道会话ID",
    "checkout_url": "https://获准主机/渠道会话路径",
    "expires_at": "未来的RFC3339时间"
  }
}
```

这是字段形状说明，示例值不能作为有效响应使用。返回链接不代表交易已经结清；checkout 不改变账单或订单状态，也不触发资源开通。

| 情况                                | 当前 HTTP 结果                                               |
| ----------------------------------- | ------------------------------------------------------------ |
| 无权读取／不存在的账单              | 404 `NOT_FOUND`                                              |
| 状态、金额或币种快照不适合支付      | 409 `INVOICE_NOT_PAYABLE`                                    |
| 渠道不支持该代码／精度              | 409 `PAYMENT_CURRENCY_UNSUPPORTED`                           |
| 当前禁用适配器返回 `ErrUnavailable` | 503 `PAYMENT_NOT_CONFIGURED`                                 |
| 其他渠道错误、超时或非法结果        | 502 `PAYMENT_PROVIDER_ERROR`，不回显渠道原始错误、凭据或 URL |

相同账单的重复 checkout 会使用同一键，但仍会再次调用适配器。Core 当前不持久化支付会话去重；适配器需把该键绑定到同一账单、金额、币种和精度，并使用渠道支持的幂等／查询机制处理重试。超时可能发生在渠道已经创建会话之后，不能自动换键重建或把未知结果解释为交易失败。

## 回调验签、金额比对与结算责任

`CallbackRequest` 的实际字段为 `Headers map[string][]string` 和 `Body []byte`。`VerifyCallback` 的 Go 方法已存在，但没有 HTTP 接收路由、统一签名头或通用签名算法。实现渠道接入时，开发者必须依据所选服务商协议确定签名算法、原始字节／规范化规则、密钥标识、时间戳和允许重放窗口；不能从本文猜测 URL 或请求头。

适配器只有在签名、时间戳／重放窗口及商户身份全部通过后，才可返回 `VerifiedPayment`。先验签所需的原始 body 与 headers，再按渠道协议解析和规范化；拒绝缺失、冲突或不受支持的签名材料，不以浏览器回跳页、客户端“成功”字段或单纯解析 JSON 代替验签。支持多个签名密钥或轮换时，必须限制受信商户和密钥选择。原始回调、签名、密钥和渠道诊断不能写入普通业务日志。

| 已有检查                      | 精确作用与边界                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Registry.VerifyCallback`     | 调用适配器后，检查 provider 匹配、事件／交易／商户／账户／订单／账单 ID 非空、正整数金额及上界、声明的币种／精度、非零 `SettledAt`、`Status == "settled"`。注册表本身不执行密码学验签，也没有持久化重放记录 |
| `ValidateSettlement(v, want)` | 比对 provider、商户、账户、订单、账单、金额、币种、精度，并要求事件／交易 ID、settled 状态和非零时间。`want` 必须独立来自核心持久化记录与获准商户配置，不能从同一回调复制                                   |

这两个函数不能证明已收款或已入账。当前 `Store` 没有支付结算操作，也没有把它们接成可落账的 webhook 流程。`SettledAt` 非零检查本身不校验时间窗口；窗口真实性由渠道验签设计负责。`ValidateSettlement` 通过也不代表已经查询、锁定或改变订单状态。

后续接入结算服务时，至少需要在同一持久化事务中锁定并重验核心业务记录，按 **`(ProviderID, EventID)` 和 `(ProviderID, TransactionID)` 两组键**处理唯一性、重复与冲突，并原子提交付款记录、允许的状态转换及相应审计／事件。相同通知不得重复记账；同键改变身份、金额或币种须拒绝并保留诊断依据。进程内 map、单独的签名校验、先写“已付”再记去重键，都不能满足这一合同。这些是支付接入的待实现要求，当前注册表不提供该事务。

回调 HTTP 的大小／超时限制、路由授权与渠道应答、持久化重放处理、通知乱序、结果不确定时的查询／对账和恢复测试应随该结算服务一起交付；不能为支付回调关闭所有业务 POST 的 CSRF 检查。退款、订阅、结算对账和开通消费者也不能从 `PaymentProvider` 的两个方法推导为已有能力。

## 可编译的最小契约示例

完整示例位于 [example_payment_test.go](https://github.com/xiaoqiqixi/betteridcsys/blob/main/vps-billing/backend/internal/integrations/example_payment_test.go)。它使用实际 `Definition`、`Options`、`PaymentProvider` 和金额检查接口，**只在测试构建中注册** `payment.contract-example`：

- `CreateCheckout` 始终返回 `ErrUnavailable`，不创建渠道会话、不扣款。
- `VerifyCallback` 始终返回 `ErrUnavailable`，不会把未验签 body 变成付款结果；没有回调路由。
- 金额为零或精度不匹配时，注册表在调用适配器前拒绝；示例断言只有合法请求到达适配器一次。
- `ExampleValidateSettlement` 只用固定时间和合成记录展示纯字段比对与篡改拒绝，没有签名验证、数据库写入或结算副作用。

从仓库根目录运行本地示例和现有注册表回归：

```sh
cd vps-billing/backend
GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off go test ./internal/integrations
```

需要已安装符合 `go.mod` 的 Go 工具链及现有构建缓存；该命令关闭模块下载，不连接服务商、数据库或 HTTP 服务。示例不含密钥、SDK、第三方新增依赖或可用支付地址；它用于核对合同，不能作为商户接入包发布。

渠道交付时，应另外提供源码／依赖来源、商户及密钥运维说明、币种精度矩阵、签名正反例、重复／并发／篡改／超时场景和持久化恢复证据。Core 财务规则继续以 [FINANCIAL_MODEL.md](FINANCIAL_MODEL.md) 为准；运行时 SMTP 的独立安装不改变本文的支付注册方式。
