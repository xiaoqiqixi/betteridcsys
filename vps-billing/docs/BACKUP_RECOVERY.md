# 原生单机备份与隔离恢复

本文面向 Linux amd64 单机原生部署：systemd 管理 API、nginx 提供 HTTPS、MySQL 8.4 位于同一主机。备份通过本机 Unix socket 读取数据库，不依赖容器。单机不等于高可用；本文不承诺 RPO、RTO 或 SLA，恢复时间和可接受数据损失必须通过目标环境演练确定。

本项目提供逻辑备份脚本与人工恢复步骤，没有自动计划任务、加密、异地复制、保留清理、binlog/PITR 或自动灾备切换。历史容器内 MySQL 恢复记录属于数据库测试证据，不证明原生 MySQL、systemd、nginx 或主机重启后的恢复能力已经验收。

## 范围与前提

`deploy/scripts/backup-native.sh` 用于本项目当前的 **InnoDB 基础表**：客户、会话、套餐与独立币种价格、订单、账单、设置、幂等请求、审计、outbox、迁移记录。它不是通用 MySQL 全实例备份工具，不备份系统账号、权限、其他库、服务器配置、日志或秘密。

脚本在导出前读取 `information_schema`，发现视图、非 InnoDB 表、触发器、例程或事件就停止；随后明确跳过这些对象。这样不会默默把已检测到的自定义对象漏出备份范围。**元数据可见性取决于账号权限**：DBA 必须先核对备份账号的 grants，并将可见对象清单与经授权的完整 schema 清单比较。看不见的对象可能无法被此检查发现，查询返回 0 不能代替权限审查。自定义数据库对象需另行设计、验证完整备份方案后才能使用。

备份账号独立于 API 与迁移身份。按实际 MySQL 版本审查本库的 SELECT、SHOW VIEW、TRIGGER、EVENT 及全局 SHOW_ROUTINE 元数据可见权限；这些权限用于完整识别对象，不把备份凭据交给 API，也不默认使用 root。若不接受所需元数据权限，就停止此流程并采用经 DBA 审查的替代备份方案。脚本不会创建账号或授予权限。

导出使用 `--single-transaction --quick`。备份期间禁止迁移和其他 DDL；所有业务表必须是 InnoDB。它不保证跨库、外部系统或文件的一致性。相关选项与权限要求见 [MySQL 8.4 mysqldump 官方说明](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)。

发布包、源码提交、配置版本、TLS 证书和必要秘密另行加密备份，保证能恢复对应版本。不要把数据库备份、凭据或秘密引用清单上传到 Git、Release、网页根目录或普通日志。

## 准备私密凭据与目录

需要 Bash、GNU coreutils、gzip、与服务器兼容的 MySQL 8.4 `mysql`/`mysqldump`。使用受控系统 PATH，不从当前目录或可被其他用户修改的目录加载命令。

由管理员预先准备专用备份操作身份及两个目录，例如 `/etc/aster-backup/`、`/var/backups/aster/`；后者必须已经存在、归执行脚本的账号所有、权限为 0700。脚本不创建输出根目录，不调整现有目录权限，也不删除旧备份。目录及其祖先必须受可信管理员控制，不能让其他用户替换路径。

凭据文件例如 `/etc/aster-backup/client.cnf`，必须是执行账号所有的普通文件、0400 或 0600、无符号链接或额外硬链接，所有祖先目录必须归执行账号或 root 所有且不可被组或其他用户写入；仅对 root 所有的 sticky 目录（例如 /tmp）允许受保护的私密子目录。不要复用 API 的 DSN 文件。

凭据文件仅允许：

- 一个 `[client]` section。
- 一个 `user=` 项：实际已创建的备份账号，1–32 个 ASCII 字母、数字、下划线、点或连字符，首字符不为点或连字符，不加引号。
- 可选的 `password=` 项：从批准的秘密管理途径写入真实密码，遵循 MySQL option-file 的引号和转义规则；使用经审查的本地认证方式时可省略。
- 空行和以 `#` 或 `;` 开头的独立注释行。

