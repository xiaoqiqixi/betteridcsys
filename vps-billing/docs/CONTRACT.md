# 当前 API 与业务约定

本文件对应 Core 0.5.0 的可配置财务币种、独立报价、历史快照与独立 SMTP 插槽。默认站点名“星屿云”、语言 `zh-CN`；全新安装只启用默认币种 `CNY`，升级保留旧币种及合法默认值。前端 Vue/TypeScript，后端 Go，持久化 MySQL InnoDB；显式 demo 模式仅使用内存。支付、真实 VPS 开通与完整财务账本均未实现；官方 SMTP 默认关闭，仅提供管理员配置和测试邮件，未接入通知、邮箱验证或密码找回。

## 共通规则

- API 前缀 `/api/v1`；成功 `{data: ...}`，失败 `{error:{code,message,request_id?}}`。
- 时间 RFC3339 UTC。`*_minor` 是整数最小单位，按该记录 `currency_format.decimal_places`（0–6）解释，上限 `9007199254740991`；不隐式舍入、换汇或跨币种汇总。
- 浏览器通过同源 HttpOnly cookie 鉴权，变更请求必须携带 `X-CSRF-Token`，校验来源和 Host。价格、角色、所有权及付款结果不信任浏览器。
- 结构化错误 code 用于界面翻译；无法识别的新错误回退为安全通用文案，不向用户显示 SQL、密钥或服务商原始错误。
- 当前列表上限 1,000；金额汇总使用 SQL 聚合而非列表求和，`unpaid_total_minor` 是所选币种全部待付金额。没有完整分页/导出协议。

## 主要接口

| 方法与路径 | 权限 | 行为 |
|---|---|---|
| `GET /healthz`, `/readyz` | 公开 | 存活；数据库连接和迁移历史就绪 |
| `GET /api/v1/session` | 公开 | `{user,csrf_token,demo_mode}`；user 只有公开身份字段 |
| `POST /auth/login`, `/auth/logout` | 会话 + CSRF | 登录轮换 cookie/token；注销撤销原会话 |
| `GET /site-settings` | 公开 | 公开站点展示字段与默认语言/币种 |
| `GET /currencies` | 公开 | 币种显示、启用、默认与精度锁定元数据，包括停用项；不含管理使用计数 |
| `GET /admin/currencies` | 管理员 | 完整币种清单、revision 与使用/义务计数 |
| `POST /admin/currencies` | 管理员 + CSRF | 全量登记清单；revision、代码保留、精度锁定及停用义务校验 |
| `GET /admin/plan-prices?currency=CODE` | 管理员 | 指定币种的现有套餐报价及全局价格 revision |
| `POST /admin/plan-prices` | 管理员 + CSRF | 单币种批量局部更新价格与开关，事务审计 |
| `GET /plans?currency=CNY` | 公开 | 该币种独立报价；缺失/禁用不可购买 |
| `GET /overview?currency=CNY` | 客户 | 该币种金额/计数与带各自币种的最近订单 |
| `GET /services`, `/orders`, `/invoices`, `/audit` | 客户 | 仅本人资源；历史各保留原币种 |
| `POST /orders` | 客户 + CSRF | `{plan_id,hostname,currency,quote?}`，必须有 `Idempotency-Key` |
| `GET /invoices/{id}` | 账单所有人 | 直接按账单 ID 和当前用户查找，不依赖列表上限 |
| `POST /invoices/{id}/checkout` | 账单所有人 + CSRF | 未配置提供商返回 503 `PAYMENT_NOT_CONFIGURED`，不改变付款状态 |
| `GET /admin/overview?currency=CNY` | 管理员 | 该币种金额/服务/账单数；客户数是全局 |
| `GET /admin/customers`, `/admin/orders`, `/admin/invoices` | 管理员 | 全站只读列表 |
| `GET /admin/invoices/{id}` | 管理员 | 直接读取任意账单；该路由无支付操作 |
| `GET /admin/site-settings` | 管理员 | 完整站点设置及 revision |
| `POST /admin/site-settings` | 管理员 + CSRF | 校验字段与 revision；同事务更新设置与审计，冲突拒绝 |
| `GET /admin/updates` | 管理员 | 当前 Core/SMTP 审批版本与本地查询快照，不主动联网 |
| `POST /admin/updates/check` | 管理员 + CSRF | 严格空 JSON `{}`；明确检查固定官方正常 Release |
| `POST /admin/updates/handoff` | 管理员 + CSRF | 重核候选/本地状态、保存审计后生成未签名主机交接，不安装/执行 |
| `GET /admin/integrations` | 管理员 | 只读适配器能力/配置字段说明，永不返回秘密值或引用 |
| `GET /admin/plugins` | 管理员 | 被动发现清单与 SMTP 本地审批状态，不执行代码/连接 |
| `POST /admin/plugins/check` | 管理员 + CSRF | 严格空 JSON `{}`；主动兼容握手，不传 SMTP 凭据、不发信 |
| `GET /admin/email-settings` | 管理员 | SMTP 非秘密配置、revision、凭据/密钥标志和插件/目的地状态 |
| `POST /admin/email-settings` | 管理员 + CSRF | 保存 SMTP 配置及加密凭据；revision 冲突拒绝，配置/审计同事务 |
| `POST /admin/email-settings/test` | 管理员 + CSRF | `{revision,to}`；仅按已保存启用配置发送单封固定测试邮件 |

