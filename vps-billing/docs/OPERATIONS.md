# 测试部署与运维手册

## 1. 拓扑与前提

浏览器 → 可信 TLS 终止代理 → 回环地址 `127.0.0.1:8080` 的 nginx → 内部 API → MySQL 8.4 LTS。网页与 `/api/` 同源，nginx 也代理 `/healthz` 和 `/readyz`。数据库不发布端口，`data` 网络设置为 internal。web 只加入 edge 和独立 proxy 网络，不能直接访问数据库；API 加入 proxy 和 data。

API 仅加入 internal 网络，因此当前不能访问外部支付/邮件 API，这是未接入服务商阶段的故意限制。日后接入时应单独设计受控出口（目标白名单、代理与凭据范围），不要为方便把数据库端口公开或去掉网络隔离；需同时验证 DNS、TLS、超时、重试和审计。

本模板数据库连接未使用 TLS：配置 `MYSQL_ALLOW_INSECURE=true` 明确批准仅限同宿主机隔离网络的例外。Docker 网络隔离不能防御宿主机管理员或容器逃逸。跨主机/托管数据库必须移除此例外，配置服务器证书验证的 TLS DSN，禁止 `skip-verify`。云安全组、防火墙、TLS 证书和反向代理不是本项目自动管理的资源。

要求：独立 Linux 测试机、Docker/Compose v2、DNS、有效 HTTPS 证书、磁盘余量与异地备份位置。建议从 2 核 / 4 GiB 起做测试容量规划，但未做负载测试，不能据此承诺并发量。项目不自动安装软件、开放端口或改变服务器设置。

## 2. 配置、构建和启动

在项目 `deploy/` 下操作：

```sh
cp .env.example .env
# 编辑 APP_ORIGIN 为精确 HTTPS 来源，例如 https://billing.example.com
# 编辑 BOOTSTRAP_EMAIL 为测试管理员邮箱
./scripts/init-secrets.sh
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml build --pull
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps -a
docker compose --env-file .env -f compose.yml --profile ops run --rm bootstrap
```

`APP_MODE=production` 是持久化/安全配置模式，**不是“已批准上线”标记**。API 生产模式要求 HTTPS 来源，浏览器会话依赖安全 cookie，所以直接用 HTTP 公网 IP 测试登录不是支持的生产配置。演示模式不需要数据库，但只能使用隔离的本机测试。

`.env` 不保存密码。`secrets/` 外层目录权限为 0700，文件为 0444，使 Compose 只读挂载后非 root 容器可读；其他宿主机用户不能穿越该目录。文件级权限并不保护 root、Docker 管理员、备份管理员。不要把目录变成公开可遍历目录。若组织要求 0400 文件，改为经过验证的 secret manager/容器 UID 映射，而不是盲目 chmod 导致 API 读不到秘密。

数据库身份已分离：`aster_migrator` 用于迁移且具备本库 DDL 权限，`aster_runtime` 只获 SELECT/INSERT/UPDATE/DELETE。API 与 bootstrap 只挂载 runtime DSN；迁移服务单独挂载 migration DSN；运行态不挂载 root 或 migration 秘密。首次空卷初始化时 `mysql-init-runtime.sh` 使用 root 创建最小权限 runtime 账号。

MySQL 初始化环境变量及账号初始化脚本只在空数据卷首次初始化时生效。已有旧版数据卷不会自动补建新账号，也不能重跑 CREATE USER 盲目覆盖。升级旧测试实例需先备份，再由 DBA 明确创建/授权 runtime 与 migration 身份，验证后切换 DSN；不能删卷绕过升级。之后修改 `mysql_password`（迁移）或 `mysql_runtime_password` 文件不会自动修改数据库用户密码，必须执行经过批准的密码轮换流程，再分别同步 migration/runtime DSN，验证后重启相关进程。不要通过删除卷来“修复”密码不一致。

## 3. HTTPS 边界

宿主机 TLS 代理仅转发到回环地址端口，保留原始 Host 和 Origin，并设置适合的请求大小、超时和速率限制。Compose 强制使用 127.0.0.1，不提供将此信任拓扑改为公网 HTTP 绑定的便捷开关。证书续期必须有监控。只有 TLS 端点添加 HSTS；确认所有子域均支持 HTTPS 后再考虑 includeSubDomains。内置 nginx 不信任 X-Forwarded-For。代理地址信任链固定为：宿主机 TLS 代理覆盖 X-Real-IP → web 仅信任 edge gateway `172.30.43.1` 的 X-Real-IP → web 再用解析后的 `$remote_addr` 覆盖传给 API 的 X-Real-IP → API 仅信任 nginx `172.30.42.2/32`。不允许信任 0.0.0.0/0 或全部私网。宿主机边缘代理必须设置 `proxy_set_header X-Real-IP $remote_addr;`，绝不透传客户端原始头。

