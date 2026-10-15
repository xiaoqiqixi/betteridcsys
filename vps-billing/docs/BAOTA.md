# 宝塔面板原生部署与更新

本指南用于已安装宝塔 Linux 面板的单服务器：复用面板管理的 Nginx 和 MySQL，静态前端由 Nginx 提供，Go API 由 systemd 独立管理。应用验证基线为 Ubuntu 24.04 / amd64、MySQL 8.4 LTS；宝塔面板本身及其版本组合未在本项目 CI 安装验收。实际工程结果见 [原生验证记录](VALIDATION.md)。

宝塔官方公开说明提供网站、文件管理、SSL、数据库和反向代理能力；具体入口以已安装版本为准。以下 Nginx/systemd 配置是本项目的适配方案，不要求安装付费插件。没有面板的主机应先按 [宝塔官方安装说明](https://www.bt.cn/bbs/thread-19376-1-1.html) 单独规划面板安装；已有网站或数据库的服务器不能直接运行新装面板/重装环境脚本。

## 1. 核对已有环境

记录面板版本、系统、CPU 架构、Nginx/MySQL 实际版本、服务名称、可执行文件和配置路径，以及 80/443/18080 端口使用情况。不要在宝塔管理的环境中再执行普通 Ubuntu 安装手册里的 `apt install nginx mysql-server`，也不要卸载或接管同机其他服务。

```sh
cat /etc/os-release
uname -m
sudo ss -ltnp
systemctl list-units --type=service --all
```

MySQL 必须确认为 8.4 LTS；软件列表可选版本不等于现有实例已升级。用现有受控数据库管理连接查询 `SELECT VERSION(), @@socket, @@datadir;`，记录实际 socket。旧 MySQL/MariaDB 的数据应先在隔离副本验证迁移，不能在共享实例上直接切版本。应用不需要 PHP、Redis、Node 常驻进程或第二套 Nginx。

为本应用分配独立域名，例如 `billing.example.com`。下面所有域名、VERSION、路径和账号都是需要替换的值；保留原有站点、证书、数据库和管理入口。

## 2. 准备同版本程序与网页

Core 0.5.1 的正常 Release 提供六资产：原始 API、插件宿主、资源归档及 `BUILD.json`、`PROVENANCE.json`、`SHA256SUMS`。资源包含编译好的网页和主机工具，服务器无需 Go/Node.js。按 [安装手册第 1 节](INSTALL.md#1-核对来源与归档)核对官方来源、资产摘要、构建提交/run，并将已核验且审查过的新版 `core-manager.py` 与同目录 `update-manager.py` 引导到 root 保护目录。旧 Core 0.5.0 的更新工具不认识 0.5.1 新策略清单，不能直接代替此次引导。

使用普通受控上传途径时，把六资产放在网站目录以外，再由管理员核对为 root 所有、不可共享写入、无链接的独立输入目录；不要让面板 Web 身份执行 root 工具。以下 socket 是宿主机实际路径，须替换：

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.1/core-manager.py doctor \
  --release-directory /opt/aster/releases/0.5.1 \
  --socket /actual/mysql.sock --listen-address 127.0.0.1:18080
sudo python3 /var/lib/aster-bootstrap/0.5.1/core-manager.py prepare \
  --version 0.5.1 --assets-directory /var/lib/aster-install/core-0.5.1
```

省略 `--assets-directory` 时工具自行从固定官方来源下载六资产；两种方式都独立校验当前官方 Release、源码/构建来源和完整文件树，再自动组装为新的完整版本目录，不需要手工复制 API、插件宿主或前端。`doctor` 只读主机事实；面板工具不在标准 PATH 时可能提示缺失，须独立核对其真实路径。它不运行 Nginx/MySQL、不连接数据库、不验证面板兼容性。

准备完成后的路径为：

```text
/opt/aster/releases/VERSION/bin/aster-api
/opt/aster/releases/VERSION/bin/aster-plugin-host
/opt/aster/releases/VERSION/web/index.html
/opt/aster/releases/VERSION/web/assets/
/opt/aster/releases/VERSION/manifests/PREPARED.json
/opt/aster/current -> /opt/aster/releases/VERSION
/opt/aster/plugins/email.smtp/PLUGIN_VERSION/
/etc/aster/api.env
/etc/aster/plugins.json
/etc/aster/secrets/
```

`status=prepared` 仅表示新目录已准备；本地 `manifests/PREPARED.json` 是运维回执，不是官方资源资产。工具不创建账号/秘密、配置面板、建库、迁移、初始化管理员、切 `current` 或启动服务。后续由获准管理员按安装手册继续身份、配置、数据库和服务步骤；出现已有版本、校验失败或发布后持久化不确定时保留 `CORE_PREPARE.jsonl` 与回执，先查现状再处理。

需要自行构建时，另在独立构建环境按 [发布脚本](RELEASE.md)从同一已审查提交生成完整发行输入。自定义内容不得冒充未修改的官方资产；`prepare` 只接受固定官方 Release，不提供任意包或下载 URL。网页仍只取已编译 `web/`，不要把资源根目录作为站点根。

版本目录、文件和链接由 root 管理；API 与 Nginx 仅读取。网站根目录只使用 `/opt/aster/current/web`。不要把完整源码、压缩包、数据库备份或 `/etc/aster` 放入可下载目录，也不要把版本目录递归改成面板 Web 用户所有。新前端与后端按同一提交一同发布；自定义前端构建不得继续使用官方包原有校验和声称内容未变。

## 3. MySQL、秘密与 systemd

复用已核实的 MySQL 实例，为应用建立独立 utf8mb4 数据库及运行、迁移、备份身份，具体 SQL 与权限见 [安装手册第 2 节](INSTALL.md#2-数据库与秘密)。面板自动创建的数据库用户可能拥有本库完整权限，不能直接当作 API 运行身份；运行账号只保留 SELECT、INSERT、UPDATE、DELETE，迁移凭据不交给 API。不要为此修改数据库 root 密码或开放远程访问。

按安装手册创建 `aster` 系统账号、受限秘密文件和 `/etc/aster/api.env`，设置真实 HTTPS `APP_ORIGIN`、`LISTEN_ADDR=127.0.0.1:18080`，保留禁用支付，SMTP 默认关闭；需要管理员测试发信时，按 [安装手册](INSTALL.md#可选smtp-加密密钥)准备专用密钥，再从独立 SMTP Release 按 [插件说明](PLUGINS.md)安装、选择、批准目的地、启用 systemd 服务并保存后台设置。本机 Unix socket 需显式设置 `MYSQL_ALLOW_INSECURE=true`；这只适用于已核实路径和权限的本地 socket，不能扩展到 TCP 明文连接。

使用包内 `deploy/systemd/aster-api.service`，按实际 MySQL service 名称调整启动顺序。执行迁移及管理员引导后再启动 API，完整命令见 [安装手册第 3–4 节](INSTALL.md#3-迁移与管理员)。API 仅由 systemd 管理，不再添加面板进程守护、定时重启或另一份后台启动命令。独立 SMTP 同样只由 `aster-smtp.service` 管理，不能由面板 Web 账号运行；创建 `aster-plugins` 组、API 附加组和不同的 `aster-smtp` UID，按插件手册保留全部加固。`/etc/aster` 为 root:root 0755 供 worker 读非秘密策略，其下 API 环境、secrets 和加密密钥保留受限权限。

SMTP 模板隐藏标准 `/run/mysqld` 和 `/var/lib/mysql`，宝塔实际 socket/数据目录可能不同。审核真实路径后在 **SMTP unit** 专用 drop-in 添加 `InaccessiblePaths=/actual/mysql.sock /actual/mysql-data`（替换为确认的真实路径），保留已有隐藏路径与加固；若 socket 路径由数据库重启替换也需复核。用 worker 身份和实际 service namespace 验证不可达，不能因模板有两个默认路径就声称面板数据库已隔离。该步骤不影响 API 自己所需的数据库连接。

**socket 在 `/tmp` 时的兼容处理：** unit 保留 `PrivateTmp=true`，因此 API 看不到主机的普通 `/tmp`。不要关闭隔离。确认真实 socket 的属主、权限和所有祖先目录后，可以在 `aster-api.service` 的专用 drop-in 中只映射该 socket：

```ini
[Service]
# 将 /actual/mysql.sock 替换为核实后的主机 socket 路径。
BindReadOnlyPaths=/actual/mysql.sock:/run/aster-mysql.sock
```

此时服务运行 DSN 使用 `unix(/run/aster-mysql.sock)`；在宿主机直接运行的只读 `-preflight` / `-schema-status`、迁移、管理员引导、备份和恢复仍使用原 socket。需要时为相同数据库身份单独准备宿主机 DSN 文件引用，不将服务 namespace 内的路径误用于宿主机 CLI，也不扩大数据库权限。映射不会授予数据库文件访问权。MySQL 重启可能替换 socket inode，必须随后重启 API 并检查就绪，不能据映射文件存在推定连接正常。若实际 systemd 不支持所需加固指令，先解决兼容性，不删除整段保护配置。

启动前按 [安装手册](INSTALL.md#3-迁移与管理员)执行只读数据库检查：`empty` 仅表示已存在专用库的基础表清单为空，其他对象须 DBA 核对；已识别旧前缀 `pending_migrations` 转升级流程；`current` 才表示当前 schema/结构通过，管理员数仍须核对。三种状态均可能退出 0，不能据此声称站点完成。检查核对直接 SELECT 元数据可见性并拒绝活动角色等不明授权，不证明运行身份仅有 DML、隐藏非表对象、插件运行或面板 TLS；运行身份和迁移/备份身份继续独立审查。

```sh
sudo systemd-analyze verify /etc/systemd/system/aster-api.service
sudo systemctl daemon-reload
sudo systemctl start aster-api
sudo systemctl status aster-api --no-pager
curl --fail --show-error http://127.0.0.1:18080/readyz
```

这里的回环 HTTP 只检查进程/数据库就绪，业务登录必须使用最终 HTTPS 域名。账号、秘密、迁移历史和数据库数据目录不通过面板网站上传或公开下载。

## 4. 网站、HTTPS 与 Nginx

在面板的网站管理中为该域名建立独立静态 HTML 站点，网站根目录设置为 `/opt/aster/current/web`。使用站点证书功能配置匹配域名的有效证书，并核对证书链、到期时间和续期方式；站点 HTTPS 与面板登录 HTTPS 是两项独立配置。宝塔的 [官方功能与更新说明](https://www.bt.cn/bbs/thread-19376-1-1.html) 包含 HTML 站点与 SSL 管理；界面布局可能随版本变化。

编辑**本应用站点**的 Nginx 配置，先保存原文件。保留面板生成的证书路径、ACME 验证目录、证书续期 include 和必要安全规则。不要将 `deploy/nginx.native.conf` 的整个多站点文件粘贴到面板站点中：其中 `http` 级日志格式与 `default_server` 需要全局规划，直接套用会与已有站点冲突。

在本域名的 HTTPS `server` 中合并以下配置，并处理已有重复的 `root`、`location /`、缓存和反向代理规则。`/api/` 只能有一套代理配置；不再通过面板新增覆盖全站 `/` 的第二套反向代理。

```nginx
root /opt/aster/current/web;
index index.html;
autoindex off;
client_max_body_size 64k;
server_tokens off;
# 本站点先不继承可能包含 query 的默认访问日志。
access_log off;
if ($host != billing.example.com) { return 444; }

# 证书、HTTPS 与续期方案确认可用后启用；只作用于本域名。
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy no-referrer always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;

location ^~ /api/ {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header Forwarded "";
    proxy_connect_timeout 5s;
    proxy_send_timeout 20s;
    proxy_read_timeout 30s;
    proxy_buffering off;
    proxy_cache off;
    proxy_hide_header Strict-Transport-Security;
}
location ~ ^/(healthz|readyz)$ {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header Forwarded "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_cache off;
    proxy_hide_header Strict-Transport-Security;
    access_log off;
}
location ^~ /assets/ { try_files $uri =404; expires 7d; }
location = /index.html { expires -1; }
location / { try_files $uri $uri/ /index.html; }
```

`proxy_pass` 保持无尾斜杠，保留 `/api/` 前缀；SPA 深层页面回退到 `index.html`，不存在的静态文件返回 404。两者语义见 [Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) 与 [try_files](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)。保留针对隐藏文件的拒绝规则，但不要拦截面板用于证书验证的 `/.well-known/` 路径。

该方案假定 Nginx 直接接收浏览器连接。检查面板或插件是否配置了全局 `real_ip_header` / `set_real_ip_from`，不要信任任意来源的转发头。API 只信任精确回环代理；增加 CDN/WAF/前置代理须另行设计可信链，不能直接扩大为所有私网。不要更改 Cookie 的 Secure/HttpOnly/SameSite 属性或缓存 API。

HTTP 站点只保留面板现有的证书挑战 location/include 和固定域名跳转，不在 HTTP 下提供登录/API。下面片段合并到**仅监听 80 的本域名 server**，用于替换该站已有的普通 `location /`；若面板把 80/443 放在同一个 server，先只为本应用拆分 HTTP 与 HTTPS，不能把这段放入共同的 HTTPS location。不要增加 `default_server` 或修改其他站点。

```nginx
access_log off;
# 保留面板现有的 ACME 挑战 location/include；它应优先处理验证路径。
location / { return 308 https://billing.example.com$request_uri; }
```

HTTPS 片段统一设置一年 HSTS，仅限当前域名，不添加 `includeSubDomains` 或 `preload`；代理位置隐藏上游同名头，避免重复。启用前确认真实证书与续期方案，不能用关闭浏览器证书验证来完成检查。

访问日志应使用不含 query、Cookie、Authorization 和请求体的专用格式；该 `log_format` 只能在 Nginx `http` 层声明。无法确认格式前，可仅对本应用站点关闭 `access_log`，保留受限错误日志及 API journal；不要变更其他站点的日志策略。

用**实际运行的宝塔 Nginx 二进制和配置**执行 `-t`，成功后通过其现有管理方式 reload；不要误测系统中另一份 `/usr/sbin/nginx`。重新打开面板站点设置后复核配置未被重写，确认已有站点仍正常。防篡改、WAF 或权限策略导致拒绝时检查对应规则，不以关闭整机保护作为修复。

## 5. 上线核验与更新

```sh
curl --fail --show-error https://billing.example.com/healthz
curl --fail --show-error https://billing.example.com/readyz
curl --fail --show-error --head https://billing.example.com/
```

仅在真实 HTTPS 就绪、证书与网页资源通过、首位管理员登录成功后，交付实际 `APP_ORIGIN` 对应的 `https://billing.example.com/` 入口。`prepared`、只读检查和一次 service start 均不构成完成上线。

核对浏览器证书可信、静态资源和 SPA 刷新、登录/注销、Cookie/CSRF、客户隔离、管理员设置及 运营者已配置币种的独立价格和历史格式快照。更改展示域名不会修改 `APP_ORIGIN`。API 和数据库不公开监听，支付保持禁用；未使用 SMTP 时不配置其加密密钥。SMTP 配置不依赖面板邮件插件，不安装或修改面板邮局服务；测试仅连接已获准且证书有效的 SMTP 目标。具体项目见 [验收范围](ACCEPTANCE.md)。

后台版本入口可检查官方 Release 并创建审计交接，见 [UPDATES.md](UPDATES.md)。它不调用面板 root、文件管理或进程守护接口，也不替换面板 Nginx/MySQL；主机工具完成核验与暂存后，仍由运维按下面流程应用，不能把后台“待运维处理”当作面板更新已经完成。

更新按 [升级与回滚](UPGRADE.md) 执行，顺序为：

1. 核对 Release 提交、校验和、数据库迁移及 API/前端兼容性；保留旧版本目录、面板站点配置和秘密引用。
2. 用已核验的新版 `core-manager.py prepare --version 0.5.1`（或实际候选明确版本）准备新的完整目录；在恢复副本验证迁移和业务，完成最终备份。备份使用实际 socket 和已核验当前版本路径的 `--release-directory`，保留脚本生成的 `BACKUP.json`，不手写 schema JSON。不要在线覆盖 `current/web` 或运行中的 API 文件。
3. 在维护窗口停写并停止 `aster-api`；使用**新版本明确路径**和迁移身份执行 `-migrate`，核对完整 schema 历史。
4. 原子切换 `current`，启动 API，检查 HTTPS 就绪及业务，再恢复流量。Nginx 配置未改变且没有持有旧文件的缓存策略时通常无需重载；核对本实例的 `open_file_cache` 等设置。配置有改变时，先使用正确实例执行配置检查。
5. 验证网页资源来自新版本，要求已有会话刷新页面；保存变更和恢复点记录，不长期混用旧前端与新 API。

若数据库未变化且旧版本兼容，可停服务后切回旧目录。迁移已提交时，不能只切回二进制或手改迁移记录；优先向前修复，必要时按 [备份恢复](BACKUP_RECOVERY.md) 恢复到隔离空库、核对数据并停写切换 DSN。面板“网站备份”不能代替数据库一致性、账号/秘密恢复或实际恢复演练；本项目备份脚本需使用与实例兼容的 MySQL 客户端及实际 socket。

SMTP 单独更新不上传新前端、不切换 `/opt/aster/current`，只安装独立兼容版本、按 revision 更新策略并重启 SMTP 服务，Core 文件和进程保持原样。失败按 [插件回退](PLUGINS.md#3-独立更新与回退)选择已有旧版本；不要删除凭据、重生成密钥或打开插件原始日志排障。

原生 CI 的历史基线已覆盖加固服务、私有测试 CA 的 HTTPS、API 重启、同 schema A→B→A 和同实例空库恢复。宝塔面板操作、公共 CA 续期、数据库进程/整机重启、独立实例灾备与生产容量仍需按部署环境分别验证，不能由一次 CI 成功推导。
