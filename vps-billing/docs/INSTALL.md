# Ubuntu 24.04 原生单机安装

Core 0.5.2 提供由主机管理员明确启动的原生安装/升级执行器。先核验官方资产并准备完整版本目录，再审查私密实例规格与只读计划，最后用计划 SHA-256 确认实际操作。全新安装会创建专用数据库及账号、系统运行身份、秘密文件、配置、schema、首位管理员和原生服务，切换版本并检查 HTTPS。它不安装操作系统组件、申请证书或修改 DNS。已有实例使用 [升级流程](UPGRADE.md)，不能重跑全新安装覆盖。

支付、退款与 VPS 开通尚未接入；SMTP 1.1.0 独立安装、默认关闭，仅支持管理员配置和主动测试。`APP_MODE=production` 表示持久化及严格配置检查，不是生产认证。历史原生检查的准确提交、运行和限制见 [VALIDATION.md](VALIDATION.md)；本文不把新增功能的文档视为已完成验收。宝塔共享环境另见 [BAOTA.md](BAOTA.md)。

## 前置确认

目标为 **Ubuntu Server 24.04 LTS / amd64**，已有 Python 3、Bash/GNU 工具、systemd、Nginx，以及可通过本机 Unix socket 使用的 Oracle MySQL **8.4 LTS** 和兼容的 `mysql`/`mysqldump`。运行 API 不需要 Go 或 Node.js。管理员先审查容量、现有服务、端口和目录，提供真实 HTTPS 域名及受信任证书。系统软件与 MySQL 实例本身须按 [Ubuntu Nginx 指引](https://ubuntu.com/server/docs/how-to/web-services/install-nginx/)及 [MySQL 官方 APT 指引](https://dev.mysql.com/doc/mysql-apt-repo-quick-guide/en/)独立安装、核验；不要在旧库主机上执行新装数据库步骤。

通过受控的数据库管理会话确认实际 `VERSION()`、`@@socket`、`@@datadir` 与 `@@skip_networking`。全新安装要求受支持的 MySQL 8.4 且 TCP 已关闭，使用专用新数据库名；数据库以及同名前缀的三个应用账号必须尚不存在。不要修改共享实例的 root 密码、删除旧库或放宽远程访问来通过检查。

路径、工具、证书和输入文件须为规范绝对路径，祖先由 root 保护，无软链接、可共享写入目录或配置元字符。常见证书管理器的 `live/` 链接不能直接作为执行器输入：经管理员核验后提供受保护的普通证书/私钥文件，另行管理续期、同步和重载。真实域名、DNS、公共 CA、入口防火墙及证书续期不由执行器配置，也不从隔离测试 CA 的成功推导已完成。

## 1. 核对来源与归档

从固定官方仓库的正常 [Release](https://github.com/xiaoqiqixi/betteridcsys/releases)选择 `v0.5.2`，取得同一 Release 的六资产：

- `aster-api-0.5.2-linux-amd64`
- `aster-plugin-host-0.5.2-linux-amd64`
- `aster-core-0.5.2-linux-amd64-resources.tar.gz`
- `BUILD.json`、`PROVENANCE.json`、`SHA256SUMS`

核对源码提交、构建 run、版本和全部资产摘要。BUILD 为 schema 3、`raw-binaries-v1`、`linux/amd64`；资源只有 `aster-core-0.5.2-linux-amd64-resources/` 一个根目录，不含链接、绝对路径、`..` 或额外 ELF。校验和与未签名来源记录依赖可信官方渠道，不是独立发行签名。历史 Core/SMTP 资产保持原样。

```sh
cd /path/to/downloads
sha256sum -c SHA256SUMS
file aster-api-0.5.2-linux-amd64 aster-plugin-host-0.5.2-linux-amd64
tar -tvzf aster-core-0.5.2-linux-amd64-resources.tar.gz
```

确认来源和归档清单后，以普通用户在空目录解压以审查工具，不执行尚未核验的文件：

```sh
set -euo pipefail
aster_version=0.5.2
aster_stage=$(mktemp -d)
tar -xzf "aster-core-$aster_version-linux-amd64-resources.tar.gz" \
  --directory "$aster_stage" --no-same-owner --no-same-permissions
aster_bootstrap_input="$aster_stage/aster-core-$aster_version-linux-amd64-resources"
```

将 `deploy/scripts/` 中的 `core-manager.py`、`core-operation.py`、`update-manager.py`、`plugin-manager.py` 与该 Release 已审查源码核对。确认后将四个文件引导到新的 root 保护目录；已有目录时先查来源，不覆盖未知工具：

```sh
set -euo pipefail
[[ ! -e /var/lib/aster-bootstrap/0.5.2 && ! -L /var/lib/aster-bootstrap/0.5.2 ]]
sudo install -d -o root -g root -m 0755 /var/lib/aster-bootstrap/0.5.2
sudo install -o root -g root -m 0644 \
  "$aster_bootstrap_input/deploy/scripts/core-manager.py" \
  "$aster_bootstrap_input/deploy/scripts/core-operation.py" \
  "$aster_bootstrap_input/deploy/scripts/update-manager.py" \
  "$aster_bootstrap_input/deploy/scripts/plugin-manager.py" \
  /var/lib/aster-bootstrap/0.5.2/
```

所有祖先须 root 控制且不可组/其他用户写入。不要从上传目录执行 root 工具，不使用下载后直接交给 shell 的命令。旧版工具的完整受信清单不会自动认识后续工具；首次使用 0.5.2 须核验新版资源，不能删减清单或改版本绕过。

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-manager.py doctor \
  --release-directory /opt/aster/releases/0.5.2 \
  --socket /run/mysqld/mysqld.sock --listen-address 127.0.0.1:18080
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-manager.py prepare --version 0.5.2
```

`doctor` 只读主机事实，不执行程序或连接数据库。`prepare` 独立核验固定官方 Release、标签/提交、六资产、BUILD/PROVENANCE、成功构建及完整源码映射，然后不可覆盖地组装 API、插件宿主、网页和资源；不激活服务。可用 `--release-directory` 指定另一个受保护新目录，或用 `--assets-directory` 指向恰含六个 root 保护普通资产的目录；后者仍查询官方来源。确需独立只读凭据时，用 `--github-token-file` 引用 root 所有的 0600 普通文件，不把 token 值放进参数或环境。

`status=prepared` 与 `manifests/PREPARED.json` 只证明目录准备完成。回执是本地记录，不是官方资产或独立签名。`CORE_PREPARE.jsonl` 与 `.core-manager.lock` 记录准备操作；发布后同步失败可能已产生目标，先检查现场，不删除后重跑。

## 2. 数据库与秘密

管理员通过批准的秘密管理途径，在 root 私密目录准备：

- DBA MySQL client 文件，例如 `/root/aster-install/dba.cnf`，仅一个 `[client]`、一个 `user=` 与可选 `password=`；不允许 includes、目标覆盖或额外客户端选项。该身份仅供本次新库/账号创建，API 不获得它。
- 首位管理员密码文件，例如 `/root/aster-install/admin_password`，16–72 字节强口令；邮箱和姓名在私密规格中明确指定。
- 已核验的 TLS 证书及匹配私钥。公共 CA 使用系统信任；隔离环境可另传 `ca_file`，不能关闭证书/主机名验证。

规格、DBA client 文件、管理员密码及 TLS 私钥须 root 所有、0600、单一硬链接的普通文件；私密输入目录 0700，所有祖先受保护。证书/CA 可用 root 所有的 0644 普通文件。用受控编辑器或秘密管理工具直接写入；不要使用带密码的命令、shell `source`、`bash -x`、完整环境转储或将秘密粘贴进日志/历史。以下只建立一个已确认未复用的新私密输入目录：

```sh
sudo install -d -o root -g root -m 0700 /root/aster-install
```

执行器为本次新实例生成独立随机数据库密码和会话秘密，创建 `<database>_runtime`、`<database>_migrator`、`<database>_backup` 本机账号。API 运行账号仅本库 SELECT/INSERT/UPDATE/DELETE；迁移和备份身份分开，DBA 凭据不进入运行配置。运行 DSN、会话秘密与 `api.env` 使用受限文件权限；迁移/备份凭据保存在 root 私密操作目录。备份账号除本库 SELECT/SHOW VIEW/TRIGGER/EVENT 外，还获全局 SHOW_ROUTINE，其例程元数据可见范围不限于本库；管理员须在确认计划前接受这一权限范围，详见 [备份权限与限制](BACKUP_RECOVERY.md#范围与前提)。保留这些恢复资料，另行受控备份，不上传 Git、Release 或网页。

### 可选：SMTP 加密密钥

全新安装不启用 SMTP，不生成替代旧密钥。需要 SMTP 时，按 [PLUGINS.md](PLUGINS.md)独立安装/批准 SMTP 1.1.0、不同 worker 身份和 Unix socket；专用密钥的备份与恢复见 [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md#smtp-密钥备份恢复与轮换)。

密钥必须恰为 **32 字节原始随机数据**，不是十六进制、base64 或带换行文本。由获准秘密管理途径在新的规范绝对路径写入，采用 API 运行身份所有、0400、单一硬链接的普通文件；所有祖先无软链接，归 root 或运行身份所有且不可被组/其他用户写入。建议放在 root 控制的 `/etc/aster/secrets/`，通过 `SMTP_ENCRYPTION_KEY_FILE` 引用。以实际 API 身份核对可读，同时确认独立 worker 无法读取、未加入可读 API 秘密的组；不要用会话/DSN 的 0640 模式处理此密钥。普通升级或恢复不能重新随机生成密钥替代原密钥，密钥值不进入命令参数、终端或日志。SMTP 安装、目的地审批和主动发信不属于 Core 安装的隐式动作。

## 3. 迁移与管理员

用受控编辑器保存 `/root/aster-install/install.json`，权限 0600。下面是规格结构示例，域名、工具路径、证书、唯一 operation ID 和 Nginx SHA-256 必须换成实际审核值；含占位值的规格不会通过。`operation_id` 为新生成的 32 位小写十六进制标识，不复用旧操作 ID。`instance_root`、`config_root`、`state_directory` 必须互不嵌套。

```json
{
  "schema": 1,
  "action": "install",
  "operation_id": "REPLACE_WITH_NEW_32_HEX_OPERATION_ID",
  "release_directory": "/opt/aster/releases/0.5.2",
  "instance_root": "/opt/aster",
  "config_root": "/etc/aster",
  "state_directory": "/var/lib/aster-operations",
  "origin": "https://billing.example.com",
  "listen_address": "127.0.0.1:18080",
  "edge_listen_address": "0.0.0.0",
  "runtime_user": "aster",
  "api_unit": "aster-api.service",
  "socket": "/run/mysqld/mysqld.sock",
  "database": "aster",
  "mysql_binary": "/usr/bin/mysql",
  "mysqldump_binary": "/usr/bin/mysqldump",
  "nginx_binary": "/usr/sbin/nginx",
  "nginx_sha256": "REPLACE_WITH_REVIEWED_64_HEX_SHA256",
  "edge_mode": "managed",
  "certificate": "/etc/aster-tls/fullchain.pem",
  "certificate_key": "/etc/aster-tls/privkey.pem",
  "dba_client_config": "/root/aster-install/dba.cnf",
  "bootstrap_email": "operator@example.com",
  "bootstrap_name": "Site administrator",
  "bootstrap_password_file": "/root/aster-install/admin_password",
  "enable_at_boot": true
}
```

数据库名最多 20 个 ASCII 字符，首字符为字母或下划线；运行身份须使用专用 `ast...` 名称，unit 须为 `aster...service`。API 固定回环 IPv4 和 1024–65535 端口；`origin` 为规范小写 HTTPS DNS 来源，无路径/尾斜杠，非 443 端口需明确写出。`edge_listen_address` 是审查过的边缘 IPv4 监听地址，不能把 CI 的 `127.0.0.1` 当作公开入口。工具只接受既定字段，不接受 URL、shell 或任意命令覆盖。

只读计划检查准备目录、工具摘要、TLS、规格与秘密输入，输出 `plan_sha256`。管理员逐项核对实例、域名/端口、数据库、身份、待执行动作及权限；计划不代表数据库已经创建或站点已可用。计划输出用于核对实例和动作，完整固定输入和摘要在实际操作的私密 `PLAN.json` 留存；规格与计划资料均应私密保管。审核后手工复制 **本次计划的实际 SHA-256** 进行明确确认，不用流水线自动接受输出：

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py plan \
  --spec /root/aster-install/install.json
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py apply \
  --spec /root/aster-install/install.json \
  --confirm-plan-sha256 REVIEWED_PLAN_SHA256
```

`apply` 在任何创建前拒绝已有用户/同名组、数据库/三个应用账号、配置根、`current` 或实例 unit；冲突应调查或转升级，不能删除未知数据来继续。确认后它使用锁和私密 journal 记录进度，创建身份、受限文件与专用数据库，安装审查过的配置/unit，执行所选版本的迁移及首次管理员引导，然后切换 Core/网页、启动服务并核查 HTTPS/静态入口。迁移和引导不在服务开机时自动重复。不能单凭 `-preflight` 退出 0 判断 schema 已就绪：`empty`、`pending_migrations`、`current` 含义不同，实际执行器核对结构化结果。

## 4. 服务与 HTTPS

`edge_mode=managed` 仅用于明确独占的监听地址/端口：执行器创建该实例的 Nginx 配置和独立边缘 unit，并在检查配置后启动；不要与已运行的系统/面板 Nginx 抢占端口。API 目录、网页和配置由 root 管理，API 保持非 root、仅回环监听。全新规格必须明确 `enable_at_boot`：`true` 授权启用本次 API 及 managed 边缘 unit，`false` 只启动本次服务、不启用开机启动。该选择不证明整机重启后恢复；MySQL 实际 unit 名称、证书续期、依赖次序和重启恢复仍须在目标环境另行审核验证。

已有共享 Nginx 或宝塔使用 `edge_mode=external`，另提供受保护的完整主配置 `external_nginx_config` 与精确 `external_nginx_sha256`。管理员先将本站静态根、上游、TLS 和维护门禁合并到现有配置，审查所有 include 与实例路径；执行器只按指定程序/配置运行固定配置检查和 reload，不重写无关站点。具体门禁及面板约束见 [BAOTA.md](BAOTA.md)。未知自定义拓扑、任意 unit/drop-in 或不同数据库模型不自动接管。

失败或终端返回不确定时，先读取真实检查点：

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py status \
  --state-directory /var/lib/aster-operations --operation-id ACTUAL_OPERATION_ID
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py resume \
  --spec /root/aster-install/install.json \
  --confirm-plan-sha256 ORIGINAL_REVIEWED_PLAN_SHA256
```

`resume` 必须使用原规格、原 ID 和原确认摘要，重新核对受保护输入及已完成步骤；不等于忽略失败继续执行。结果不明的数据库/账号创建、迁移或引导不能盲目重复，公开状态可能为 `needs_manual_recovery`（私密 journal 为 `recovery_required`），要求检查。不要删 journal、改状态、重置密码或另建 ID 掩盖已执行动作。私密目录内的 `PLAN.json`、`JOURNAL.json`、凭据与备份必须保持 root 私密；没有自动数据库回滚。

## 后台更新的运行权限

主机管理员为每次确认的操作启动一次执行器；API 不获得 sudo、root、服务控制 socket 或目录写权限。网页仍可查询固定官方 Release 和生成审计交接。可选在规格中设置 `status_file` 为独立脱敏导出文件，例如 `/var/lib/aster-status/STATUS.json`，并在 API 环境中使用相同的 `HOST_OPERATION_STATUS_FILE`。先建立 root 所有、API 可读的保护父目录；导出路径必须位于实例、配置与私密状态根之外。文件由 root 写入，只授予 API 读取；不能指向私密 journal。升级时规格路径必须与既有 `HOST_OPERATION_STATUS_FILE` 一致，不能在执行中悄悄新增引用。未配置、尚无回执、不可读取和实际操作状态分别展示，网页不会代替主机执行或推断成功。配置变更需要受控服务重启，详见 [UPDATES.md](UPDATES.md)。

## 5. 初次验收与站点配置

```sh
curl --fail --show-error https://billing.example.com/healthz
curl --fail --show-error https://billing.example.com/readyz
```

将示例换成真实 `APP_ORIGIN`，使用正常证书验证，不能以 `curl -k` 验收。执行器完成服务/HTTPS 检查后仍标记需要业务验收：确认网页和资源正确、首位管理员可登录、会话 Cookie 属性和客户隔离正常，才能交付实际入口。准备目录、计划、service start 与完整站点验收是不同事实。

管理员按 [站点设置](SITE_SETTINGS.md)设置品牌和账单抬头，按 [财务模型](FINANCIAL_MODEL.md)审核币种与独立报价。全新安装仅启用 CNY，示例价格不可售；升级保留旧 USD 报价和历史。确认套餐/报价/币种三个开关后启售，缺价不能使用另一币种金额替代。用合成客户验证幂等、权限、历史账单和支付失败关闭；订单只生成待付款账单，不扣款或创建 VPS。

留存发布提交/摘要、MySQL 版本/socket、账号权限、操作 journal、服务/TLS 和恢复演练记录。公共 CA 续期、整机重启、容量、独立实例/离机恢复另行验收，具体范围见 [ACCEPTANCE.md](ACCEPTANCE.md)、[VALIDATION.md](VALIDATION.md)及[日常运维](OPERATIONS.md)。
