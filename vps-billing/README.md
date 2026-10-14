# 星屿云 Aster Cloud · VPS 计费平台

前后端分离的首版实现：Vue 3 / TypeScript / Vite 控制台，Go API，MySQL InnoDB 持久化。中文优先，USD / 月付套餐目前只是演示业务设定，不代表已确定的运营规则。

**这是可继续开发和验收的工程基础，不是已完成生产认证的财务系统。没有接入真实收款、VPS 控制器、邮件验证、密码找回或 MFA。请勿放入真实客户或支付资料。** 创建订单不会创建虚拟机；支付入口未配置时必须失败，不会标记已支付。当前不具备完整财务账本、税务或结算能力。

## 快速体验：明确的非生产演示

需要 Docker Engine 与 Docker Compose v2、可拉取镜像的网络；本机开发可使用 Go 1.24+、Node.js 22.12+（建议 Node 24）和 npm。部署镜像使用 Go 1.26、Node 22、MySQL 8.4 LTS 与 nginx 1.28 系列；镜像标签不是不可变摘要，上线前须审查更新并锁定 digest。

```sh
cd deploy
docker compose -f compose.demo.yml up --build -d
```

打开 http://localhost:8080。仅绑定本机回环地址，请勿把演示端口公开。

- 客户账号：`demo@aster.local` / `DemoCustomer!2026`
- 管理账号：`admin@aster.local` / `DemoAdmin!2026`
- 演示模式使用内存，重启 API 后变更丢失。以上账号只适用于 `APP_MODE=demo`。
- 前端离线视觉预览与在线演示均应明确标注；离线预览不写入后端，不能用它验收真实功能。
- 停止演示：`docker compose -f compose.demo.yml down`。

不用 Docker 时参照 [后端说明](backend/README.md) 与前端 `package.json`。API 默认只监听回环地址，Vite 开发服务器仅供本机开发；不要向公网暴露 Vite。

## MySQL 持久化测试部署

测试服务器将在用户提供并确认后再操作。本交付未连接或部署到外部服务器。

1. 阅读 [部署与运维](docs/OPERATIONS.md)，准备专用测试域名、可信 HTTPS 反向代理和测试数据。
2. 复制 `deploy/.env.example` 为 `deploy/.env`，设置精确的 HTTPS `APP_ORIGIN`、管理员邮箱。
3. 在部署目录运行 `./scripts/init-secrets.sh`，生成独立随机密钥；不会打印密钥内容，也不会覆盖已有目录。
4. `docker compose --env-file .env -f compose.yml up --build -d`。首次启动先执行数据库迁移，再启动 API 和静态站点。
5. `docker compose --env-file .env -f compose.yml --profile ops run --rm bootstrap` 创建管理员。密码从本机私密文件 `deploy/secrets/bootstrap_password` 安全读取，不要发送到聊天或日志。
6. 通过 HTTPS 域名访问；完成 [验收清单](docs/ACCEPTANCE.md)，再决定下一轮开发范围。

生产迁移默认创建的套餐均不可售，避免未经审核的演示价格对外下单。管理员 CLI 仅创建账号；套餐上线、客户开户与运维权限需按后端说明和测试范围单独审查。

数据库端口不对宿主机发布，持久卷保存数据。`docker compose down` 不删除卷；**不要执行 `down -v`，这会删除测试数据库持久卷。** Compose 是单机测试/部署基线，不是高可用集群。

## 工程目录

- `frontend/`：用户和管理控制台。
- `backend/`：鉴权、权限、订单/账单、审计、MySQL 与演示存储。
- `deploy/`：容器构建、nginx、Compose、密钥初始化、备份模板。
- `docs/CONTRACT.md`：当前 API 协作契约。
- [安全边界](docs/SECURITY.md)、[发布门禁](docs/RELEASE.md)、[验证记录](docs/VALIDATION.md)。

## 服务商扩展

支付与邮件已拆成类型化适配器接口和注册表，管理员扩展中心可查看清单、能力和配置要求。当前只有安全禁用的默认适配器，没有真实服务商。增加新的代码适配器需要重建；已有适配器配置切换需重启。见 [插件开发约定](docs/PLUGINS.md)。SMS、存储、控制器等目前只列为规划扩展方向，不声称已有实现。

## 当前边界

支付服务商、签名验签 webhook、退款/争议/对账、自动续费、税票、优惠、汇率、多币种、邮件验证/找回、MFA、控制器消费与真实开通、监控告警和异地灾备尚需独立实现及验证。持久化 outbox 是未来控制器集成的边界，不等于已有 worker 或真实开通能力。

本次 Go 测试、HTTP 冒烟、前端构建和 6 项前端单元测试通过；云端在线手动浏览器冒烟与桌面截图检查已完成；真实 MySQL 集成、Docker 启动、完整自动化浏览器 E2E、手机视口及完整视觉验收、负载测试和灾备演练仍未验证。API/前端测试通过不替代这些验收。所有验证结论以 [验证记录](docs/VALIDATION.md) 的实际结果为准。