上表除健康路径外均相对于 `/api/v1`。确切路由与响应结构以同提交 `backend/internal/billing/http.go`、`models.go` 和测试为准；实现新增字段应同步更新前后端类型。

## 金额、订单和身份

`plan_prices(plan_id,currency,amount_minor,available)` 是独立报价来源。下单事务锁定币种配置、套餐及对应报价，验证币种启用、套餐总开关及该币种报价开关；未知 JSON 字段直接拒绝。订单、账单、幂等记录、审计与 outbox 原子提交；订单与账单保存金额、币种、币种格式及运营身份快照；新订单另存套餐规格/月周期快照，历史缺失套餐快照不补造。服务记录同样携带不可变币种格式。

套餐响应带全局 `price_revision`。新客户端始终提交 `quote:{price_minor,decimal_places,price_revision}`，核心在事务锁内核对当前金额、精度和版本，不匹配返回 409 `PRICE_CHANGED` 且不生成订单/账单/outbox。quote 结构无效返回 400 `INVALID_QUOTE`。为旧客户端兼容，quote 可省略，旧调用按执行时权威价格执行；不能声称所有客户端都防止陈旧报价。

已完成的幂等重放先返回原订单快照，不受今日价格或 quote 变化影响；quote 是首次执行的确认条件，不加入旧幂等指纹。相同用户、相同幂等键、相同请求返回原订单；改变币种/套餐/主机名会冲突。数据库死锁/锁超时有限次重试；客户端面对不确定提交结果应重用原键与原请求，而不是生成新键。创建订单不创建 VPS、不记录假付款、不消费 outbox。

修改价格、运营公司或账单抬头只影响之后创建的记录。旧记录无 issuer 快照时维持缺失，不能以当前设置补写假历史。没有退款、续费、钱包、余额换汇、税务发票或账务分录系统。

## 设置与偏好

支持站点/公司名称、预设标志/主题、支持邮箱/HTTPS 链接、展示 HTTPS 来源、纯文本邮件署名、账单抬头/地址与默认语言/币种。公开读接口省略私有运营字段。没有任意 HTML/CSS/脚本、远程资源抓取、图片上传或 DNS/TLS 配置。详细限制见 [SITE_SETTINGS.md](SITE_SETTINGS.md)。

语言和币种是独立浏览偏好；语言支持 `zh-CN`/`en`，币种来自登记表，新报价仅选择启用项，缺省回退到已配置的默认币种。用户输入数据不自动翻译；选择新币种不改变已开具记录。服务商密钥不通过站点设置保存。

## 财务配置接口

`GET /currencies` 和管理员读取返回 `{revision,default_currency,currencies}`。每项含 `code,name,prefix,suffix,decimal_places,enabled,sort_order,precision_locked`；管理员额外得到 `usage`，含 `plan_prices/orders/invoices/services/pending_orders/unpaid_invoices/ongoing_services` 计数。公开元数据包括停用币种供历史显示，不能把它们作为新下单候选。

`POST /admin/currencies` 全量提交 `{revision,default_currency,currencies:[{code,name,prefix,suffix,decimal_places,enabled,sort_order}]}`，所有字段必需，不回传只读计数/锁定字段。代码为 3 个大写 ASCII 字母，不可删除；最多 32 项，名称 1–80 字节，前/后缀各 0–24 字节，小数位 0–6，排序 0–10000，默认项必须启用。已有价格或业务记录永久锁定精度；有待付款订单、未付账单或非 terminated 服务时不能停用。

价格读取返回 `{revision,currency,currency_format,plans:[{plan_id,plan_name,plan_available,amount,amount_minor,available}]}`。缺价时 amount 为空、amount_minor 为 0 且不可售，不表示免费。更新提交 `{revision,currency,prices:[{plan_id,amount,available,plan_available}]}`，1–500 行局部 upsert，不删除其他价格。amount 为正十进制字符串，不接受数字 JSON、符号、指数、前导零、超精度或零价；不自动舍入。`plan_available` 是跨币种的套餐总开关。价格 revision 跨币种共享；修改一项也可能使另一旧表单冲突。

