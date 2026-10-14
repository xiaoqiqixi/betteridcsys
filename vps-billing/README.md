# 星屿云 Aster Cloud · VPS 计费平台

Vue 3 / TypeScript / Vite 控制台、Go API 与 MySQL InnoDB 持久化。支持可配置站点品牌、简体中文/English，以及分别定价的 CNY/USD；默认中文与 CNY，不提供自动汇率换算。

**这是持续开发和验收中的工程基础，不是经过生产认证的财务系统。** 支付和邮件适配器保持禁用，尚无真实收款、VPS 控制器、邮件验证、密码找回或 MFA。创建订单生成待付款账单，不创建虚拟机；未配置支付时明确失败，不标记已支付。没有完整财务账本、税务或结算能力。

## 当前交付状态

部署基线是 Ubuntu 24.04 / amd64 单服务器：Nginx 提供 HTTPS 和静态页面，systemd 管理 API，本机 MySQL 8.4 LTS 通过 Unix socket 保存数据。高可用暂缓。原生 CI 使用一次性云端 runner；没有连接或部署用户服务器，真实域名、公共 CA 证书、开机恢复、容量与异地灾备不在测试环境结论内。

应用维护 PR #1 已合并到 `main`（`95ca53ed2cf280ea49b5e1f2c7bb6e342c9d3512`）；原生安装与自动化 PR #2 仍在验收。`9ed815c` 已通过真实 MySQL、systemd/Nginx HTTPS、API 重启、同 schema 版本切换及备份恢复验收；该次整体 CI 在随后 actionlint 失败，修复后的完整重跑正在准备。候选构建至草稿 Release 上传的端到端流程尚未完成。已有候选保留原提交和哈希；新的发布必须对应新的已审查源码和实际验证记录。见 [发布说明](docs/RELEASE.md)、[原生验证记录](docs/NATIVE_CHECKPOINT.md) 和 [CI 与草稿 Release](docs/CI_RELEASE_AUTOMATION.md)。

## 云端 Linux 开发演示

本轮构建使用 Go `1.27.2`、Node.js `24.19.0`；开发依赖由 `go.sum` 和 `package-lock.json` 锁定。以下命令从仓库根目录分别在两个终端执行，只启动回环地址的内存演示，不是持久化部署。

终端一：

```sh
cd vps-billing/backend
APP_MODE=demo APP_ORIGIN=http://127.0.0.1:5173 LISTEN_ADDR=127.0.0.1:18080 \
  go run ./cmd/server
```

终端二：

```sh
cd vps-billing/frontend
npm ci
API_PROXY_TARGET=http://127.0.0.1:18080 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

在同一云端环境访问 `http://127.0.0.1:5173`。端口被占用时先检查现有进程，保留无关服务；若调整地址，需同步修改 API Origin 和前端代理。API 与 Vite 均不得公开到公网。

- 客户账号：`demo@aster.local` / `DemoCustomer!2026`。
- 管理账号：`admin@aster.local` / `DemoAdmin!2026`。
- 这些是公开演示账号，仅适用于 `APP_MODE=demo`；重启 API 后内存数据丢失。
- 结束体验后在两个终端分别按 Ctrl-C，确认自己启动的进程已退出。
- 离线视觉预览不写入后端，不能用于验收真实业务或数据库持久化。

## 原生持久化安装

[安装手册](docs/INSTALL.md) 提供 Ubuntu 24.04 / amd64 的软件安装、数据库账号、秘密文件、迁移、systemd 和 HTTPS 步骤。执行前核实资源、已有服务和维护窗口。应用归档无需在运行服务器安装 Go/Node.js；MySQL、Nginx、systemd、证书和主机维护仍须独立审查。

运行身份仅获得本库 DML 权限，迁移身份单独保管；秘密放在受限文件中，不提交到 Git、不写入命令行或日志。本机 Unix socket 当前需要显式的 `MYSQL_ALLOW_INSECURE=true` 例外，必须先核对真实 DSN 和 socket 权限，不能扩展成远程 TCP 明文配置。数据库迁移和管理员创建是明确的独立操作，不随 API 开机启动自动执行。

初始套餐及币种价格须经逐项审核后启用；CNY/USD 独立设置金额，没有价格时不可售。站点设置只能修改展示和账单身份，不控制 DNS、TLS、登录来源或服务商秘密。见 [站点与计价](docs/SITE_SETTINGS.md)。

日常操作参照 [运维](docs/OPERATIONS.md)、[升级与回滚](docs/UPGRADE.md)、[备份恢复](docs/BACKUP_RECOVERY.md) 和 [验收清单](docs/ACCEPTANCE.md)。工程验收由维护方运行并记录；部署环境的具体配置与恢复能力应与实际主机对应。

## 工程目录

- `frontend/`：用户和管理控制台、两语言/两币种显示与组件测试。
- `backend/`：认证、权限、订单/账单、站点设置、审计、MySQL 与演示存储。
- `deploy/systemd/`、`deploy/nginx.native.conf`：原生服务与 HTTPS 配置样例。
- `deploy/scripts/`：提交快照打包、依赖清单和原生备份脚本。
- `deploy/ci/`：应用检查、原生临时数据库验证与受信发布控制程序。
- [接口契约](docs/CONTRACT.md)、[安全边界](docs/SECURITY.md)、[实际验证记录](docs/VALIDATION.md)。

## 服务商扩展与剩余边界

支付和邮件使用类型化适配器接口及注册表，管理员扩展中心显示清单、能力和配置要求。当前仅提供安全禁用的默认适配器，不会自动下载或安装服务商代码。新增适配器需要代码审查、重建和专项验收；配置切换需重启。见 [插件约定](docs/PLUGINS.md)。

真实支付及回调落账、退款/争议/对账、自动续费、税务、汇率、邮件验证/找回、MFA、完整账号生命周期、控制器消费、监控告警和异地灾备仍需单独完成。持久化 outbox 只记录事件，不代表已有 worker 或真实开通。列表尚有 1,000 条上限，不能当完整导出使用。

测试结论须绑定提交和运行环境，见 [验证记录](docs/VALIDATION.md) 与 [原生验证记录](docs/NATIVE_CHECKPOINT.md)。`cf971f1` 的 GitHub Go 扫描报告 0 项可达函数、0 项导入包、19 项模块级告警；后者属于当前应用未导入的 SSH/OpenPGP 包，不能写成“Go 无已知漏洞”。旧候选的应用测试、浏览器及数据库证据不能替代本次修订原生部署的实际验收。未接真实支付、邮件或生产客户数据，也未进行生产部署。
