# 星屿云 Aster Cloud · 财务核心

这里是星屿云的应用源码：Vue 3 / TypeScript / Vite 提供客户和管理控制台，Go API 使用 MySQL InnoDB 保存业务数据。运营者可以设置品牌、中文/English、币种和独立报价；客户按实际地区筛选套餐、核对规格，再创建待付款订单和账单。

全新安装默认只启用 CNY，支持配置 0–6 位精度、名称、金额前后缀和价格。升级保留已有 USD 报价与历史记录。语言切换不换汇，当前配置也不重写历史金额。

运营者和开发者可按[支付插件接入指南](docs/PAYMENT_PLUGINS.md)对接第三方渠道。Core 0.5.3 起提供独立运行时支付插槽 `aster.payment/1`、持久化支付尝试与验签后原子结算，兼容插件无需重编 Core，没有内置真实渠道。官方发行默认关闭支付，具体渠道接口及商户验收由开发者完成。VPS 主控/被控、自动开通、完整财务账本、退款对账和税务发票仍需另行实现。

SMTP 目前只提供管理员配置和固定测试邮件，尚无业务邮件通知、邮箱验证、密码找回或 MFA。创建订单本身不会生成虚拟机或将账单记为已付。

本版为 Core `0.5.6`；发行状态以正常 Release 与公共附件校验为准。保留客户首页、套餐比较、手机底栏与统一抽屉/弹窗，补齐客户/管理员角色管理、单笔订单详情、商品草稿到上架的流程，以及脱敏生产日志和分页审计。付款、金额、幂等和历史快照规则不变，不添加真实资源开通或新支付渠道。旧 v0.5.5 构建失败，标签保持原样；精确运行、截图与发布状态见 [VALIDATION.md](docs/VALIDATION.md)。

已发布的 0.5.4 维护内容包括登录错误提示随界面语言更新、客户概览只读取最近五条订单，以及减少订单列表中重复的币种快照解析；订单和账单的历史数据校验规则保持不变。

## 程序与独立插件

目标 Core `0.5.6` 与官方 SMTP `1.1.0` 分别构建、安装并管理版本；本次不准备新的 SMTP 版本。SMTP 插件实现 `aster.smtp/1`，兼容 Core `>=0.4.0,<0.6.0`，只支持管理员固定测试邮件，默认关闭。Core 没有内置 SMTP 传输；安装独立包并经 root 明确批准后，独立 systemd 身份通过 Unix socket 提供能力。

支付与 SMTP 分别使用独立运行时插槽。Core 被动读取 manifest，不因发现文件而执行程序、启动服务或自动下载。安装、启停及版本切换见[插件指南](docs/PLUGINS.md)，协议、身份与秘密边界见 [PLUGIN_PROTOCOL.md](docs/PLUGIN_PROTOCOL.md)。替换兼容的 SMTP 或支付插件无需重编 Core，具体兼容与恢复结果见[验证记录](docs/VALIDATION.md)。

## 原生 Linux 安装

部署基线为 Ubuntu 24.04 / amd64：Nginx 提供 HTTPS 和静态网页，systemd 管理 API 与可选 SMTP，本机 MySQL 8.4 LTS 通过 Unix socket 持久化。管理员先准备系统组件、MySQL 实例、域名和 TLS 证书。

Core 的 API、插件宿主和资源包须来自同一版本；资源包含编译网页、数据库更新、文档及主机工具，服务器无需 Go 或 Node.js。安装文档已按目标 `0.5.6` 准备，须待正常 Release 发布并核验后使用；本轮开发对照基线为正式 `0.5.4`。准备完整目录后，管理员审查只读计划并以实际 SHA-256 确认操作。目标版本的主机执行器负责受支持实例的数据库和账号、受限配置、首位管理员、systemd 服务、版本切换及 HTTPS 检查；系统软件安装和证书申请由管理员另行处理。

- [原生安装](docs/INSTALL.md)：来源、私密规格、计划确认、数据库/身份、秘密、迁移和 HTTPS。
- [宝塔部署与更新](docs/BAOTA.md)：复用面板 Nginx/MySQL，系统 API 与独立 SMTP，前后端同步切换。
- [后台版本更新](docs/UPDATES.md)：固定官方 Release 查询、审计交接、主机确认执行与脱敏实际状态。
- [升级与回退](docs/UPGRADE.md)、[备份恢复](docs/BACKUP_RECOVERY.md)、[运维](docs/OPERATIONS.md)。
- [接口契约](docs/CONTRACT.md)、[财务配置](docs/FINANCIAL_MODEL.md)、[站点设置](docs/SITE_SETTINGS.md)、[安全边界](docs/SECURITY.md)。

