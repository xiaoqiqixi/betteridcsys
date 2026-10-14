# Aster Billing API（星屿云）

Go HTTP API、MySQL 8.4/InnoDB 存储和显式 demo 内存模式。当前候选范围为可配置运营身份、简体中文/English、独立 CNY/USD 报价及订单/账单；支付、邮件、退款、财务账本和 VPS 开通仍未接入。完整 API 约定见 [CONTRACT.md](../docs/CONTRACT.md)，实际验证见 [VALIDATION.md](../docs/VALIDATION.md)。

## 本机演示

使用受支持、已更新的 Go 工具链；模块最低声明为 1.24.0，发布使用的精确版本记录在 BUILD.json。前端开发版本见 package.json/锁文件；发布包运行不需要 Node.js。

```sh
cd backend
go mod download
go test -race ./...
go vet ./...
go build -buildvcs=false -o ./bin/aster-api ./cmd/server
APP_MODE=demo APP_ORIGIN=http://localhost:5173 ./bin/aster-api
```

默认监听 127.0.0.1:8080。前端同源代理 /api，禁止开放 demo 或 Vite 到公网。只在显式 APP_MODE=demo 可用的公开测试账号：

| 用途 | 邮箱 | 密码 |
|---|---|---|
| 客户 | demo@aster.local | DemoCustomer!2026 |
| 管理员 | admin@aster.local | DemoAdmin!2026 |
| 另一客户（所有权测试） | other@aster.local | DemoOther!2026 |

demo 无初始服务或假已付账单；创建订单只生成待付款记录，重启丢失内存数据。HTTP demo cookie 保持 HttpOnly/SameSite=Strict，但没有 Secure。默认生产模式不创建这些账号，不能通过切到 demo 绕过配置错误。

## 配置

| 环境变量 | 作用 |
|---|---|
| APP_MODE | production（默认）或显式 demo |
| LISTEN_ADDR | 默认 127.0.0.1:8080；容器内部 0.0.0.0:8080 |
| APP_ORIGIN | 精确 HTTPS 来源，无路径/尾斜杠，如 https://billing.example.com |
| SESSION_SECRET / SESSION_SECRET_FILE | 独立随机秘密，至少 32 字节；优先受限文件 |
| MYSQL_DSN / MYSQL_DSN_FILE | Go MySQL DSN；生产优先验证证书的 tls=true |
| MYSQL_ALLOW_INSECURE | 默认 false；true 仅用于已审查的隔离同机测试网络 |
| TRUSTED_PROXY_CIDRS | 直接可信代理精确 CIDR；空值不信任转发地址 |
| BOOTSTRAP_EMAIL / NAME / ROLE | CLI 创建用户；role 默认 customer，管理员需显式 admin |
| BOOTSTRAP_PASSWORD / BOOTSTRAP_PASSWORD_FILE | 唯一 16–72 字节强口令，不用 demo/示例值 |
| PAYMENT_PROVIDER / EMAIL_PROVIDER | 默认 payment.disabled / email.disabled |
| INTEGRATIONS_CONFIG_FILE | 可选受限本地 JSON；当前禁用适配器无需配置 |

FILE 形式优先。生产拒绝弱/示例会话秘密、无 DSN、非 HTTPS 来源、无效代理 CIDR/未知模式。强制 TLS 时拒绝 skip-verify、preferred 和明文回退。不要在源码、命令行、聊天或日志中存密码/DSN。

生产 cookie 是 __Host-aster_session，Secure、HttpOnly、SameSite=Strict、Path=/。API 端口不公开，可信反向代理覆盖 X-Real-IP，客户端原始转发头不可信。仅从配置的直接 peer CIDR 接受该头，IPv4/IPv6 地址归一化用于限速；不信任 X-Forwarded-For。不能使用 0.0.0.0/0 或任意私网作为代理信任。

## 数据库、迁移与身份

迁移 1/2/3 保持原文，迁移 4 新增订单 issuer 快照和受支持币种/精确金额约束，迁移 5 对订单/账单/服务加入二进制币种约束，拒绝小写或带重音的近似值。全部嵌入二进制，经数据库 advisory lock 串行执行，schema_migrations 保存编号/checksum；就绪检查验证完整 1–5 历史并拒绝未知新版本。MySQL DDL 不能整体事务回滚，已知中断恢复有专门处理，不能手改迁移记录绕过错误。

