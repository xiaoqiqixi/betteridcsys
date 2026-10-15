# 原生 Linux 升级、数据库兼容与回滚

Core 0.5.2 的主机执行器在管理员核对私密规格、审查计划并确认精确 SHA-256 后，执行受支持单实例的停写、备份、schema 检查/迁移、Core 与网页切换、服务启动和 HTTPS 检查。网页不取得主机执行权。目标为 Ubuntu 24.04 / amd64、systemd、Nginx 与本机 MySQL 8.4；系统组件、DNS/证书及恢复方案仍由管理员准备。没有滚动升级、向下迁移或自动数据库恢复。历史候选与正式附件不重写，实际测试范围见 [VALIDATION.md](VALIDATION.md)。

升级前保留旧版本、源码提交、配置、秘密引用、插件策略/manifest、UID、完整数据库恢复点及备份时点。先按 [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)完成隔离恢复和业务检查；文件摘要/gzip/metadata 通过不证明数据库内容或业务可恢复。

## Core 0.5.2：财务数据与兼容边界

迁移 1–6 保持原始内容及 checksum；Core 0.5.0 引入的迁移 007 在 0.5.1/0.5.2 保持一致，当前为 14 张基础表。`currency_settings` 保存币种登记和价格 revision，订单/账单/服务保存币种格式快照，新订单另有套餐快照。旧 CNY/USD 按旧版已知精度回填；缺失的历史套餐规格不从当前套餐补造。

全新安装只有启用且默认的 CNY，示例报价不可售；升级保留旧 USD 报价、业务历史与合法默认值。不自动换汇或转换历史金额。已使用代码和精度锁定，停用须无未完成付款或服务义务，见 [财务模型](FINANCIAL_MODEL.md)。

MySQL DDL 隐式提交，整个迁移不能靠事务回滚。中断、超时或 CLI 返回失败都不能证明数据库未变。仅理解旧前缀的程序可能拒绝新 schema；不要删除新列/表、改 checksum 或强行忽略版本。程序回退只有在实际旧 schema 仍完整匹配且旧程序就绪通过时才允许，不自动导入备份。

## SMTP 与拆分发行的升级顺序

Core 0.5.2 使用六资产原始分发，SMTP 仍为独立 **1.1.0**、五资产及 `aster.smtp/1`，兼容 `>=0.4.0,<0.6.0`。SMTP 1.0.0 的上界为 `<0.5.0`，不能直接用于新 Core。先按 [PLUGINS.md](PLUGINS.md)独立核验、安装并批准兼容版本，或明确停用旧插件、停止 worker 并保留匹配恢复资料；不能伪造兼容范围。

升级计划核对受保护插件目录、实际策略、manifest/程序摘要和目标 Core 兼容区间；不要省略真实已配置插件来绕过。执行器不隐式更新/启用 SMTP、不重新生成加密密钥、不主动发送邮件。独立插件升级不要求重编 Core。旧 0.4.0 工具不认识 raw 分发，旧 0.5.0/0.5.1 校验器不会自动认识后续完整策略，首次使用 0.5.2 必须引导已核验新工具。

## 准备目标版本与既有实例

