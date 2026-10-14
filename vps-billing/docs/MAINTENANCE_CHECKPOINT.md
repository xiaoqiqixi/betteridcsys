# 云端维护检查点（未完成候选发布）

日期：2026-10-14。基线：`338d98b23bf190198a0efa34b7200aabc4ead35c`。
开发分支：`codex/security-maintenance-20261014`。根目录 LICENSE、README 未修改。

本检查点用于继续开发和指定模型的下一轮审查，不能部署到有真实客户数据的环境，不能作为最终 Release。

## 已实现

- MySQL 强制 TLS 模式拒绝 `allowFallbackToPlaintext=true`，阻止配置允许明文降级。
- 可信代理的 IPv6 地址归一化后用于登录限速，避免同一地址不同写法获得不同预算。
- JSON 请求检查真实媒体类型，拒绝 `application/json-fake` 等错误类型。
- 管理员只读账单详情路由 `/api/v1/admin/invoices/{id}`；客户仍受所有权限制，管理员详情路由不支持支付。
- 前端账单详情使用请求代数，关闭弹窗后旧响应不能覆盖新账单；管理员使用对应详情路由。
- 备份临时文件由 mktemp 独占创建，最终文件保留随机后缀，避免同一秒并发覆盖。
- 站点设置后端模型和内存/MySQL 存储；管理员读写、CSRF、版本冲突、事务审计。公开读接口仅返回展示字段，不公开邮件署名和账单地址。
- 新账单保存开具时的公司抬头、地址、支持邮箱快照；已有账单没有快照时保持空值，不把当前设置冒充历史身份。
- 编号 2 的站点设置迁移，编号 3 的双币种价格表迁移。原始迁移 1 未修改；校验所有迁移 checksum，并拒绝较新数据库版本。重复执行已有迁移和 MySQL DDL 部分恢复处理已有基础验证，尚无完整升级/故障注入认证。

设置支持 site_name、company_name、logo（star/cloud/server 预设）、theme（blue/teal/violet）、support_email、support_url（HTTPS）、display_url（只展示 HTTPS 来源）、email_signature（纯文本，邮件仍禁用）、invoice_issuer、invoice_address，以及 default_locale（zh-CN/en）和 default_currency（CNY/USD）。默认星屿云、简体中文、CNY。此处描述的是后端基础，并不代表前端或财务双币种流程已完成。

## 实际验证

工具链：Go 1.27.2（从 go.dev 官方下载并核验 SHA-256）、Node 24.19.0、锁定 npm 依赖。

- Go 全量 race 测试通过，含 5 项新增设置/安全回归；真实 MySQL 测试没有跳过。
- Go vet 和 Linux amd64、CGO_ENABLED=0 编译通过。
- MySQL 8.4.11，使用本云端一次性容器 `aster-maintenance-mysql` 和独立 `aster_maintenance_test` 数据库；迁移 1/2/3、重复迁移、就绪校验、16 请求并发幂等、冲突回放、事务回滚、所有权、汇总通过。
- MySQL 测试补充设置持久化、版本冲突、历史开票身份不变和管理员直接账单读取，结果单列在 mysql-checkpoint.log。
- 前端 22 项单元/组件测试、类型检查、Vite 构建和格式检查通过，含旧账单请求迟到回归。
- bash 语法检查、mock Docker 的并发备份/失败清理通过；这不是实际 mysqldump 或恢复演练。
- 证据位于云端 `/tmp/aster-evidence/`，构建暂存 `/tmp/aster-checkpoint-api`，不是最终发布文件。

Docker 镜像：`mysql:8.4@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70`。仅在本云端运行，未使用用户 Mac、外部服务器或真实账号/支付/邮件。

## 必须继续完成

1. 站点设置管理员界面、品牌应用和预览；当前主界面仍有原先硬编码名称。标志仅有预设，未实现上传。
2. 简体中文/English 和 CNY/USD 两个独立选择项及偏好。完整页面、错误和模板翻译/回退尚未实现。
3. `plan_prices` 尚未用于下单，当前业务仍使用原 USD 单价格；设置的默认币种尚未生效。必须由后端选择显式独立价格、验证只允许 CNY/USD，并将币种纳入幂等指纹、订单/账单快照和按币种汇总。绝不只换货币符号或做隐式 FX。
4. 编号 3 中 CNY 示例价 3900/7900/15900 是独立的、不可售的合成测试价格，不能据此推断汇率或运营价格。保留已有 USD 值；真实套餐仍需经营方审查。
5. 发布/安装/升级/安全/恢复文档更新，Linux amd64 最终归档、校验和、依赖清单及 Release 说明。
6. 新旧数据库升级/中断恢复、runtime 最小权限、Docker Compose 全栈、完整自动化 E2E 和真实备份恢复尚需验证。HTTP/config 独立冒烟本轮也尚未重新执行。
7. 当前没有完成并推送最终候选 PR/Release。GitHub connector 读取成功且仓库 private；环境 gh 的 GH_TOKEN 无效，去除该变量后也没有已登录身份。不要打印或挪用凭据。Git push 可单独按现有授权验证；GitHub 发布工具当前未暴露 release API。

模型：本轮无法从可信运行时元数据确认精确模型或推理档位，也不能更改已经运行的推理。用户新要求为 `gpt-6-astra` / `ultra`；由父线程为下一轮明确设置，不声称本轮已经切换。
