# Linux amd64 安装与初次验收

本文对应本次维护分支的候选版本。仅用于隔离测试与代码审查；是否可公开运营，需要另行完成 [发布门禁](RELEASE.md)。支付、邮件、退款、VPS 开通均未接入。运行时的 `production` 表示启用持久化和严格配置检查，不代表生产认证。

## 选择安装方式

- **原生包**：Linux amd64 静态 Go API、编译后的网页、文档与配置示例；适合已有 MySQL、nginx、systemd 的测试主机。
- **源码包 / Compose**：从同一提交构建容器；见 [运维手册](OPERATIONS.md)。原生包中的 Compose 文件是参考模板，缺少完整构建源目录，不能直接用于 `docker compose build`。
- **本机演示**：源码下 `deploy/compose.demo.yml` 使用内存和公开测试账号，只能绑定回环地址；停止后数据消失。不能通过演示模式绕过真实环境的配置错误。

本轮没有替用户连接外部主机或设置 DNS、证书、防火墙。以下命令由获授权的管理员在目标测试机上执行；先替换域名、路径、数据库名和账号，不要直接复制示例身份用于运营。

## 1. 核对来源与归档

取得同一发布目录中的 Linux 包、源码包、`BUILD.json` 和 `SHA256SUMS`。校验和只证明与清单一致，下载渠道和提交来源仍须核实；当前不提供签名或供应链证明。

```sh
cd /path/to/downloads
sha256sum -c SHA256SUMS
tar -tzf aster-VERSION-linux-amd64.tar.gz
```

阅读 `BUILD.json`：确认 `source_commit` 是已审查的提交、目标为 `linux/amd64`，工具链版本与验证记录相符。归档根目录应只有 `aster-VERSION-linux-amd64/`，不可包含绝对路径或 `..`。先以普通用户解压到空目录，再检查内容。保留旧发布目录与校验清单，避免原地覆盖运行文件。

```text
/opt/aster/releases/VERSION/
  bin/aster-api
  web/
  docs/
  deploy/
  manifests/BUILD.json
  manifests/go-dependencies.json
  manifests/npm-installed-dependencies.json
  licenses/
  LICENSE
/opt/aster/current -> /opt/aster/releases/VERSION
/etc/aster/api.env
/etc/aster/secrets/                # 不在发布目录或网页根目录内
```

API 是无 CGO 的 Linux amd64 构建，不依赖 Go 工具链或 Node.js 运行。MySQL、TLS 代理、CA 证书、时区资料和主机运维仍需独立提供。网页目录只放 `web/` 内容；不要把整个发布目录作为 nginx root。

## 2. 数据库与秘密

使用专用 MySQL 8.4 测试实例和 utf8mb4 数据库。身份分离：迁移身份只用于本库 DDL；API 运行身份只授予本库 SELECT、INSERT、UPDATE、DELETE；备份身份按实际工具要求单独审查。不要给 API root、GRANT、FILE 或跨库权限。

跨主机连接必须验证数据库服务器证书。驱动 DSN 使用 `tls=true` 并连接证书匹配的主机名，禁止 `skip-verify`、`preferred` 或 `allowFallbackToPlaintext=true`。私有 CA 应先以主机受控方式安装到信任库并实测；本版本不提供网页上传 CA 或任意 TLS 配置。仅对明确隔离的同机测试数据库可设置 `MYSQL_ALLOW_INSECURE=true`；此选项不适合公网连接。

创建无登录权限的专用 `aster` 系统身份。应用目录由管理员所有，运行身份只有读取和执行权限。由批准的秘密管理工具提供：

- 独立随机会话秘密（至少 32 字节，不使用示例值）；放入 `/etc/aster/secrets/session_secret`。
- 运行 DSN：`/etc/aster/secrets/mysql_runtime_dsn`。
- 迁移 DSN：放入仅迁移操作身份可读的位置；**不要**放在运行账号可读的秘密目录。
- 初始化管理员密码：独立的 16–72 字节强口令，保存在临时受限文件；不放进命令行、聊天或源码。

