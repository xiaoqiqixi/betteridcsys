# 支付与邮件适配器约定

当前提供安全禁用的支付实现和默认关闭的官方 SMTP 插件 `email.smtp`。SMTP 仅支持管理员保存配置并主动发送固定测试邮件；未接入业务通知、邮箱验证或密码找回。没有真实扣款、退款、webhook 落账或 VPS 开通。

## 职责边界

`backend/internal/integrations` 定义接口、能力清单、配置校验、注册表与有超时限制的调用。核心注入受管理的 SMTP 服务；传输代码位于 `backend/plugins/smtp`，只接收本次配置和消息，不读取文件或访问 Store。授权、凭据解密、版本冲突、限速和审计由核心处理。

核心负责账号/账单所有权、CNY/USD 独立价格、金额/币种与身份快照、订单幂等、账务状态和审计。支付插件负责声明支持币种及能力、创建支付会话，以及未来回调验签与规范化；插件不能决定“客户端报多少就收多少”，也不能直接修改账单。插件收到类型化业务数据和 context，不获得 SQL/Store 或任意管理权限。

适配器作为受信 Go 代码与 API 同进程运行，不提供动态上传或恶意代码沙箱。新增代码需要审查与重建；SMTP 管理配置保存后生效，改变本机加密密钥文件或环境配置需要重启 API。

## 选择、配置与秘密

保留 `PAYMENT_PROVIDER=payment.disabled`、`EMAIL_PROVIDER=email.disabled`。官方 SMTP 由独立的管理设置控制，**`EMAIL_PROVIDER=email.disabled` 不是 SMTP 总开关**，也不应改为 `email.smtp`。未设置 `SMTP_ENCRYPTION_KEY_FILE` 时不能启用或发送；设置了无效密钥文件会拒绝启动。旧注册表选择未知 ID、重复注册或无效配置仍拒绝启动。

可选 `INTEGRATIONS_CONFIG_FILE` 是本地 JSON 的“适配器 ID → 字段值”映射，上限 64 KiB。拒绝重复键、未知提供商/字段、null、非字符串和尾随 JSON。清单字段声明 key、label、type、required、secret；秘密字段必须用 `secret_ref`，指向 `env:UPPER_CASE_NAME` 或 `file:/absolute/path`，不能直接写秘密值。

示意（此 example 适配器**没有安装**，不要配置到当前服务）：

```json
{"payment.example":{"api_key":"file:/run/secrets/payment_key","merchant":"example-merchant"}}
```

上面的配置文件机制不用于官方 SMTP；其用户名和密码通过独立的管理员接口写入。解析错误、API、日志不应暴露秘密值、文件路径、引用字符串、回调原文或服务商原始错误。公开站点设置和品牌设置不接受服务商凭据。

配置中 URL 类型要求 HTTPS，但语法校验不能替代适配器的目标限制：未来插件要使用固定供应商目标/精确白名单并防止 SSRF，不默认开放任意上游 URL。原生服务模板未配置出口防火墙；新增外部服务需要独立审查受控出口、DNS、证书、超时与日志。

## 管理员只读清单

`GET /api/v1/admin/integrations` 返回 `{data:{items:[...]}}`，仅管理员可读。每项包含 id、kind、name、description、enabled、configured、status、capabilities、configuration_fields、configuration_mode、limitations 及实现声明的币种信息。项目按 ID 排序。

SMTP 清单声明 `configuration_mode=admin_api`、能力 `admin_test_email`。`configured` 要求本机密钥可用、凭据可解密且配置有效；`ready` 不代表外部连通或投递成功。保存为启用但密钥缺失/不匹配时显示 `unavailable`，实际 `enabled=false`；保存为关闭时显示 `disabled`。清单不含配置值或秘密引用，不能 POST 修改。匿名请求 401、客户 403。

## 官方 SMTP 配置与测试

