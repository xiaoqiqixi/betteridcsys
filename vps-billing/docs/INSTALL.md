# Ubuntu 24.04 原生单机安装

本手册说明在一台 Ubuntu 24.04 / amd64 服务器上安装 Nginx、systemd API 与 MySQL 8.4。核心原生服务、HTTPS、权限、API 重启、同 schema 版本切换和备份恢复已在一次性 Ubuntu runner 实测通过，准确提交与范围见 [原生验证记录](VALIDATION.md)。支付、退款、VPS 开通均未接入；官方 SMTP 独立安装、默认关闭，仅支持管理员配置和主动测试邮件；`production` 表示持久化及严格配置检查，不代表生产认证。Core 与 SMTP 分别发布正常程序版本，须满足 [发布门禁](RELEASE.md)，历史候选保持原样。

已使用宝塔管理 Nginx/MySQL 的服务器请使用 [宝塔部署与更新指南](BAOTA.md)，避免重复安装系统服务。

## 前置确认

本手册目标为 **Ubuntu Server 24.04 LTS / amd64**，使用 systemd、Nginx 和 MySQL 8.4 LTS；原生自动化也以该发行版为测试环境，实际结果见 [原生验证记录](VALIDATION.md)。开始前确认 CPU、内存/磁盘容量和已有服务；其他发行版或 arm64 不能直接套用。本项目未完成容量基准测试，不据示例配置承诺并发量。

Core 包提供静态 Go API、插件宿主、编译网页、文档和配置工具，运行 API 不需要 Go 或 Node.js 工具链。单机路径为：浏览器 HTTPS → Nginx → `127.0.0.1:18080` API → 本机 MySQL Unix socket。只有经批准的 HTTPS 和管理入口对外开放；API 和数据库均不公开监听。当前源码与 CI 只提供原生运行路径；测试用临时数据库不代表目标服务器已完成安装。

以下 Bash 命令供管理员在确认目标后执行；先替换域名、路径、数据库名和账号。自动化验证没有连接外部服务器，也不设置其 DNS、公共证书、防火墙或开机启动。保留服务器已有服务与数据，不把非空服务器当作全新安装处理。

### Ubuntu 基础组件

在全新、已获准安装软件的主机上，先核对系统与监听服务，再安装 Ubuntu 签名源中的基础工具：

```sh
cat /etc/os-release
uname -m
free -h
df -h / /var
sudo ss -ltnp
sudo apt-get update
sudo apt-get install --no-install-recommends nginx ca-certificates openssl python3 file
```

