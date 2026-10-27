# 星屿云 · 财务系统

财务 Core 提供客户门户和管理后台：运营者发布商品与独立报价，客户选购套餐并管理订单、账单和已有服务。使用 Go、Vue 3 / TypeScript 与 MySQL，原生 Linux 部署。

**[安装](docs/INSTALL.md) · [首次使用](docs/GETTING_STARTED.md) · [API](docs/CONTRACT.md) · [更新记录](docs/CHANGELOG.md) · [验证记录](docs/VALIDATION.md)**

## 版本与环境

Core **0.5.10** 对应[正式 Release](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/v0.5.10)；[公开资产复验](https://github.com/xiaoqiqixi/betteridcsys/blob/main/docs/CORE_PUBLIC_PREPARE_ACCEPTANCE.md)已按发行源码完成。后续 `main` 变更不会改写已发布资产；包内文档是构建时快照，安装仍须核对完整六资产及来源。

- **系统**：Ubuntu 22.04 / 24.04 amd64，systemd、Python 3、Nginx、本机 Oracle MySQL 8.4 LTS；暂不支持 Ubuntu 26.04 和其他发行版。
- **入口**：同源 HTTPS，API 只监听回环地址；服务器运行已编译发行包无需 Go / Node.js。
- **语言与币种**：全新站点默认中文 / CNY；支持 English 和独立币种报价，升级保留已有 USD 记录。语言不决定币种，不自动换汇。
- **数据库**：schema 13 / 23 表。历史金额、币种格式、套餐与产品配置快照不随当前设置变化。

旧 v0.5.6–v0.5.9 的新 `prepare` / `stage` 受历史来源限制；已有实例先读[历史影响](https://github.com/xiaoqiqixi/betteridcsys/blob/main/docs/HISTORY_REWRITE.md)及[升级手册](docs/UPGRADE.md)，不要删除数据或绕过来源校验。

## 功能

| 模块 | 当前能力 | 相关手册 |
| --- | --- | --- |
| 商品与目录 | 类型 → 地区 → 节点 → 套餐；新增、编辑、复制草稿、独立定价、上下架 | [商品分类](docs/CATALOG_TAXONOMY.md) · [价格与币种](docs/FINANCIAL_MODEL.md) |
| 客户购买 | 默认选中首个套餐、确认报价、创建待付款订单、订单详情与符合条件的未付取消 | [首次使用](docs/GETTING_STARTED.md) |
| 管理后台 | 客户/管理员管理、停用/改密/撤会话，全站订单/账单/服务读取与审计 | [管理员能力](docs/ADMIN_MANAGEMENT.md) |
| 运营设置 | 站点品牌、默认语言/币种、账单抬头、独立报价、版本检查与运维交接 | [站点设置](docs/SITE_SETTINGS.md) · [版本更新](docs/UPDATES.md) |
| 插件扩展 | SMTP 测试邮件、支付运行时协议、显式资源任务传输；独立安装和授权 | [插件管理](docs/PLUGINS.md) · [支付](docs/PAYMENT_PLUGINS.md) · [资源](docs/RESOURCE_PLUGINS.md) |

支付默认关闭，没有内置真实收款渠道；SMTP 只支持管理员配置与固定测试邮件。退款、对账、完整会计账本、业务邮件通知、邮箱验证、找回密码、MFA 和自动开通 worker 尚未提供。

财务角色目前只有 `customer/admin`；[员工权限设计](https://github.com/xiaoqiqixi/betteridcsys/blob/main/docs/FINANCE_STAFF_ACCESS.md)不是已上线功能。主控是[独立系统](https://github.com/xiaoqiqixi/betteridcsys/tree/main/aster-cloud)，不包含在 Core 六资产中。创建订单不代表支付，资源任务被接纳也不代表 VM 已运行。

## 安装与开始运营

1. 按[原生安装](docs/INSTALL.md)准备域名、TLS、本机数据库和受保护输入；宝塔环境使用[专门指引](docs/BAOTA.md)。
2. 核验同版本 API、插件宿主、资源包及三项元数据，准备目录，再审查只读计划并明确确认安装。
3. 使用自己在安装规格中指定的管理员登录，按[首次使用](docs/GETTING_STARTED.md)设置站点、审核 CNY 报价并发布商品。
4. 在隔离测试环境用合成客户走完购买和账单读取；支付渠道、资源开通另行接入和验收。

系统没有通用生产密码，不自动安装系统组件、申请证书或配置 DNS。初始示例报价不可售；不要直接改 SQL 代替后台操作。完整运维包括[备份恢复](docs/BACKUP_RECOVERY.md)、[升级与回退](docs/UPGRADE.md)、[日志审计](docs/LOGGING.md)与[安全配置](docs/SECURITY.md)，不是仅启动服务。

## 本地开发

开发工具链使用 Go **1.27.3**、Node.js **24.19.0**，依赖按锁文件安装。以下在两个终端运行，仅用于本机内存 demo，重启数据丢失，不能开放公网：

```sh
cd vps-billing/backend
APP_MODE=demo APP_ORIGIN=http://127.0.0.1:5173 LISTEN_ADDR=127.0.0.1:18080 \
  go run ./cmd/server
```

```sh
cd vps-billing/frontend
npm ci
API_PROXY_TARGET=http://127.0.0.1:18080 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

访问 `http://127.0.0.1:5173`。仅 demo 模式的合成账户为客户 `demo@aster.local / DemoCustomer!2026`、管理员 `admin@aster.local / DemoAdmin!2026`；正式模式不创建这些账户。停止自己启动的进程即可，不清理其他服务。前端预览或内存 demo 不能证明 MySQL 持久化、真实支付或资源开通。

### 代码与开发文档

| 目录 | 职责 |
| --- | --- |
| `frontend/` | 客户门户、管理后台、组件与交互测试 |
| `backend/internal/billing/` | 认证授权、订单/账单、运营设置、审计与存储 |
| `backend/pkg/pluginapi/`、`backend/internal/runtimeplugins/` | 公开插件协议、受保护审批与 Unix RPC |
| `backend/internal/controllers/` | 商品资源合同和一次性传输；不调用第三方 IDCsmart API |
| `backend/cmd/plugin-host/`、`backend/plugins/` | 独立插件宿主与具体插件实现 |
| `deploy/scripts/`、`deploy/ci/` | 安装、升级、备份、发布与隔离验收 |

继续阅读：[API 契约](docs/CONTRACT.md) · [UI API](docs/UI_API_REFERENCE.md) · [财务模型](docs/FINANCIAL_MODEL.md) · [界面规范](docs/UI_GUIDELINES.md) · [插件协议](docs/PLUGIN_PROTOCOL.md) · [发布流程](docs/CI_RELEASE_AUTOMATION.md)。

完整检查入口及所需隔离数据库见[验证记录](docs/VALIDATION.md)。缺少 MySQL 而跳过的测试、交叉编译或离线打包都不等于完整验收。源代码只在 `main` 维护，不原地覆盖旧标签或发行资产。项目采用 [Apache License 2.0](https://github.com/xiaoqiqixi/betteridcsys/blob/main/LICENSE)。