先按 [安装手册](INSTALL.md#可选smtp-加密密钥)准备本机密钥，并完成迁移 006。管理员在扩展中心配置 SMTP；保存不主动连接服务器，也不发送邮件。

| 字段 | 约定 |
|---|---|
| `revision` | 读取时取得的当前版本；冲突返回 409，不覆盖他人修改 |
| `enabled` | 默认 false；启用要求有效配置、可解密的完整凭据和本机密钥 |
| `host` / `port` | DNS 主机名或 IP、1–65535；不填 URL。允许同机/私网中继，须限制获准目的地与主机出口 |
| `tls_mode` | `starttls` 或 `implicit_tls`；常见端口分别为 587 / 465，实际按服务商配置 |
| `from_address` / `from_name` | 单个 ASCII 裸邮箱和纯文本展示名；不得使用地址列表或注入头部 |
| `username` / `password` | 只写字段；留空/省略表示保留。读取只返回是否配置，不回显用户名、密码或密文 |
| `clear_username` / `clear_password` | 清除时必须同时为 true 且 `enabled=false`；不能同时传入同一字段的新值 |

更换 host、port 或 TLS 模式且已保存凭据时，必须同时重新输入两项凭据，或同时清除并关闭，避免旧凭据被发往新目的地。同一目的地可单独更新密码；原密文不可解密时只能完整替换或完整清除。`key_configured` 仅表示本机已加载密钥，不保证旧密文能被该密钥解开。

用户名和密码作为一组使用 AES-256-GCM 加密保存到 `email_settings`，包含随机 nonce 和固定插件用途绑定。其他连接/发件字段不加密。数据库备份含凭据密文，必须与密钥分开保护；恢复和轮换见 [备份恢复](BACKUP_RECOVERY.md#smtp-密钥备份恢复与轮换)。

传输最低 TLS 1.2，验证系统信任链及 host 对应的 DNS/IP 身份；STARTTLS 不可用、证书不可信或名称不匹配时停止，不回退明文。仅在验证 TLS 后使用 AUTH PLAIN 或 LOGIN；不支持匿名中继、OAuth 或跳过证书验证。本地中继也遵守这些要求。私有 CA 应由主机管理员审查系统信任配置，不提供网页上传 CA 或关闭校验的入口。

保存并启用后，输入一个获准的测试收件地址再主动测试。测试使用当前已保存 revision、固定主题与纯文本正文，不采用站点邮件署名；不提供任意内容、HTML、附件、批量收件人或发送队列。每进程最多一个在途测试，启动间隔至少 30 秒。HTTP 请求上下文上限 12 秒，独立传输上限 30 秒受调用方更短期限约束；最终审计另有最多 2 秒的有界写入。

`accepted` 只表示 SMTP 服务器已接受，不保证到达收件箱。MAIL 命令前的明确暂时失败最多自动重连一次；MAIL 开始后不自动重试。出现 `SMTP_DELIVERY_UNCERTAIN`、浏览器断网或响应丢失时，先核对服务商日志与收件箱，不能直接再次发送。最终审计失败不会把已接受结果改成可重发；审计记录请求与分类结果，不保存凭据、收件地址或邮件正文。

本地 SMTP/TLS 测试不能证明真实服务商连通性、SPF/DKIM/DMARC 或收件箱投递。准确执行范围见 [验证记录](VALIDATION.md)；传输实现细节见源码包中的 `vps-billing/backend/plugins/smtp/README.md`（运行包不含后端源码）。

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

以上持久化结算去重、财务分录、回调路由和对账流程**当前均未实现**。服务商沙盒及受控资源测试完成后，仍需另行授权真实收款与开通。

## 新增适配器检查项

创建专用包，实现对应接口；使用有超时的 HTTP 客户端、受限目标、取消处理与脱敏日志。声明最小能力、支持币种、配置字段和 checkout 精确主机。代码注册工厂后，测试重复 ID、缺失配置、秘密引用、取消/超时、错误身份/金额/币种、URL 拒绝、重放、幂等和并发。默认测试不得访问真实支付/邮件服务。

SMS、对象存储和控制器只是未来方向，没有安装对应提供商。遇到实际需求再定义各自的类型化接口与权限，不用通用 Execute(map) 把不同安全边界混在一起。