财务写入限制为 64 KiB 严格 UTF-8 JSON，拒绝缺失、重复、未知、null 和错误字段大小写。`INVALID_CURRENCY_CONFIG/INVALID_PLAN_PRICES/UNSUPPORTED_CURRENCY` 返回 400；`CURRENCY_CONFLICT/PRICE_CONFLICT/CURRENCY_PRECISION_LOCKED/CURRENCY_DISABLED/CURRENCY_IN_USE` 返回 409，最后一项含 `details:{currency,usage}`。币种与价格修改分别和审计原子提交。

`currency_format` 字段为 `{code,name,prefix,suffix,decimal_places}`。新订单 `plan_snapshot` 为 `{plan_id,name,cpu,memory_gb,disk_gb,transfer_tb,region,billing_cycle:"monthly"}`；旧订单该字段可缺失。详见 [财务模型及迁移边界](FINANCIAL_MODEL.md)。

## 适配器

支付保持禁用；官方 `email.smtp` 是独立进程的运行时插件，默认关闭且无内置传输回退。SMTP 保存请求必须包含 `revision/enabled/host/port/tls_mode/from_address/from_name`；`username/password` 只写，空值保留；显式清除须同时清除两项并关闭。更改服务器地址、端口或 TLS 模式时必须替换完整凭据或同时清除并关闭。请求拒绝重复/未知字段、null 和超过 8 KiB 的正文。配置可在插件安装前保存，保存不连接或发信；实际测试还须通过 root 审批、程序/兼容/UID/握手及精确目标检查。

读取不返回用户名、密码或密文，返回 `username_configured/password_configured/key_configured` 与 `plugin_available/plugin_status/plugin_version/destination_allowed`。`key_configured` 仅表示已加载本机密钥；`plugin_status` 为 `not_installed/disabled/unavailable/approved`，`approved` 是本地验证结果，非服务连通或投递证明。插件握手检查失败返回 503 `PLUGIN_UNAVAILABLE`，匿名 401、客户 403；该接口不是安装/审批入口。

测试成功 `{data:{status:"accepted"}}` 表示 SMTP 接受，非收件箱投递证明。未启用返回 409 `SMTP_DISABLED`，配置版本冲突 409 `SETTINGS_CONFLICT`，密钥不可用 503 `SMTP_KEY_UNAVAILABLE`，限速 429 `RATE_LIMITED`，未确认接受 502 `SMTP_UNAVAILABLE`，结果不确定 502 `SMTP_DELIVERY_UNCERTAIN`。客户端不得自动重发不确定请求。

插件不获得数据库/Store、会话秘密或加密密钥；金融状态仍由核心控制。Core 只发现已安装 manifest，只有 root 明确批准版本后才连接独立进程；新增兼容插件可独立构建/替换，无需重编 Core。没有网页上传或恶意代码沙箱。配置、安装/回退、TLS、时限、审计与恢复要求见 [PLUGINS.md](PLUGINS.md) 和 [PLUGIN_PROTOCOL.md](PLUGIN_PROTOCOL.md)。

## 管理员版本更新

模式固定 `manual_host_handoff`。读取返回 `current`（core_version、smtp_version/status、plugin_policy_revision）、`source`（固定 repository、not_checked/available/unavailable）、checked_at 与 items。SMTP 版本来自本地审批，不证明进程运行；未检查/查询失败不得表示没有新版本。候选包含 component、稳定 tag/version、固定官方 release_url、纯文本 notes、发布时间/源码、Release/build标识、按分发类型声明的资产摘要/大小、compatible/update_available、preconditions 与 catalog_sha256。

交接请求严格限定 `{component,tag,source_sha,release_id,catalog_sha256,acknowledge_manual_handoff:true}`，不得传任意URL、命令、目录或token。请求最多4KiB，拒绝未知/重复/null/错误类型；未明确确认返回400 `UPDATE_ACK_REQUIRED`。服务端重查官方信息，确认选择指纹、本地版本/策略仍一致且候选可更新，再持久审计后以202返回交接封装；新后台统一返回 `{schema:2,status:"awaiting_host_operator",intent:{...}}`，intent 同为 schema 2，声明 `distribution_format`（`raw-binaries-v1` 或 `archive-v1`）及对应资产；主机工具兼容读取既有 schema 1 交接，但仅接受旧四资产归档。intent 包含请求/操作者ID、创建/到期时间、固定仓库身份、组件/版本/源码、构建与资产、当时Core/插件/策略信息，有效期30分钟。交接未签名，不是主机安装授权或安装成功。

官方不可用返回503 `UPDATE_UNAVAILABLE`，已有检查返回409 `UPDATE_BUSY`，选择/现场变化返回409 `UPDATE_STALE`，不兼容/不是新版本返回409 `UPDATE_INCOMPATIBLE`。权限与CSRF/Origin/Host沿用通用规则；审计/网络失败或响应不确定不能假称交接成功或自动重复提交。主机工具独立核验与暂存，实际应用仍按 [UPDATES.md](UPDATES.md)及 [UPGRADE.md](UPGRADE.md)执行。