原生部署建议 `/etc/aster/secrets` 为 `root:aster`、0750，运行秘密文件为 `root:aster`、0640；用 `sudo -u aster test -r 文件路径` 验证可读。原生权限与 Compose 文件秘密的 0700 目录/0444 文件规则不同，不要混用。秘密的备份、轮换和销毁应独立于版本归档管理。

复制并编辑 `deploy/systemd/api.env.example` 到 `/etc/aster/api.env`，设置精确 HTTPS `APP_ORIGIN`。它不包含秘密值；DSN 从文件读取。后台“展示地址”不会修改 `APP_ORIGIN`、DNS、TLS、监听地址或可信代理范围。

## 3. 迁移与管理员

初次迁移前确认目标为空的专用测试库；升级必须先执行 [升级与回滚](UPGRADE.md)。使用明确环境启动 CLI，避免把未审查的 `.env` 当 shell 脚本执行：

```sh
# 下面路径须由迁移操作身份可读；不要输出文件内容。
env APP_MODE=production APP_ORIGIN=https://billing.example.com \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/path/private/mysql_migration_dsn \
  /opt/aster/releases/VERSION/bin/aster-api -migrate
```

CLI 要求完整的生产模式配置；数据库连接模式必须与已审查的 DSN 一致。迁移成功后，用运行身份 DSN 和独立初始化密码文件创建管理员：

```sh
env APP_MODE=production APP_ORIGIN=https://billing.example.com \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/etc/aster/secrets/mysql_runtime_dsn \
  BOOTSTRAP_EMAIL=operator@example.com BOOTSTRAP_NAME='运营管理员' \
  BOOTSTRAP_ROLE=admin BOOTSTRAP_PASSWORD_FILE=/path/private/bootstrap_password \
  /opt/aster/releases/VERSION/bin/aster-api -create-user
```

邮箱只是示例，需要替换；CLI 不发送邮件、不验证邮箱所有权。没有公共注册、找回密码、MFA 或完整账号生命周期管理。初始化完成后按秘密管理政策移走临时密码文件；不要声称普通文件删除可保证磁盘安全擦除。创建客户时明确使用 `BOOTSTRAP_ROLE=customer`，不得复用管理员密码。

## 4. 服务与 HTTPS

审查 `deploy/systemd/aster-api.service` 后安装到 `/etc/systemd/system/`。它假定 `/opt/aster/current` 已指向本版本、`aster` 用户存在、配置可读。API 只监听 `127.0.0.1:18080`；systemd 不负责执行迁移或备份。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now aster-api
sudo systemctl status aster-api --no-pager
```

在 nginx 的 `http {}` 中引入经过修改的 `deploy/nginx.native.conf`。替换真实测试域名和证书路径，执行 `nginx -t` 后再 reload。模板直接终止 TLS，并用 `$remote_addr` 覆盖 `X-Real-IP`。API 只信任 nginx 的精确回环来源；若增加 CDN 或前置代理，重新审查完整信任链，不能直接信任浏览器的转发头。防火墙只开放经批准的 HTTPS/管理入口，禁止公开 API 和数据库端口。

先验证证书链、SNI、续期监控，再决定 HSTS 政策。不要用 `curl -k` 的成功结果验收证书，也不要以测试关闭浏览器安全设置。systemd 与原生 nginx 文件是待目标环境验证的样例，不是自动部署工具。

## 5. 初次验收与站点配置

```sh
curl --fail --show-error https://billing.example.com/healthz
curl --fail --show-error https://billing.example.com/readyz
```

确认网页与 `/api/` 同源、Secure/HttpOnly/SameSite cookie 生效、API 不泄露 SQL/配置值。用管理员在“站点设置”中配置运营名称、支持方式、账单抬头、预设标志和主题；见 [站点与计价](SITE_SETTINGS.md)。初始默认是简体中文和 CNY，用户可分别切换语言和币种。空价格或未启用币种应显示不可购买，不得自动用另一币种价格替代。

至少用两个测试客户验证资源隔离、管理员专属入口、订单幂等、币种不匹配和支付失败关闭。新订单只生成待付款账单；没有任何真实扣款或 VPS 开通。完整验收见 [ACCEPTANCE.md](ACCEPTANCE.md)，实际运行证据见 [VALIDATION.md](VALIDATION.md)。