不支持 include、其他 section、重复选项或 `host`、`socket`、`force`、`init-command` 等附加项。socket 由脚本参数明确指定，传输固定为 SOCKET；脚本将 `--defaults-file` 放在客户端第一个参数，禁用 login-path，清除相关 MySQL 环境变量。密码不会进入命令行或归档。不要使用 `bash -x`、打印凭据文件或把含秘密的诊断粘贴到公共日志。

## 创建与检查备份

核对来源库名、socket 和备份账号后，由备份操作身份执行。另行核对 socket 及其父目录归获批准的 MySQL 服务身份管理，其他用户不能替换；脚本不会把 mysql 所有的正常 socket 路径误判为必须归备份账号所有，也不替代此目标核对。下列路径和 `aster` 是需要按已批准环境核实的示例，不会自动安装或启动任何服务：

```sh
/path/to/release/deploy/scripts/backup-native.sh \
  --client-config /etc/aster-backup/client.cnf \
  --socket /run/mysqld/mysqld.sock \
  --database aster \
  --output-dir /var/backups/aster
```

库名只允许 1–64 个 ASCII 字母、数字和下划线，首字符为字母或下划线；系统库不允许导出。脚本只连接本机 socket，不能用于远端数据库。所有路径必须为绝对路径。

每次执行创建一个新的私密目录，例如：

```text
aster-aster-20261014T000000Z-RANDOM/
  database.sql.gz
  BACKUP.txt
  SHA256SUMS
```

时间加随机后缀区分同秒并发执行。临时目录内完成导出、压缩检查和校验和检查后，整个目录在同一文件系统中原子发布；目标已存在则拒绝覆盖。正常错误或可捕获信号会清理本次临时目录，不触碰已有备份。断电、SIGKILL、磁盘或文件系统故障仍可能留下 `.partial` 目录；它们不是已完成备份，应保留现场后人工检查，不得据文件存在推定成功。原子可见性也不等于断电持久性保证。

所有备份目录为 0700，文件为 0600。SQL、配置或数据库诊断不会输出到控制台；成功时的 mysqldump 警告仅记录 `dump_warnings=yes`，原始 stderr 不发布。如果出现警告，应通过受控的私密诊断核实原因后再接受该恢复点。

将整个目录复制到受限离机位置后，从该目录验证。校验清单只含 basename，移动目录后仍有效：

```sh
cd /private/copied-backup/aster-aster-TIMESTAMP-RANDOM
sha256sum --check SHA256SUMS
gzip -t database.sql.gz
```

归档是**未加密的敏感数据**，包含会话状态和客户资料。按运营策略尽快加密、异地复制，并验证解密和密钥恢复方法。SHA-256 与 gzip 检查不证明来源可信，也不证明业务可恢复；同一主机或同一磁盘的副本不能承担主机故障时的恢复责任。不要在共享终端直接输出解压后的 SQL。

## 手工隔离恢复：先核实目标，再导入

这里不提供自动覆盖数据库的恢复脚本。恢复只允许导入可信、已核验的 SQL；SQL 本身能够执行操作，路径、校验和与文件名不是安全沙箱。

1. 保存备份来源提交、schema 版本、MySQL 版本、备份时点、文件大小与 SHA-256；记录演练负责人及开始时间。
2. 准备独立的原生 MySQL 测试实例，使用独立数据目录、socket 和端口，不对外公开，不复用运行实例的数据目录。由 DBA 创建全新的空恢复库及仅限该库的恢复身份；关闭测试实例的 event scheduler。仅使用同一实例的新库时，需要额外核实权限边界和资源影响，不能将其等同于完整实例隔离。
3. 单独准备恢复身份的 0600 `client.cnf`；只含 `[client]` 的 user/password。实例管理员先完成建库、授权和对象清单核对。恢复身份不应拥有运行库、系统库或其他库的写权限。
4. 对照来源记录确认新目标的服务器标识、socket、库名与运行目标不同。使用人工核对的恢复账号执行只读检查；出现错误或不匹配立即停止。

```sh
# 路径和库名均为示例，先换成已准备的隔离目标。
# --defaults-file 必须放在第一个参数；不要加入 --force。
mysql --defaults-file=/private/restore/client.cnf --no-login-paths \
  --protocol=SOCKET --socket=/run/mysqld-restore/mysqld.sock \
  --batch --database=aster_restore_review \
  --execute='SELECT @@hostname, @@port, @@socket, @@server_uuid, VERSION(), CURRENT_USER(), DATABASE(); SELECT COUNT(*) AS existing_objects FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE();'
```

