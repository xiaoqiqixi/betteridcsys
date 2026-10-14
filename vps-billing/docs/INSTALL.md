# 单服务器原生 Linux 安装与验收

本文是修订后原生 Linux amd64 安装方案的审查检查点，**尚未在目标服务器安装或验收**。部署目标是一台服务器上的 Nginx、systemd API 和 MySQL；高可用后续单独评估。历史 `0.3.0-rc.1` 保留原样，其旧部署验证不能当作本方案已通过。修订包经审查验证后才能进入 [发布门禁](RELEASE.md)。支付、邮件、退款、VPS 开通均未接入；运行时 `production` 表示持久化及严格配置检查，不代表生产认证。

## 前置确认

先确认发行版与版本、CPU 架构、内存/磁盘容量，以及服务器是否空机。当前包目标为 Linux `x86_64/amd64`，不是 arm64；不能据此推定用户服务器架构或容量。数据库、Nginx、systemd、CA 证书和时区资料应来自经审查的系统软件源，实际安装步骤须在发行版确定后制定。本文不提供自动安装器，不修改软件源，不生成真实秘密，也不设定未经负载测试的容量承诺。

原生包提供静态 Go API、编译网页、文档和配置样例，运行 API 不需要 Go 或 Node.js 工具链。单机路径为：浏览器 HTTPS → Nginx → `127.0.0.1:18080` API → 本机 MySQL Unix socket。只有经批准的 HTTPS 和管理入口对外开放；API 和数据库均不公开监听。当前源码与 CI 只提供原生运行路径；测试用临时数据库不代表目标服务器已完成安装。

本轮没有连接目标服务器或设置 DNS、证书、防火墙、开机启动。以下命令是待审查的操作模板，只由获授权管理员在确认目标后执行；先替换域名、路径、数据库名和账号。保留服务器已有服务与数据，不把非空服务器当作全新安装处理。

## 1. 核对来源与归档

取得同一发布目录中的 Linux 包、源码包、`BUILD.json` 和 `SHA256SUMS`。若未来经自动化生成，还应核对 `PROVENANCE.json` 的 run 与提交信息。校验和只证明与清单一致，下载渠道和提交来源仍须核实；当前不提供签名或供应链认证。

```sh
cd /path/to/downloads
sha256sum -c SHA256SUMS
tar -tzf aster-VERSION-linux-amd64.tar.gz
```

阅读 `BUILD.json`：确认 `source_commit` 是已审查的提交、目标为 `linux/amd64`，工具链版本与验证记录相符，修订包的 `deployment_model` 明确为单服务器原生方案。归档根目录应只有 `aster-VERSION-linux-amd64/`，不可包含绝对路径或 `..`。先以普通用户解压到空目录，再检查内容。运行包 `deploy/` 只含 systemd/Nginx 样例及 `scripts/backup-native.sh`；源码包与修订后的已审查提交一致，不重新加入已删除的旧部署实现。保留旧发布目录与校验清单，避免原地覆盖运行文件。

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

`/opt/aster/releases/VERSION` 及 `current` 链接由 root 管理，API 只有读/执行权限；不要将它们归给 `aster`。API 无需可写应用状态目录，持久数据存入 MySQL，服务日志进入 journal。Nginx 的网页根目录只指向 `current/web`，不要暴露整个发布目录、配置、源码或依赖清单。

## 2. 数据库与秘密

同机原生安装使用 MySQL 8.4 与独立 utf8mb4 数据库。由数据库管理员审查已有实例、数据目录及用户后建立身份：迁移身份仅用于本库迁移所需 DDL/DML；API 运行身份只授予本库 SELECT、INSERT、UPDATE、DELETE；备份身份按实际工具要求单独审查。不给 API root、GRANT、FILE 或跨库权限，迁移不随每次服务启动自动执行。

