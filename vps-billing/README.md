# 星屿云 Aster Cloud · 财务核心

Vue 3 / TypeScript / Vite 控制台、Go API 与 MySQL InnoDB 持久化。支持站点品牌、中文/English、运营者配置的币种与独立报价。全新安装仅启用默认 CNY；可配置 0–6 位精度、名称、前后缀及价格，不自动换汇。升级保留旧 USD 报价和历史。选购页按套餐实际地区筛选，展示规格、可售状态与订单摘要，创建待付款订单和账单。

**尚未接入真实支付、主控/被控或 VPS 自动开通。** 没有完整财务账本、退款对账、税务发票、邮件通知/验证/找回、MFA 或完整账号生命周期。outbox 只记录事件，没有消费者；不会因创建订单生成虚拟机或伪造已付状态。

## 程序与独立插件

Core `0.5.1` 与官方 SMTP `1.1.0` 分开构建、安装和正常发布。SMTP 插件实现 `aster.smtp/1`，兼容 Core `>=0.4.0,<0.6.0`，只支持管理员固定测试邮件，默认关闭。Core 没有内置 SMTP 传输；安装独立包并经 root 明确批准后，独立 systemd 身份通过 Unix socket 提供能力。

Core 被动读取 manifest，不执行未知文件、启动服务或自动下载。安装/启停/版本切换见 [插件指南](docs/PLUGINS.md)，协议、身份与秘密边界见 [PLUGIN_PROTOCOL.md](docs/PLUGIN_PROTOCOL.md)。插件替换无需重编 Core；实际不变哈希/PID 与故障恢复结果必须查对应 [验证记录](docs/VALIDATION.md)，不能从文档推导已验证。

## 原生 Linux 安装

部署基线为 Ubuntu 24.04 / amd64：Nginx 提供 HTTPS 和静态页面，systemd 管理 API/可选 SMTP，本机 MySQL 8.4 LTS 通过 Unix socket 持久化。Core 提供原始 API、插件宿主和独立资源包；资源含网页、迁移、文档及配置工具。按同版本核验组装，服务器无需 Go/Node.js；单个 ELF 不是完整安装。发行文件不自动安装系统服务、数据库或公共证书。

- [原生安装](docs/INSTALL.md)：来源、目录、独立数据库身份、秘密、迁移和 HTTPS。
- [宝塔部署与更新](docs/BAOTA.md)：复用面板 Nginx/MySQL，系统 API 与独立 SMTP，前后端同步切换。
- [后台版本更新](docs/UPDATES.md)：固定官方 Release 查询、明确审计交接与主机独立核验/暂存。
- [升级与回退](docs/UPGRADE.md)、[备份恢复](docs/BACKUP_RECOVERY.md)、[运维](docs/OPERATIONS.md)。
- [接口契约](docs/CONTRACT.md)、[财务配置](docs/FINANCIAL_MODEL.md)、[站点设置](docs/SITE_SETTINGS.md)、[安全边界](docs/SECURITY.md)。

```text
/opt/aster/releases/<core-version>/  bin/、web/、migrations/、docs/、deploy/、licenses/
/opt/aster/current                  当前 Core 版本链接
/opt/aster/plugins/<id>/<version>/  独立、不可覆盖的插件版本
/etc/aster/api.env                  文件引用和非秘密配置
/etc/aster/plugins.json             root 审批与精确 SMTP 目的地
/etc/aster/secrets/                 Core 可读、插件不可读的秘密
```

运行数据库身份仅本库 DML，迁移身份独立，迁移/管理员引导不随服务开机自动执行。本机 Unix socket 目前仍需显式 `MYSQL_ALLOW_INSECURE=true`，只有核实真实 DSN/socket 权限后才能采用，禁止沿用到远程 TCP。秘密和备份不得写进 Git、Release、网页或日志。

初始 CNY 示例价格不可售，运营者须审核各币种独立报价及套餐/报价/币种开关后启售。已有价格或业务记录永久锁定精度，未完成义务阻止停用；历史金额和格式不随当前显示变化。新订单保存套餐快照，新客户端携带报价条件，变化后需重新确认。迁移 007 后为 14 张基础表，升级需已验证备份和恢复，不能破坏性降级；品牌设置不能改变 DNS/TLS/登录来源。SMTP 凭据由 Core 用独立密钥加密保存，插件仅接收本次调用，不取得密钥、数据库 DSN 或会话秘密。审批不是恶意代码沙箱，SMTP 仍需来源审查和主机出口控制。

## 云端开发演示

当前工具链基线 Go `1.27.2`、Node.js `24.19.0`；依赖由锁文件固定。以下分别在两个终端运行，仅启动回环内存演示，重启数据丢失：

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

| 目录 | 职责 |
|---|---|
| `frontend/` | 客户/管理控制台，偏好、配置与组件测试 |
| `backend/internal/billing/` | 认证、权限、订单/账单、设置、审计、MySQL/内存存储 |
| `backend/pkg/pluginapi/` | 纯协议与 SMTP 类型，不含具体网络传输 |
| `backend/internal/runtimeplugins/` | 被动发现、受保护文件与审批、Unix RPC 客户端 |
| `backend/cmd/plugin-host/` | 独立身份验证并执行批准的程序 inode |
| `backend/plugins/smtp/` | 独立 SMTP 程序、TLS 传输与测试 |
| `deploy/systemd/`、`deploy/scripts/` | 原生服务样例、备份、插件管理、更新交接暂存与精确提交打包 |
| `deploy/ci/` | 只读检查、临时原生服务验收和受信发布程序 |

在 `main` 维护，同提交源码、包、来源与检查记录对应。Core 正常 Release 提供两个原始 Linux amd64 程序、资源和三项元数据共六资产；SMTP 提供一个原始程序、资源和三项元数据共五资产，不手动上传源码包，历史 0.4.0 / 1.0.0 资产保持原样。旧网页/工具不支持新 raw 格式，首次升级人工核验；SMTP 1.0.0 不能运行于 Core 0.5.1，需先用已验证新工具桥接 1.1.0 或明确停用。见 [构建发布](docs/RELEASE.md) 与 [CI 流程](docs/CI_RELEASE_AUTOMATION.md)。

原生/浏览器/插件检查使用一次性云端环境和合成数据，没有用户服务器、Mac、外部真实邮件或付款。宝塔组合、公共 CA 续期、容量、整机恢复、异地灾备及所有未实现业务必须分别验收；正式版本和 `APP_MODE=production` 均不是运营认证。具体测试数量、扫描范围与剩余告警只认 [VALIDATION.md](docs/VALIDATION.md) 的对应提交和 run。