以独立 DDL 身份执行 `aster-api -migrate`，API 用只有本库 SELECT/INSERT/UPDATE/DELETE 的 DML 身份。CLI 仍需完整生产配置。以 BOOTSTRAP_* 配置执行 `aster-api -create-user` 创建测试用户；没有公开注册、密码找回、自助改密、MFA、角色修改或完整账号管理 API。详细配置和权限步骤见 [INSTALL.md](../docs/INSTALL.md)。

初始示例套餐不可售；升级保留既有 USD 可售状态。新下单读取 plan_prices 的 CNY/USD 独立报价，不再以旧 plans.price_minor/currency 为权威；需要套餐和所选币种均可售。没有后台套餐编辑器，受控 SQL 定价程序见 [SITE_SETTINGS.md](../docs/SITE_SETTINGS.md)。

## 会话与下单

1. GET /api/v1/session 获取 cookie 和 CSRF。
2. POST /api/v1/auth/login 携带 JSON email/password 与 X-CSRF-Token；成功后使用新 token。
3. GET /plans?currency=CNY 读取报价。省略查询币种使用站点默认；仅支持 CNY/USD。
4. POST /orders 携带 `{"plan_id":"starter","hostname":"web-1","currency":"CNY"}` 和唯一 Idempotency-Key（8–128 个 ASCII 字母/数字/_.:-）。
5. 所有变更都需 CSRF；存在 Origin 时必须精确匹配 APP_ORIGIN。未知 JSON 字段（含客户端价格/owner/role）拒绝。
6. 注销撤销原会话并轮换匿名 token；会话 8 小时到期，数据库保存 token 哈希。

请求 locale 使用受支持的语言，界面独立选择 zh-CN/en，默认中文。locale 不决定货币；报价/统计按显式 currency 查询。客户数全局，服务/账单计数和金额按币种。列表历史可以混合两种币种，每条记录自己的币种，不跨币种求和。

同用户同幂等键同请求返回原订单；改变 currency/plan/hostname 冲突。MySQL 使用唯一请求键和事务；死锁/锁超时最多有限次重试。网络结果不明时复用原键及原请求。订单、账单、幂等记录、审计和 outbox 原子提交；金额、币种和运营身份快照之后不可被设置/价格更新改写。旧快照缺失不虚构历史公司身份。

金额为最小货币单位整数，CNY/USD 均两位小数，单项和汇总不得超过安全整数上限 9007199254740991；客户端格式化不能通过浮点除法丢失分值。没有汇率、充值钱包或换汇。

## 站点设置与支付边界

GET /site-settings 公开展示子集；管理员 GET/POST /admin/site-settings 读写完整设置。写入校验角色、CSRF、revision，设置与审计同事务；冲突返回 409。只接受纯文本、预设 logo/theme 和受限 HTTPS 链接，不接受任意脚本/HTML/CSS、远程抓取、文件上传或服务商秘密。展示地址不控制 DNS、证书或 APP_ORIGIN。

管理员 GET /admin/invoices/{id} 提供直接只读详情；客户 GET /invoices/{id} 仍按所有权查询，避免用最多 1,000 条列表筛选漏掉旧账单。

POST /invoices/{id}/checkout 核对所有权和待付状态后调用类型化注册表。当前只装禁用适配器，返回 503 PAYMENT_NOT_CONFIGURED，不改变订单/账单/服务。没有支付 webhook、真实验签落账、退款、续费、余额更新或 outbox 消费者。order.created 不是开通授权。详见 [PLUGINS.md](../docs/PLUGINS.md)。

## 测试

```sh
go test -race -v ./...
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false ./cmd/server
```

真实 MySQL 测试只在显式配置 ASTER_MYSQL_TEST_DSN 时执行；专用库名必须含 _test，绝不能连接生产。使用受限进程环境注入测试 DSN，避免命令行暴露秘密。测试有 DDL/DML，需要一次性库；检查测试代码的清理范围，保留未知数据库不动。

```sh
# ASTER_MYSQL_TEST_DSN 已由受限测试环境提供。
go test -race -v ./internal/billing -run TestMySQL
```

测试结果的“跳过”不等于通过。HTTP/config 独立回归在 ../tests，完整发布/恢复门槛见 [RELEASE.md](../docs/RELEASE.md)。列表仍上限 1,000 且无分页/完整导出；审计非不可篡改账本；登录限速为进程内；没有后台会话清理、异地备份/PITR 或部署监控。上述边界不会因本轮测试通过而自动消失。