```text
/opt/aster/releases/<core-version>/  bin/、web/、migrations/、docs/、deploy/、licenses/
/opt/aster/current                  当前 Core 版本链接
/opt/aster/plugins/<id>/<version>/  独立、不可覆盖的插件版本
/etc/aster/api.env                  文件引用和非秘密配置
/etc/aster/plugins.json             root 审批与插件身份、商户与精确 SMTP 目的地
/etc/aster/secrets/                 Core 可读、插件不可读的秘密
```

全新安装拒绝已有实例、数据库或账号；升级使用维护窗口、锁和持久 journal，核对当前版本、schema、插件和新备份后才迁移与切换。恢复从原检查点核查，程序回退须先证明旧 schema 仍兼容，不自动还原数据库。运行数据库身份仅本库 DML，迁移身份独立，迁移/管理员引导不随服务开机自动执行。本机 Unix socket 目前仍需显式 `MYSQL_ALLOW_INSECURE=true`，只有核实真实 DSN/socket 权限后才能采用，禁止沿用到远程 TCP。秘密和备份不得写进 Git、Release、网页或日志。

初始 CNY 示例价格不可售，运营者审核独立报价以及套餐、报价和币种开关后再启售。已有价格或业务记录会锁定精度，未完成义务阻止停用；历史金额和格式保持不变。新订单保存套餐快照，提交报价发生变化时须重新确认。升级前应验证备份和隔离恢复，回退程序前检查数据库兼容性。

站点品牌设置只影响展示，不改变 DNS、TLS 或登录来源。SMTP 凭据由 Core 使用独立密钥加密保存，插件仅接收本次调用所需内容，不取得密钥、数据库 DSN 或会话秘密。插件来源与主机出口仍需审查，进程隔离不能代替代码信任。

本页对应 Core `0.5.6` 发布准备，不表示已发布或发布门禁已通过；正式资产以 Release 清单为准，更新源码不会改写既有安装包。

## 云端开发演示

当前工具链基线 Go `1.27.3`、Node.js `24.19.0`；依赖由锁文件固定。以下分别在两个终端运行，仅启动回环内存演示，重启数据丢失：

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

同环境访问 `http://127.0.0.1:5173`。客户 `demo@aster.local / DemoCustomer!2026`，管理员 `admin@aster.local / DemoAdmin!2026`；仅用于显式 demo，不能公开部署。结束后停止自己启动的进程，不清理无关服务。离线预览不写后端，不能验收持久化或发信。

## 工程目录与交付

| 目录                                 | 职责                                                                  |
| ------------------------------------ | --------------------------------------------------------------------- |
| `frontend/`                          | 客户/管理控制台，偏好、配置与组件测试                                 |
| `backend/internal/billing/`          | 认证、权限、订单/账单、设置、审计、MySQL/内存存储                     |
| `backend/pkg/pluginapi/`             | 纯协议、SMTP 与支付类型，不含渠道传输                                 |
| `backend/internal/runtimeplugins/`   | 被动发现、受保护文件与审批、Unix RPC 客户端                           |
| `backend/cmd/plugin-host/`           | 独立身份验证并执行批准的程序 inode                                    |
| `backend/plugins/smtp/`              | 独立 SMTP 程序、TLS 传输与测试                                        |
| `deploy/systemd/`、`deploy/scripts/` | 原生服务样例、确认式安装/升级、备份、插件管理、交接暂存与精确提交打包 |
| `deploy/ci/`                         | 只读检查、临时原生服务验收和受信发布程序                              |

代码在 `main` 维护，发行包、来源信息和验证记录对应同一提交。Core 正常 Release 包含两个原始 Linux amd64 程序、一个资源包和三项元数据，共六项资产；SMTP 为一个原始程序、一个资源包和三项元数据，共五项资产。源码和标签保留在 Git，不手动上传额外源码包，不原地覆盖正式资产；旧 Release 清理按单独明确授权执行。

旧工具和网页不会自动获得新分发格式或校验规则。首次升级先核验目标版本工具；SMTP 1.0.0 的兼容上界为 Core `<0.5.0`，不能用于目标 Core 0.5.6，应先独立安装兼容的 1.1.0 或明确停用。构建及交付步骤见[构建发布](docs/RELEASE.md)与[CI 流程](docs/CI_RELEASE_AUTOMATION.md)。

测试使用一次性云端环境和合成数据，具体结论以 [VALIDATION.md](docs/VALIDATION.md) 对应提交和运行记录为准。目标环境仍需验收宝塔组合、公共 CA 续期、容量、整机恢复、异地灾备及所接业务渠道。正式版本和 `APP_MODE=production` 不代替运营验收。项目许可证见 [LICENSE](../LICENSE)，依赖许可证随发行包交付。
