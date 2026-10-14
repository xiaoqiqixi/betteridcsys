# 官方 SMTP 传输插件

本包只负责 SMTP 传输。核心负责管理员授权、CSRF、已保存设置、凭据加密、版本冲突、发送限速和审计；插件不读取配置文件，不访问账务数据库，也不记录凭据、邮件内容或 SMTP 原始回复。当前核心只接入管理员主动测试邮件，未接入通知、邮箱验证或密码找回。

`Send(ctx, Config, Message)` 与 `NewClient().Send(ctx, Config, Message)` 使用同一实现。`ValidateConfig`、`ValidateMessage` 和 `ValidateRecipient` 只做本地验证，不连接网络。配置包含 `Host`、`Port`、`TLSMode`、`Username`、`Password`、`FromAddress`、`FromName`，凭据由调用方仅在内存中传入。

## 传输和输入边界

- 仅支持 `starttls` 和 `implicit_tls`。最低 TLS 1.2，使用操作系统信任根，必须验证证书链与配置主机的 DNS/IP 身份。STARTTLS 缺失或证书无效时停止，认证不会降级到明文。
- 管理员可配置同机或私网中继；它同样需要有效证书。主机只能是 DNS 名或不带方括号/区域标识的 IP 地址，端口为 1–65535。网络目的地的管理权限和主机出口策略由核心与运维负责。
- 认证要求用户名与密码同时存在；在验证 TLS 后优先使用服务器声明的 AUTH PLAIN，否则使用 AUTH LOGIN。不支持匿名中继、OAuth 或未声明的认证机制。
- 仅支持一个 ASCII 裸邮箱收件人及纯文本 UTF-8 邮件。拒绝展示名式收件人、多收件人、头部控制字符、地址注入及无效编码；主题最多 200 字节，正文最多 64 KiB，发件展示名最多 128 字节。正文规范化为 CRLF，并使用按行限制长度的 MIME base64 编码。
- 每次调用总上限 30 秒，DNS/连接最多 5 秒，每个协议阶段最多 10 秒；调用方更短的 context 截止时间优先。取消会关闭本次连接。每次连接最多读取 512 KiB 对端字节（包括 TLS 记录），避免无界 SMTP 回复占用内存。

## 结果与重试

只有明确发生在 MAIL 命令之前的暂时失败可能自动重试一次，间隔 200 毫秒；总计最多两次连接尝试。MAIL 开始后不自动重试。DATA 写入、终止符刷新或最终回复存在不确定性时，返回 `SMTP_DELIVERY_UNCERTAIN`，`DeliveryUncertain=true`，禁止调用方自动重发。

最终 DATA `250` 只表示 SMTP 服务器接受邮件，不保证收件箱投递。此后连接关闭错误不能改成发送失败；核心也必须保留已经明确接受的结果。没有队列、投递回执、SMTP 服务端幂等保证、DKIM 签名、HTML 或附件功能。

错误只暴露固定 `Code`、`DeliveryUncertain`、`RetryableBeforeDelivery` 分类；没有保留或展开原始网络、TLS、认证或 SMTP 错误。调用方不应将错误分类视为实际投递证明。

## 验证范围

`smtp_test.go` 使用临时本地 SMTP/TLS 服务和仅测试代码可设置的信任根，覆盖两种 TLS 模式、PLAIN/LOGIN、证书与主机名拒绝、超时/取消、有限重试、DATA 不确定性、回复字节上限、头部输入及并发会话。

`internal/billing/email_smtp_e2e_test.go` 在隔离子进程中通过标准系统证书入口装载临时 CA，验证真实管理员 HTTP → 加密保存配置 → 公开 SMTP 传输 API → 本地 TLS 接受 → 审计。生产接口没有跳过证书验证或注入测试信任根的开关。所有测试只连接回环地址，不发送外部邮件；真实服务商的连通性、SPF/DKIM/DMARC 和收件箱投递仍需单独授权和验证。