首选本机 Unix socket；先确认实际 socket 路径、目录权限和服务隔离规则，确保 `aster` 能连接该 socket，但无权读取数据库数据文件。DSN 结构示意为 `DB_USER:SECRET@unix(/run/mysqld/mysqld.sock)/aster?parseTime=true`；路径和占位符必须替换，真实值只写入受限文件。不要把这一示意串直接当作可用凭据。

**当前后端即使使用 Unix socket 也会检查 MySQL TLS 配置，因此本机 socket 必须显式设置 `MYSQL_ALLOW_INSECURE=true`。** 这是在已审查本机 socket/文件权限下的窄范围例外，不能作为 TCP 明文连接的通用开关；所有迁移、引导与 API 运行命令均需一致。不能仅填写 `tls=true` 来假装 socket 已做 TLS 验证。

若之后改成 TCP/跨主机数据库，应单独审查拓扑，将 `MYSQL_ALLOW_INSECURE=false`，使用 `tls=true`、证书匹配主机名和可信 CA，禁止 `skip-verify`、`preferred`、`allowFallbackToPlaintext=true`。本轮不实施远程数据库方案；也不通过关闭 SELinux/AppArmor 或放宽到任意来源来解决权限错误。

创建无登录权限的专用 `aster` 系统身份。应用目录由管理员所有，运行身份只有读取和执行权限。由批准的秘密管理工具提供：

- 独立随机会话秘密（至少 32 字节，不使用示例值）；放入 `/etc/aster/secrets/session_secret`。
- 运行 DSN：`/etc/aster/secrets/mysql_runtime_dsn`。
- 迁移 DSN：放入仅迁移操作身份可读的位置；**不要**放在运行账号可读的秘密目录。
- 初始化管理员密码：独立的 16–72 字节强口令，保存在临时受限文件；不放进命令行、聊天或源码。

`/etc/aster/secrets` 使用 `root:aster`、0750，运行秘密文件使用 `root:aster`、0640；用 `sudo -u aster test -r 文件路径` 验证可读，且确认 `aster` 无权修改文件。迁移/备份秘密由对应操作身份保管，运行账号不得读取。秘密的备份、轮换和销毁独立于版本归档管理。

审查并复制 `deploy/systemd/api.env.example` 到 `/etc/aster/api.env`，所有者 `root:aster`、权限 0640。配置精确 HTTPS `APP_ORIGIN`、回环监听地址、可信代理和文件引用，不放秘密值。Origin 使用规范小写 ASCII 主机名，无路径、尾斜杠、查询或片段，默认 443 端口省略；必须与浏览器实际来源一致。后台“展示地址”不会修改 `APP_ORIGIN`、DNS、TLS、监听地址或可信代理范围。不要把 systemd 环境文件作为 shell 脚本 `source` 执行。

## 3. 迁移与管理员

初次迁移前确认目标为空的专用库；已有数据必须先执行 [升级与回滚](UPGRADE.md)。使用新版本的明确路径和干净环境启动 CLI，避免继承未审查配置。以下例子对应本机 Unix socket，且仅由能读取相应受限文件的授权操作身份执行：

```sh
# 下面路径须由迁移操作身份可读；不要输出文件内容。
env -i APP_MODE=production APP_ORIGIN=https://billing.example.com \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/path/private/mysql_migration_dsn \
  MYSQL_ALLOW_INSECURE=true \
  /opt/aster/releases/VERSION/bin/aster-api -migrate
```

CLI 要求完整的生产模式配置，连接必须确实是本机 Unix socket。核对迁移版本和 checksum；当前应用包含迁移 1–5，以选定发布源码为准。迁移成功后，用运行身份 DSN 和独立初始化密码文件创建管理员；不要为引导账号而给运行身份 DDL 权限：