Ubuntu 的 Nginx 软件包可能随安装启动默认站点；先保留管理入口、防火墙和已有站点，再配置本应用。站点管理方式参照 [Ubuntu Nginx 指引](https://ubuntu.com/server/docs/how-to/web-services/install-nginx/)。

MySQL 必须明确选择 **8.4 LTS**，原生验证夹具固定 `8.4.11`。按 [Oracle 官方 APT 指引](https://dev.mysql.com/doc/mysql-apt-repo-quick-guide/en/) 获取并验证对应仓库配置包，在配置菜单选择 8.4 LTS；已有 MySQL/MariaDB/Percona 主机须先做独立迁移计划，不执行全新安装流程。不要关闭 APT 签名校验或把其他数据库系列当作等价替代。仓库配置完成后：

```sh
sudo apt-get update
apt-cache policy mysql-server mysql-community-server
# 确认候选来自已审核的 Oracle 8.4 LTS 源后才安装。
sudo apt-get install mysql-server
mysql --version
sudo systemctl status mysql --no-pager
```

APT 安装 MySQL 会初始化并启动其系统服务；这与 CI 仅提取官方 DEB 到临时目录的机制不同。记录实际补丁版本，版本变化需重新运行相关回归。系统软件安装步骤不应在旧数据库主机上被当作无影响操作。

## 1. 核对来源与归档

Core 0.5.1 使用原始程序与资源分发。由主机管理员从固定官方仓库的正常 [Release](https://github.com/xiaoqiqixi/betteridcsys/releases) 选择 `v0.5.1`，取得同一 Release 的全部六个资产：

- `aster-api-0.5.1-linux-amd64`
- `aster-plugin-host-0.5.1-linux-amd64`
- `aster-core-0.5.1-linux-amd64-resources.tar.gz`
- `BUILD.json`、`PROVENANCE.json`、`SHA256SUMS`

核对来源记录的 run、提交、版本和全部资产摘要。源码从 Git 标签取得，SMTP 从其独立 Release 获取。当前没有独立发行签名；校验和只证明与清单一致，不能替代可信下载来源。旧 Core 0.4.0 一体归档按原版本流程处理，不把下面的新文件名套到旧资产。

```sh
cd /path/to/downloads
sha256sum -c SHA256SUMS
file aster-api-0.5.1-linux-amd64 aster-plugin-host-0.5.1-linux-amd64
tar -tvzf aster-core-0.5.1-linux-amd64-resources.tar.gz
```

确认 BUILD schema 3、分发类型 `raw-binaries-v1`、目标 `linux/amd64` 和已审查源码；两个程序是静态 amd64 ELF。资源包只有 `aster-core-0.5.1-linux-amd64-resources/` 一个根目录，无绝对路径、`..`、链接或额外 ELF。先以普通用户在空目录解压，用于审查主机工具；以下引导片段在同一 Bash 会话继续，**不要运行尚未核验的程序或脚本**：

```sh
set -euo pipefail
aster_version=0.5.1
aster_stage=$(mktemp -d)
tar -xzf "aster-core-$aster_version-linux-amd64-resources.tar.gz" \
  --directory "$aster_stage" --no-same-owner --no-same-permissions
aster_bootstrap_input="$aster_stage/aster-core-$aster_version-linux-amd64-resources"
```

将资源内 `deploy/scripts/core-manager.py` 和它导入的同目录 `update-manager.py` 与该 Release 已审查提交中的对应文件核对并审查。首次引导依赖官方 TLS 下载来源、资产摘要、来源记录与脚本审查，没有独立发行签名。确认后将这两个文件放入新的 root 受控目录；下列目录已存在时先检查，不覆盖旧工具：

```sh
set -euo pipefail
[[ ! -e /var/lib/aster-bootstrap/0.5.1 && ! -L /var/lib/aster-bootstrap/0.5.1 ]]
sudo install -d -o root -g root -m 0755 /var/lib/aster-bootstrap/0.5.1
sudo install -o root -g root -m 0644 \
  "$aster_bootstrap_input/deploy/scripts/core-manager.py" \
  "$aster_bootstrap_input/deploy/scripts/update-manager.py" \
  /var/lib/aster-bootstrap/0.5.1/
```

目录及所有祖先须由 root 控制、不可组/其他用户写入且无链接；不能以网页目录或普通上传用户仍可改写的目录引导 root 工具。不要使用下载后直接交给 shell 的命令。已发布 Core 0.5.0 的更新工具只认识旧的完整构建策略清单，会拒绝 0.5.1 新清单；它不会自行更新，首次使用须按本节引导新版工具。

先读取主机事实，再准备明确版本。将 socket 换成已核实的宿主机实际路径：

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.1/core-manager.py doctor \
  --release-directory /opt/aster/releases/0.5.1 \
  --socket /run/mysqld/mysqld.sock --listen-address 127.0.0.1:18080
sudo python3 /var/lib/aster-bootstrap/0.5.1/core-manager.py prepare --version 0.5.1
```

`doctor` 只读报告 OS/架构、常用工具是否存在、PID 1、输出路径、磁盘、声明的 socket 和端口监听事实，不执行程序、不连接数据库或占用端口。`warning` 需按现场处理；它不验证 MySQL 内容/权限、服务配置、证书或应用就绪。

`prepare` 独立从固定官方来源核对正常 Release、标签/提交、六资产 SHA-256、BUILD/PROVENANCE、成功构建 run、完整源码映射、归档路径/权限与静态 ELF，再自动组装 API、插件宿主和同版网页/资源到 `/opt/aster/releases/0.5.1`。`--release-directory` 可指定另一个规范绝对新目录；工具只创建受保护的输出父目录，用锁、fsync 和原子不覆盖发布完整目录，不执行任何包内程序。

已经受控上传六个资产时，可追加 `--assets-directory /var/lib/aster-install/core-0.5.1`。输入目录须恰含六资产，全部为 root 受控、不可共享写入、无软/硬链接的普通文件；目录和祖先也须受保护。该选项只省去资产下载，仍独立查询官方来源，不是离线信任绕过。确需私有仓库只读访问时，可追加 `--github-token-file /root/aster-github-read-token`，文件须 root 所有、0600、无链接；凭据由获准秘密管理途径提供，不放进参数值、环境变量、日志或网页。

成功输出 `status=prepared`、`active_release_changed=false`，仅表示新目录准备完成。资源含网页、迁移 SQL、部署工具、文档和许可证；正式迁移仍由所选二进制 `-migrate` 执行，不能直接逐个导入 SQL。工具不创建系统/数据库身份、秘密或管理员，不写配置、切 `current`、启服务、迁移或验收 HTTPS。下面各步骤仍须按顺序完成。

```text
/opt/aster/releases/VERSION/
  bin/aster-api
  bin/aster-plugin-host
  web/
  docs/
  migrations/
  deploy/
  manifests/BUILD.json
  manifests/PREPARED.json          # 本地主机准备回执，不是官方资源资产
  manifests/go-dependencies.json
  manifests/npm-installed-dependencies.json
  licenses/
  LICENSE
/opt/aster/current -> /opt/aster/releases/VERSION
/opt/aster/plugins/<id>/<plugin-version>/
/etc/aster/api.env
/etc/aster/plugins.json             # 非秘密审批，仅 root 可修改
/etc/aster/secrets/                # 不在发布目录或网页根目录内
```

`/opt/aster/releases/VERSION` 及 `current` 链接由 root 管理，API 只有读/执行权限；不要将它们归给 `aster`。API 无需可写应用状态目录，持久数据存入 MySQL，服务日志进入 journal。Nginx 的网页根目录只指向 `current/web`，不要暴露整个发布目录、配置、源码或依赖清单。

`manifests/PREPARED.json` 明确标记为本地回执，记录版本/提交、原资产清单、已验证文件摘要与 operation_id，不把新增回执声称为官方归档内容。输出父目录的 `CORE_PREPARE.jsonl` 和 `.core-manager.lock` 为 0600。失败时按 operation_id 核对记录；已有目标拒绝覆盖。若报告发布后持久化/日志检查失败，目标可能已存在，保留现场与回执，不删除目录后盲目重跑。`prepared` 与当前运行版本是两个事实。

全新安装时，在准备成功的目录上继续建立运行身份与首次链接。已有 `aster` 身份或 `current` 链接时停止，转入 [升级流程](UPGRADE.md)，不要覆盖：

```sh
set -euo pipefail
aster_version=0.5.1
[[ $aster_version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]
[[ -f /opt/aster/releases/$aster_version/manifests/PREPARED.json ]]
[[ -x /opt/aster/releases/$aster_version/bin/aster-api && -d /opt/aster/releases/$aster_version/web ]]
if getent passwd aster >/dev/null || getent group aster >/dev/null || getent group aster-plugins >/dev/null; then
  echo 'aster identity already exists; inspect the installation before continuing.' >&2
  exit 1
fi
[[ ! -e /opt/aster/current && ! -L /opt/aster/current ]]
sudo groupadd --system aster-plugins
sudo useradd --system --user-group --groups aster-plugins --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin aster
sudo ln -s "/opt/aster/releases/$aster_version" /opt/aster/current
sudo install -d -o root -g root -m 0755 /etc/aster /opt/aster/plugins
sudo install -d -o root -g aster -m 0750 /etc/aster/secrets
```

## 2. 数据库与秘密

同机原生安装使用 MySQL 8.4 与独立 utf8mb4 数据库。由数据库管理员审查已有实例、数据目录及用户后建立身份：迁移身份仅用于本库迁移所需 DDL/DML；API 运行身份只授予本库 SELECT、INSERT、UPDATE、DELETE；备份身份按实际工具要求单独审查。不给 API root、GRANT、FILE 或跨库权限，迁移不随每次服务启动自动执行。

专用单机可以在已确认加载的 MySQL `[mysqld]` 配置中设置 `skip-networking=ON`，并用 `mysqlx=0` 关闭未使用的 X Plugin，保留 Unix socket。不要对共享数据库直接套用；配置变更须在维护窗口验证并重启 MySQL。X Plugin 的关闭方式见 [MySQL 官方说明](https://dev.mysql.com/doc/refman/8.4/en/x-plugin-disabling.html)。随后确认 3306/33060 未公开监听，并通过 socket 查询实际 `VERSION()`、`@@socket` 和 `@@datadir`。

通过受控的数据库管理会话先创建三个仅允许 `localhost` 的专用账号，再为全新安装创建数据库并授权。账号密码通过秘密管理途径设置，下面的 SQL 不含密码：

```sql
CREATE DATABASE aster CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE ON aster.* TO 'aster_runtime'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON aster.* TO 'aster_migrator'@'localhost';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON aster.* TO 'aster_backup'@'localhost';
GRANT SHOW_ROUTINE ON *.* TO 'aster_backup'@'localhost';
```

数据库必须尚不存在，账号必须已由管理员创建；既有对象按升级流程处理。迁移与备份身份不得有 `GRANT OPTION`，不能把全局管理权限交给 API。备份元数据权限的用途和限制详见 [备份恢复](BACKUP_RECOVERY.md)。

首选本机 Unix socket；先确认实际 socket 路径、目录权限和服务隔离规则，确保 `aster` 能连接该 socket，但无权读取数据库数据文件。DSN 结构示意为 `DB_USER:SECRET@unix(/run/mysqld/mysqld.sock)/aster?parseTime=true`；路径和占位符必须替换，真实值只写入受限文件。不要把这一示意串直接当作可用凭据。

Core 0.5.1 拒绝 DSN 中任意数据库服务器变量及 charset/collation 覆盖，避免驱动建立连接时隐式执行初始化 SET。使用上述 `parseTime`、连接/TLS 等结构选项，不把 `sql_mode`、会话变量或其他 SQL 设置塞进 DSN；数据库字符集由 DBA 创建和审核。

**本机 Unix socket 模式须显式设置 `MYSQL_ALLOW_INSECURE=true`。** Core 0.5.1 将该例外限制为规范绝对路径的 Unix socket，拒绝借此启用明文 TCP；仍须审查实际 socket/目录权限。所有检查、迁移、引导与 API 运行命令均需一致。不能仅填写 `tls=true` 来假装 socket 已做 TLS 验证。

若之后改成 TCP/跨主机数据库，应单独审查拓扑，将 `MYSQL_ALLOW_INSECURE=false`，使用 `tls=true`、证书匹配主机名和可信 CA，禁止 `skip-verify`、`preferred`、`allowFallbackToPlaintext=true`。远程数据库方案需单独验证；也不通过关闭 SELinux/AppArmor 或放宽到任意来源来解决权限错误。

使用上一步建立的无登录权限 `aster` 系统身份。应用目录由管理员所有，运行身份只有读取和执行权限。由批准的秘密管理工具提供：

- 独立随机会话秘密（至少 32 字节，不使用示例值）；放入 `/etc/aster/secrets/session_secret`。
- 运行 DSN：`/etc/aster/secrets/mysql_runtime_dsn`。
- 迁移 DSN：放入仅迁移操作身份可读的位置；**不要**放在运行账号可读的秘密目录。
- 初始化管理员密码：独立的 16–72 字节强口令，保存在临时受限文件；不放进命令行、聊天或源码。

`/etc/aster` 使用 `root:root`、0755，使独立插件可读非秘密审批；`api.env` 仍为 `root:aster`、0640。`/etc/aster/secrets` 使用 `root:aster`、0750，会话秘密与运行 DSN 使用 `root:aster`、0640；用 `sudo -u aster test -r 文件路径` 验证可读，且确认 `aster` 无权修改文件。迁移/备份秘密由对应操作身份保管，运行账号不得读取。秘密的备份、轮换和销毁独立于版本归档管理。

审查并复制 `deploy/systemd/api.env.example` 到 `/etc/aster/api.env`，所有者 `root:aster`、权限 0640。配置精确 HTTPS `APP_ORIGIN`、回环监听地址、可信代理和文件引用，不放秘密值。Origin 使用规范小写 ASCII 主机名，无路径、尾斜杠、查询或片段，默认 443 端口省略；必须与浏览器实际来源一致。后台“展示地址”不会修改 `APP_ORIGIN`、DNS、TLS、监听地址或可信代理范围。不要把 systemd 环境文件作为 shell 脚本 `source` 执行。

```sh
sudo install -o root -g aster -m 0640 /opt/aster/current/deploy/systemd/api.env.example /etc/aster/api.env
sudoedit /etc/aster/api.env
```

设置真实 `APP_ORIGIN`，本机 socket 模式明确改成 `MYSQL_ALLOW_INSECURE=true`。通过秘密管理工具分别落盘 `session_secret`、`mysql_runtime_dsn` 后，核对权限，不在终端打印内容。迁移及引导密码文件放在 `/etc/aster/secrets` 之外的私密运维目录。

### 可选：SMTP 加密密钥

不启用 SMTP 时，保留 `SMTP_ENCRYPTION_KEY_FILE` 未设置。此时不能发信，即使恢复库保存了启用状态也不会发送。`EMAIL_PROVIDER=email.disabled` 不是受管理 SMTP 的总开关；后台保存配置与启用后才允许管理员主动测试。

启用前在已核验、由 root 控制且不可被其他用户替换的 `/etc/aster/secrets` 中生成一次专用密钥。文件必须是 **32 字节原始随机数据**，不是十六进制、base64 或带换行的文本；不能是软链接或硬链接。所有父目录归 root 或运行身份所有，不允许组/其他用户写入。该文件与其他秘密不同，不能用 0640：下面使用 `aster:aster`、0400，API 需可读，systemd 保留 `ProtectSystem=strict` 以禁止运行进程修改 `/etc`。

以下命令只用于首次生成，已有文件会拒绝覆盖；不要在普通升级或故障恢复时重新执行。密钥不会输出到终端：

```sh
sudo python3 - <<'PYKEY'
import os
import pwd
import secrets
account = pwd.getpwnam("aster")
path = "/etc/aster/secrets/smtp_encryption_key"
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "wb") as key_file:
    key_file.write(secrets.token_bytes(32))
    key_file.flush()
    os.fsync(key_file.fileno())
    os.fchown(key_file.fileno(), account.pw_uid, account.pw_gid)
    os.fchmod(key_file.fileno(), 0o400)
PYKEY
sudo -u aster test -r /etc/aster/secrets/smtp_encryption_key
```

生成失败时先检查私密文件状态，不盲目覆盖。将 `SMTP_ENCRYPTION_KEY_FILE=/etc/aster/secrets/smtp_encryption_key` 加入 `/etc/aster/api.env`。已有服务需重启；首次安装完成下文迁移后再按第 4 节启动并检查就绪。无效文件会阻止启动，未设置变量则保持发信不可用。不要把内容复制到环境变量、浏览器、日志、Git 或 Release。密钥加载一次，后续文件变化需重启。

完成迁移及 [独立插件安装/审批](PLUGINS.md)后，按 [官方 SMTP 配置](PLUGINS.md#官方-smtp-配置与测试)保存服务器、TLS 与凭据，再向获准地址主动发送测试邮件。普通配置保存不会发信，测试也不启用通知或找回密码。启用前完成 [独立密钥备份与恢复准备](BACKUP_RECOVERY.md#smtp-密钥备份恢复与轮换)；只备份数据库不能恢复 SMTP 凭据。

### 可选：独立 SMTP 程序

Core 不内置 SMTP 传输。按 [插件安装与启停](PLUGINS.md)取得 SMTP 独立 Release，校验安装到 `/opt/aster/plugins/email.smtp/<version>`，准备 `aster-smtp` 无登录账号及 `/etc/aster/plugins.json`。策略默认关闭，需要明确选择、批准目的地主机/端口并启用；插件管理工具不执行程序或管理 systemd。

首次接入需更新 API 的 `PLUGIN_DIRECTORY` / `PLUGIN_POLICY_FILE` 和共享 socket 组并重启 API；后续插件版本替换只更新策略并重启 `aster-smtp`，不重编/重启 API。Core 和插件分别检查兼容区间、SHA、Unix 对端身份及同连接握手。缺少插件或审批时账号/订单/账单继续服务，SMTP 不可用。

`/etc/aster` 必须 root:root 0755，策略 root 管理且非秘密；API 环境、DSN/会话秘密和 SMTP 加密密钥保留各自受限权限，插件不得读这些文件。Linux amd64 宿主要求 Linux >=5.11；Ubuntu 24.04 基线满足，其他内核不得通过降低隔离绕过。

## 3. 迁移与管理员

先使用新版本的明确路径和干净环境执行只读检查。`-preflight` 与 `-schema-status` 是两个互斥的同义入口，不能与 `-migrate`、`-create-user` 或 `-version` 合用。配置值须与已审核的服务配置一致，包括实际使用的代理、集成和可选秘密引用；不要把 `api.env` 当 shell 脚本 source。下例对应本机 Unix socket，仅由能读取相应受限文件的授权操作身份执行：

```sh
env -i APP_MODE=production APP_ORIGIN=https://billing.example.com \
  LISTEN_ADDR=127.0.0.1:18080 TRUSTED_PROXY_CIDRS=127.0.0.1/32 \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/path/private/mysql_migration_dsn \
  MYSQL_ALLOW_INSECURE=true \
  /opt/aster/releases/0.5.1/bin/aster-api -preflight
```

只读 JSON 检查规范 HTTPS origin、会话秘密、回环监听语法、代理/禁用集成及实际设置的 SMTP 密钥和更新凭据文件，再用有界 SELECT 检查 MySQL 8.4、非系统 utf8mb4 专用库、完整迁移前缀/checksum 与所需物理结构。它不建表、不迁移、不创建用户、不启动 HTTP、插件或查询 Release；失败返回脱敏 JSON 和非零退出码。

`database.status=empty` 表示已存在目标库的完整基础表清单为空，可继续审查首次迁移；`pending_migrations` 表示已识别的旧迁移前缀/结构，列出待执行版本，已有安装应走 [升级流程](UPGRADE.md)；`current` 表示当前所需 schema/结构通过。三者都可退出 0，不能仅看退出码判为安装完成。`current` 的 `admin_count=0` 仍需初始化首位管理员。

检查会用只读 `SHOW GRANTS` 核对直接库级/全局 SELECT 可见性，要求无活动角色并拒绝部分撤销等无法明确判断的授权；不会输出账号或原始 grants。`table_visibility_verified=true` 和 `empty_target_scope=base_tables` 仍不证明隐藏的非表对象为空、运行身份仅有 DML、迁移/备份身份权限分离、完整业务数据、停写状态、插件运行、端口空闲、服务配置、公共 TLS 或备份/恢复。DBA 仍须独立核对所有对象和本库运行/迁移/备份权限。

初次迁移前确认结果确为 `empty` 的专用库，并由 DBA 确认没有其他既有对象或写入；已有数据必须先执行 [升级与回滚](UPGRADE.md)。以下命令会写入数据库：

```sh
# 下面路径须由迁移操作身份可读；不要输出文件内容。
env -i APP_MODE=production APP_ORIGIN=https://billing.example.com \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/path/private/mysql_migration_dsn \
  MYSQL_ALLOW_INSECURE=true \
  /opt/aster/releases/0.5.1/bin/aster-api -migrate
```

CLI 要求完整的生产模式配置，连接必须确实是本机 Unix socket。核对迁移版本和 checksum；当前应用包含迁移 1–7，迁移 007 新增币种配置与历史快照，当前为 14 张基础表；以选定发布源码为准。迁移失败也可能已提交部分 DDL，按 [升级故障判断](UPGRADE.md#失败后的判断)保留现场，不自动恢复旧库。

迁移成功后，把上面的 DSN 改为 `/etc/aster/secrets/mysql_runtime_dsn` 再运行 `-schema-status`，确认 `database.status=current`，核对管理员数。首次引导仅在已核实没有管理员且尚未成功创建的安装中执行；用运行身份 DSN 和独立初始化密码文件创建管理员，不为引导账号授予 DDL 权限：

```sh
env -i APP_MODE=production APP_ORIGIN=https://billing.example.com \
  SESSION_SECRET_FILE=/etc/aster/secrets/session_secret \
  MYSQL_DSN_FILE=/etc/aster/secrets/mysql_runtime_dsn \
  MYSQL_ALLOW_INSECURE=true \
  BOOTSTRAP_EMAIL=operator@example.com BOOTSTRAP_NAME='运营管理员' \
  BOOTSTRAP_ROLE=admin BOOTSTRAP_PASSWORD_FILE=/path/private/bootstrap_password \
  /opt/aster/releases/0.5.1/bin/aster-api -create-user
```

邮箱只是示例，需要替换；CLI 不发送邮件、不验证邮箱所有权。保留创建结果，再用运行身份执行只读检查核对管理员数；网络/终端结果不确定时先查现状，不能重置密码或重复添加另一个管理员来绕过。没有公共注册、找回密码、MFA 或完整账号生命周期管理。初始化完成后按秘密管理政策移走临时密码文件；不要声称普通文件删除可保证磁盘安全擦除。创建客户时明确使用 `BOOTSTRAP_ROLE=customer`，不得复用管理员密码。

## 4. 服务与 HTTPS

审查 `deploy/systemd/aster-api.service` 后，按目标发行版安装到 `/etc/systemd/system/`。它假定 `/opt/aster/current` 已指向本版本、`aster` 用户存在、配置及 socket 可访问。确认本机 MySQL 的实际 service 名称、启动次序和失败恢复方式；模板不能保证每个发行版的依赖命名一致。API 只监听 `127.0.0.1:18080`，systemd 不执行迁移或备份。

```sh
sudo install -o root -g root -m 0644 /opt/aster/current/deploy/systemd/aster-api.service /etc/systemd/system/aster-api.service
sudo systemd-analyze verify /etc/systemd/system/aster-api.service
sudo systemctl daemon-reload
sudo systemctl start aster-api
sudo systemctl status aster-api --no-pager
```

先完成应用就绪和业务测试，再单独启用已审查的开机启动配置，并安排授权重启验收。静态 `systemd-analyze verify` 或一次 `start` 成功，都不能证明整机重启后会恢复服务；目标主机开机恢复不在上述 CI 验证范围内。

在 Nginx `http {}` 中引入经过修改的 `deploy/nginx.native.conf`。替换域名、证书路径，检查 Nginx 版本支持模板指令，并审查与已有默认站点/监听端口的冲突；不要覆盖同机其他业务。执行 `nginx -t` 后才 reload。模板由 Nginx 直接终止 TLS，用实际 socket 对端的 `$remote_addr` 覆盖客户端 IP 头；若已有全局 real_ip 配置，先审查其是否会改写此值。API 只信任 Nginx 的精确回环来源。增加 CDN/前置代理时必须重新审查完整信任链，不能直接信任浏览器的转发头。

Ubuntu 的标准配置会在 `http {}` 中加载 `sites-enabled`。确认本应用使用独立、未占用的文件名后：

```sh
sudo install -o root -g root -m 0644 /opt/aster/current/deploy/nginx.native.conf /etc/nginx/sites-available/aster.conf
sudoedit /etc/nginx/sites-available/aster.conf
sudo ln -s /etc/nginx/sites-available/aster.conf /etc/nginx/sites-enabled/aster.conf
sudo nginx -t
sudo systemctl reload nginx
```

模板声明 80/443 默认站点；若发行版欢迎页也占用默认站点，先核对它没有承载其他业务，再停用其 `sites-enabled` 链接。真实域名及公共 CA 证书由该部署环境提供，模板不会申请证书或配置 DNS；证书路径必须存在且私钥权限受控。隔离验收使用临时私有 CA 与 localhost，只能证明该测试信任链下的 TLS 校验，不等于公共 CA 签发、真实 DNS 或续期已完成。

先验证证书链、SNI、续期监控，再开放公众流量。生产模式 API 已发送 `Strict-Transport-Security: max-age=31536000`；需结合静态站点制定一致的 HSTS 政策，不要误以为 Nginx 没写 HSTS 就完全没有该响应头。不要用 `curl -k` 的成功结果验收证书，也不要以测试关闭浏览器安全设置。systemd 与 Nginx 文件需按目标路径、域名、证书和既有站点调整；它们不会自动安装服务器或申请证书。

## 后台更新的运行权限

安装后按 [UPDATES.md](UPDATES.md)使用管理员版本更新入口。API 只能查询固定官方 Release 并记录明确请求的交接，不应授予 root、sudo、运行目录写权限或 service 管理能力。不要为“网页更新”把程序或插件目录归给 `aster`。主机运维工具在独立权限边界核验并准备程序，实际停服、Core/网页切换和数据库迁移仍遵循维护窗口与恢复计划。

## 5. 初次验收与站点配置

```sh
curl --fail --show-error https://billing.example.com/healthz
curl --fail --show-error https://billing.example.com/readyz
```

实际 HTTPS `/readyz` 通过、证书可信、网页/资源可访问且首位管理员登录成功后，才将最终入口 `https://billing.example.com/` 交付给使用者；域名须换成真实 `APP_ORIGIN`。准备工具输出、只读检查或 `systemctl start` 成功均不代替这一步。

确认网页与 `/api/` 同源、Secure/HttpOnly/SameSite cookie 生效、API 不泄露 SQL/配置值。用管理员在“站点设置”中配置运营名称、支持方式、账单抬头、预设标志和主题；见 [站点与计价](SITE_SETTINGS.md)。全新安装仅启用 CNY，示例价格不可售。管理员须在“财务设置”审核币种与各币种独立价格，确认套餐/报价/币种三个开关后启售；客户只能选择已启用币种。升级保留旧 USD 报价和历史，不重置成新安装。缺价或停用应显示不可购买，不能用另一币种价格替代。完整规则见 [财务模型](FINANCIAL_MODEL.md)。

至少用两个测试客户验证资源隔离、管理员专属入口、订单幂等、币种不匹配和支付失败关闭。新订单只生成待付款账单；没有任何真实扣款或 VPS 开通。完整验收见 [ACCEPTANCE.md](ACCEPTANCE.md)，实际运行证据见 [VALIDATION.md](VALIDATION.md)。

为本次安装留存发布提交/哈希、实际 MySQL 版本及 socket、账号权限、服务状态、证书链和恢复演练记录。整机重启、公共 CA 证书续期、独立实例或离机恢复分别安排验证，不能由 CI 的 API 重启及同实例空库恢复推定。日常运维见 [OPERATIONS.md](OPERATIONS.md)。