`existing_objects` 必须为 0，同时由 DBA 确认没有例程、触发器、事件等既有对象，恢复目标已停止其他写入。确认恢复身份的元数据权限足够，不以权限不足造成的“空清单”当作空库证据。若已有任何对象，另建新的空库，不删除或覆盖未知数据。

5. 从已检查的备份目录执行导入，保持 `pipefail`。当前脚本导出不生成来源库的 CREATE DATABASE/USE，且禁用 DROP TABLE；这些选项不能代替目标核对或 SQL 来源审查。其他历史导出文件可能含 DROP、USE、库限定名称或任意 SQL，不能直接套用此流程。

```sh
set -euo pipefail
cd /private/copied-backup/aster-aster-TIMESTAMP-RANDOM
sha256sum --check SHA256SUMS
gzip -t database.sql.gz
# 此命令会向已确认的空恢复库写入数据；不能指向运行库。
gzip -dc database.sql.gz | \
  mysql --defaults-file=/private/restore/client.cnf --no-login-paths \
    --protocol=SOCKET --socket=/run/mysqld-restore/mysqld.sock \
    --database=aster_restore_review
```

导入中断可能留下部分对象，SQL 恢复并非整体事务。不要用 `--force` 忽略错误或向部分恢复库反复导入；保留诊断，重新准备另一空目标再执行。不要通过 DROP 运行库或覆盖其文件来“修复”恢复失败。

## 数据校验与切换门禁

先用与备份匹配的二进制检查副本，不要立即执行新版本迁移。测试 API 使用单独配置和端口，DSN 只指向恢复库；支付和邮件仍为 `payment.disabled` / `email.disabled`，不连接真实控制器。恢复出的会话也属于敏感数据，测试站点不能公开。

至少检查：

1. `schema_migrations` 编号和 checksum 与来源提交一致；对象清单、表计数、关键记录与备份时的受控清单一致。
2. 客户、订单、账单之间的关联正确；CNY/USD 按各自币种分别核对，不能相加。历史金额、币种、开具方快照没有被当前设置重写。
3. 原幂等键能返回原订单，冲突请求仍拒绝，不新增重复订单、账单、审计或 outbox。
4. 两个客户的资源隔离、管理员权限、设置版本冲突、CSRF、无效或过期会话、禁用支付均符合预期。
5. 在副本执行升级与重复迁移并核对新功能；API 运行身份无法 CREATE、DROP、ALTER 或 GRANT。

文件检查、SQL 导入成功、业务校验、原生服务开机恢复是不同证据。最后还需在目标测试机验证 MySQL/systemd/nginx 的启动顺序、权限、HTTPS、断电或重启后的服务恢复、备份定时任务与失败告警；本次 fakebin 测试不覆盖这些项目。实际完成范围见 [验证记录](VALIDATION.md)。

正式切换需要单独的停写窗口与批准：保存失败现场及当前数据副本，确认恢复点之后全部写入的处置方式，审查会话是否需要统一失效，再按 [升级与回滚](UPGRADE.md) 更换受控 DSN。不能把一次恢复测试视为自动切换授权。

## 定期执行、保留与演练证据

在首次真实备份与隔离恢复验收后，再由管理员配置受控的 systemd timer 或其他调度，并为失败、缺失恢复点、磁盘不足与离机复制失败建立告警。脚本本身不会安装或启用计划任务，也不负责自动清理。

保留策略应根据业务写入频率、容量与恢复要求确定。删除前确认近期恢复点已实际演练且存在可解密的异地副本；不要让新的未验证备份替换唯一已知可恢复副本。记录恢复结束时间、实际耗时、数据检查结果、未通过项和后续行动，用演练结果确定目标 RPO/RTO。

源码附带 `deploy/scripts/test-backup-native.sh`：使用 fakebin 内的模拟 mysql/mysqldump，并将系统根目录属主建模为标准 root（私密文件和下层目录权限使用真实临时文件系统检查），验证并发目录、原子不覆盖、私密权限、配置约束、元数据失败、dump/gzip/checksum 失败与可移动校验和。它不连接数据库、不创建真实账号、不启动服务。当前版本仅提供原生部署备份流程。