按 [安装手册第 1 节](INSTALL.md#1-核对来源与归档)核对 `v0.5.2` 的来源、六资产和新工具，使用明确版本准备新目录：

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-manager.py prepare --version 0.5.2
```

`prepare` 不停服、不迁移、不切链接；已有目标拒绝覆盖。候选必须为实例 `releases/` 下新的 root 保护完整目录，具有真实本地 `PREPARED.json`、匹配 BUILD 和完整文件摘要。`current` 必须是 root 管理、指向该实例已验证发行目录的链接；新版本须严格更新，已应用迁移前缀不得改动。

0.5.1 经官方准备器安装的既有实例，只有 unit 字节与受支持的原版模板或执行器模板完全匹配、并满足配置、权限、schema 和插件检查时才可接纳；这不表示任意手工 0.5.1 安装均已受支持。必须保留原始准备回执，`api.env` 只使用受支持的字面非秘密配置与文件引用，origin/listener 与规格一致；运行 DSN 和独立迁移 DSN 均精确选择同一本机 socket/数据库。unit/drop-in 或秘密引用不符合支持边界时停止调查，不覆盖旧配置、伪造回执或把升级伪装成全新安装。较早手工拼装、缺少来源回执或自定义拓扑须先制定并审查迁移方案。

使用现有运行身份及 unit，不重新建立首位管理员。迁移 DSN 与备份 client 文件须 root 所有、0600、单一硬链接、祖先受保护；迁移凭据在运行配置根之外。运行账号保持本库 DML，备份身份按 [备份权限说明](BACKUP_RECOVERY.md#范围与前提)提供元数据可见性。API 不获得迁移或 DBA 权限。

## 规格与精确计划确认

将升级规格保存为 root 私密普通文件，例如 `/root/aster-upgrade/upgrade.json`。通用字段与 [安装规格](INSTALL.md#3-迁移与管理员)一致，`action` 改为 `upgrade`；不带 `dba_client_config` 或任何 `bootstrap_*` 字段，改为：

| 字段 | 含义 |
|---|---|
| `migrator_dsn_file` | root 私密迁移 DSN，精确选择原数据库/socket，位于运行配置根之外 |
| `backup_client_config` | 本机专用备份账号的私密 `[client]` 文件 |
| `acknowledge_backup_restore_limits` | 必须明确设为 `true`：确认文件备份校验不等于隔离恢复，恢复准备由管理员负责 |

完整规格仍包含新 operation ID、候选目录、三个互不嵌套的根目录、原 runtime user/unit、origin/listener、`edge_listen_address`、MySQL/Nginx 真实程序路径及 Nginx 摘要、TLS 和 `edge_mode`。共享 Nginx 另提供原完整配置路径/摘要；维护门禁须预先纳入并审查，见 [BAOTA.md](BAOTA.md)。可选 `status_file` 只能是实例/配置/私密状态根之外的单独脱敏导出路径，并须与既有 `HOST_OPERATION_STATUS_FILE` 完全相同；需要新设引用时先独立审查配置和服务重启。升级不带仅适用于新安装的 `enable_at_boot` 字段。

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py plan \
  --spec /root/aster-upgrade/upgrade.json
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py apply \
  --spec /root/aster-upgrade/upgrade.json \
  --confirm-plan-sha256 REVIEWED_PLAN_SHA256
```

先审查本次完整计划，再手工使用实际 `plan_sha256` 确认；不要将计划输出自动传入 apply。计划固定当前/目标提交、文件、配置/秘密引用、插件和工具摘要，任一输入变化应重新判断。网页交接、下载成功、`prepared` 或暂存 `awaiting_host_operator` 都不代替此授权。

## 维护窗口内的实际流程

管理员先安排维护窗口、确认没有其他 API/客户端或外部作业继续写库，保存未完成订单及原幂等键。执行器的维护门禁只控制本站入口，不证明外部 SQL 写入者已停止；迁移期间还须禁止其他 DDL。

执行器持锁和持久 journal，启用本站维护门禁并核查 HTTPS 拒绝业务请求，停止 API并确认状态；随后创建新私密备份，检查 gzip、摘要、来源版本/提交、metadata 和实际迁移前缀。备份基于已验证旧版本，不能拿候选 BUILD 冒充备份来源。它不声称自动完成隔离恢复，不向运行库导入 SQL。

备份和兼容门禁通过后，用候选明确二进制与独立身份检查/迁移 schema，再用运行配置核对 `current`、checksum 和已有管理员，原子切换同提交 API/网页，启动服务并检查实际 HTTPS 就绪、TLS/主机名及静态网页资源。成功后撤除本站维护门禁；管理员仍须登录和完成业务验收。unit、Nginx 或插件变更不授权修改其他站点/服务。

## 检查点与恢复执行

```sh
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py status \
  --state-directory /var/lib/aster-operations --operation-id ACTUAL_OPERATION_ID
sudo python3 /var/lib/aster-bootstrap/0.5.2/core-operation.py resume \
  --spec /root/aster-upgrade/upgrade.json \
  --confirm-plan-sha256 ORIGINAL_REVIEWED_PLAN_SHA256
```

先读状态和 root 私密 `PLAN.json`、`JOURNAL.json`，再决定恢复。`resume` 只接受原规格、原 ID、原确认摘要，并重新核验受保护输入及检查点；不盲目重放不确定的迁移/引导或覆盖已有请求。超时、断电或日志同步失败时，服务、链接或数据库可能已变化；保留现场，不删除 journal、手改状态或另建 ID 重跑。

公开状态 `needs_manual_recovery`（私密 journal 为 `recovery_required`）表示尚需调查，并不表示什么都没执行。若工具核实实际旧 schema 仍完全匹配，可恢复旧程序链接并验证旧程序就绪，状态为 `rolled_back`；维护门禁保持，业务检查和恢复流量由管理员进一步确认。旧 schema 不兼容、状态不明或就绪失败时阻止程序回退，保留维护状态。没有将 SQL 自动导入旧库或删除新对象的路径。

## 失败后的判断

**数据库实际未变且旧程序兼容**：核对 journal、链接、schema 和服务实际状态，再按已审查方案恢复旧程序。不能只因命令失败就推断可回退。

**数据库已经变化或无法证明未变**：优先保留现场并向前修复；旧二进制可能拒绝启动，不手改迁移记录或强行降级。

**确需恢复数据库**：停写并保存失败现场和当前数据副本，确认恢复点之后所有写入及可能损失，由负责人员批准。按 [备份恢复](BACKUP_RECOVERY.md)在隔离的新空库恢复并验证，再于维护窗口更换受限 DSN、启动匹配程序并验收。禁止向运行库直接导入、`DROP DATABASE` 或删除数据目录作为快捷回退。

恢复流量前检查真实 HTTPS 入口、管理员登录、两种语言、各启用币种独立报价、历史账单金额/格式、幂等与权限、支付失败关闭。记录实际提交、schema/checksum、插件、备份时点和观察结果。历史 CI 的 A → B → A 使用同源码/同 schema，只证明当时的目录切换和数据保留；不推导跨版本迁移、数据库降级、公共 CA 续期或整机恢复已通过。