```sh
env -i APP_MODE=production APP_ORIGIN=https://billing.example.com \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/etc/aster/secrets/mysql_runtime_dsn \
  MYSQL_ALLOW_INSECURE=true \
  BOOTSTRAP_EMAIL=operator@example.com BOOTSTRAP_NAME='运营管理员' \
  BOOTSTRAP_ROLE=admin BOOTSTRAP_PASSWORD_FILE=/path/private/bootstrap_password \
  /opt/aster/releases/VERSION/bin/aster-api -create-user
```

邮箱只是示例，需要替换；CLI 不发送邮件、不验证邮箱所有权。没有公共注册、找回密码、MFA 或完整账号生命周期管理。初始化完成后按秘密管理政策移走临时密码文件；不要声称普通文件删除可保证磁盘安全擦除。创建客户时明确使用 `BOOTSTRAP_ROLE=customer`，不得复用管理员密码。

## 4. 服务与 HTTPS

审查 `deploy/systemd/aster-api.service` 后，按目标发行版安装到 `/etc/systemd/system/`。它假定 `/opt/aster/current` 已指向本版本、`aster` 用户存在、配置及 socket 可访问。确认本机 MySQL 的实际 service 名称、启动次序和失败恢复方式；模板不能保证每个发行版的依赖命名一致。API 只监听 `127.0.0.1:18080`，systemd 不执行迁移或备份。

```sh
sudo systemctl daemon-reload
sudo systemctl start aster-api
sudo systemctl status aster-api --no-pager
```

先完成应用就绪和业务测试，再单独启用已审查的开机启动配置，并安排授权重启验收。静态 `systemd-analyze verify` 或一次 `start` 成功，都不能证明整机重启后会恢复服务；本轮尚未进行目标主机开机测试。

在 Nginx `http {}` 中引入经过修改的 `deploy/nginx.native.conf`。替换域名、证书路径，检查 Nginx 版本支持模板指令，并审查与已有默认站点/监听端口的冲突；不要覆盖同机其他业务。执行 `nginx -t` 后才 reload。模板由 Nginx 直接终止 TLS，用实际 socket 对端的 `$remote_addr` 覆盖客户端 IP 头；若已有全局 real_ip 配置，先审查其是否会改写此值。API 只信任 Nginx 的精确回环来源。增加 CDN/前置代理时必须重新审查完整信任链，不能直接信任浏览器的转发头。

先验证证书链、SNI、续期监控，再开放公众流量。生产模式 API 已发送 `Strict-Transport-Security: max-age=31536000`；需结合静态站点制定一致的 HSTS 政策，不要误以为 Nginx 没写 HSTS 就完全没有该响应头。不要用 `curl -k` 的成功结果验收证书，也不要以测试关闭浏览器安全设置。systemd 与原生 nginx 文件是待目标环境验证的样例，不是自动部署工具。

## 5. 初次验收与站点配置

```sh
curl --fail --show-error https://billing.example.com/healthz
curl --fail --show-error https://billing.example.com/readyz
```

确认网页与 `/api/` 同源、Secure/HttpOnly/SameSite cookie 生效、API 不泄露 SQL/配置值。用管理员在“站点设置”中配置运营名称、支持方式、账单抬头、预设标志和主题；见 [站点与计价](SITE_SETTINGS.md)。初始默认是简体中文和 CNY，用户可分别切换语言和币种。空价格或未启用币种应显示不可购买，不得自动用另一币种价格替代。

至少用两个测试客户验证资源隔离、管理员专属入口、订单幂等、币种不匹配和支付失败关闭。新订单只生成待付款账单；没有任何真实扣款或 VPS 开通。完整验收见 [ACCEPTANCE.md](ACCEPTANCE.md)，实际运行证据见 [VALIDATION.md](VALIDATION.md)。

最后记录本机 socket 与数据库权限、systemd 启动/停止/授权重启、Nginx Host/Origin/TLS、磁盘与日志权限，以及一次原生备份和隔离恢复的实测结果。在这些步骤尚未完成或发行版信息尚未确定时，保持此审查检查点，不宣称安装完毕。日常运维见 [OPERATIONS.md](OPERATIONS.md)。