固定子网 `172.30.42.0/29`、`172.30.43.0/29` 可能与现有网络冲突，部署前必须检查。若改网段，需同时更新 Compose 地址、API TRUSTED_PROXY_CIDRS 和 nginx set_real_ip_from；不能只改其中一处。实际部署必须验证 Docker 转发来源确为配置的 host gateway，并用两个不同来源测试登录限速独立、伪造头无效。Docker/Desktop/NAT 拓扑不同可导致来源不符，此时先纠正精确信任地址，不能扩大到任意网段。

默认只允许同源脚本，禁止 inline script/eval；样式允许 inline 是为了 Vue 动态样式。没有外部字体/CDN。后续嵌入支付页面、分析服务或第三方脚本必须重新审查 CSP 与数据传输范围，不能简单改成通配符。

## 4. 健康、日志和故障

- `/healthz`：进程存活；`/readyz`：数据库可用且初始 schema 版本/checksum 匹配。代理可达不等于业务验收完成。
- `docker compose ... logs --tail=100 api migrate web db` 查看启动失败。不要把原始日志公开分享，先检查邮箱、订单信息和秘密。
- 缺密钥、非 HTTPS 来源、数据库不可达或迁移失败应停止启动，不能自动降级为内存模式。
- `mysqladmin ping` 只用于数据库进程启动探测，不是凭据/业务完整性检查；API 就绪检查及功能测试仍必需。
- 建议监控 5xx、延迟、登录失败、数据库连接/磁盘、备份年龄、证书到期、迁移失败；本版本没有替你接入告警服务。
- HTTP 容器健康检查失败不会单凭 `restart: unless-stopped` 自动恢复卡死进程；需要外部监控与运维响应。

## 5. 备份、恢复与目标

建议测试期目标：RPO ≤ 24 小时、RTO ≤ 4 小时。它们是待演练的运营目标，不是本实现保证。若业务允许的数据丢失更少，应设计 binlog/PITR、快照与保留策略后再上线。

执行 `./scripts/backup.sh` 生成带校验和的 gzip SQL。脚本使用 `--single-transaction`，备份期间禁止 DDL/迁移；只适用于当前 InnoDB 表。生成的文件是**未加密敏感数据**，需要立即使用组织批准的加密方式加密、离机复制并验证。默认脚本没有计划任务、加密密钥管理、上传或自动清理。不要把备份留在唯一一台数据库主机上，也不要备份到源码仓库。

至少保留 7 份日备份和 4 份周备份作为初始建议，实际期限应结合数据最小化要求。每月以及每次数据库结构变更后，在隔离环境演练恢复，记录数据时点、恢复耗时、对象数量及业务验收结果。

恢复模板（只在已获授权的隔离测试实例操作，不能直接覆盖生产）：

```sh
# 1. 验证归档完整性，确认文件来源可信。
sha256sum -c backups/aster-TIMESTAMP.sql.gz.sha256
gzip -t backups/aster-TIMESTAMP.sql.gz
# 2. 用不同 Compose project 创建独立数据库卷，绝不复用运行中的 project。
docker compose --env-file .env -f compose.yml -p aster-restore up -d db
# 3. 等待该实例健康，再导入可信归档。
gzip -dc backups/aster-TIMESTAMP.sql.gz | 
  docker compose --env-file .env -f compose.yml -p aster-restore exec -T db sh -c \
  'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysql --user=root aster'
```

上面只启动恢复数据库，使用自动分配的 data 网络，不会创建固定 proxy/edge 子网。完整恢复演练优先使用另一台隔离测试主机；若在原机上启动 API/网页，必须另设不冲突的端口、两个固定子网、对应 IP/信任配置和 HTTPS 测试域名，再在同一个 `aster-restore` project 验证恢复的数据，不能直接同时启动两套重叠固定子网。检查客户与订单/账单关联、金额和状态、审计数量、幂等记录、outbox 完整性；验证孤立旧 cookie 无法越权，不发送真实支付或控制器请求。不要在恢复数据验证前先运行新版本迁移。真实切换需要明确停写窗口、最终备份、验证与回退批准。

## 6. 更新与回滚

发布前备份并演练还原。当前初始迁移不能等同完整的滚动升级/向下迁移体系。结构变更先做兼容性审查，采用 expand/contract 方式规划；无法确认兼容时停写维护，不在高峰直接更新。

保留旧镜像 digest、配置版本和数据库迁移版本。仅当 schema 向后兼容时回滚应用镜像；否则在停写和明确数据损失评估后恢复到经过验证的备份。禁止把 `down -v` 当作回滚。

参考：MySQL 8.4 的 [LTS 发布模型](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html)、[mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)。

## 可插拔服务配置

支付和邮件采用可信的编译期适配器，默认 payment.disabled / email.disabled。Compose 透传 PAYMENT_PROVIDER / EMAIL_PROVIDER；选择尚未安装的 ID 会拒绝启动，不会自动下载代码。配置变更后需重启 API。

服务商配置和密钥引用机制详见 PLUGINS.md。新增适配器需要重建镜像，并经代码审查、回归测试与支付沙箱验收。当前 API 网络不提供公共出口；真实服务接入前必须显式设计受控出口、挂载所需配置和秘密，不能仅在 UI 看到“配置就绪”就认定服务商已连通。
