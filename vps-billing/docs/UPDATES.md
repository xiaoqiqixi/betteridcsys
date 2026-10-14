# 后台版本更新与主机运维交接

后台“版本更新”面向管理员：显示当前 Core 与已批准的 SMTP 选择，主动查询固定官方 `xiaoqiqixi/betteridcsys` 仓库的正常 Release、版本、说明和兼容条件，然后明确生成有审计的更新交接单。当前模式是 `manual_host_handoff`，不提供网页直接安装或 root 执行。HTTP权限/请求结构见 [CONTRACT.md](CONTRACT.md#管理员版本更新)。

“当前 SMTP 版本”来自本地批准策略，不能证明实际服务正在运行；兼容和可更新判断也不等于数据库迁移、恢复或运营验收已完成。没有结果时显示未检查/不可用，不能把上次缓存当作最新发布。Core/SMTP 的独立版本与正式附件见 [RELEASE.md](RELEASE.md)。

## 版本格式边界

本页新拆分分发流程由 Core 0.5.0 提供，兼容读取旧归档。**已发布 Core 0.4.0 的网页和工具仅理解旧四资产归档**，不能直接生成新 Core 0.5.0 / SMTP 1.1.0 原始程序分发的有效交接，后台也不会自动更新自己的格式支持。

从 0.4.0 首次迁入新格式，需一次人工核验下载，按 [安装](INSTALL.md)和 [升级](UPGRADE.md)组装程序与资源；若先桥接 SMTP 1.1.0，使用已验证的新资源中的插件管理工具，并明确传真实 `--core-version 0.4.0`。新版 stage 虽能核对旧当前版本参数，也不凭空产生合法交接；不要手改旧交接 JSON 或伪造版本来绕过格式边界。完成新 Core 安装后才使用下面的新格式网页交接。

## 管理员操作

1. 管理员进入“版本更新”，明确点击“检查官方更新”。程序只查询固定仓库，不接受下载 URL、镜像、GitHub token、命令或安装目录输入。
2. 核对组件、当前/候选版本、公开 Release 来源、源码提交、纯文本更新说明、兼容信息与前置条件。候选仅来自正常、非草稿、非预发布的 Core `vX.Y.Z` / SMTP `smtp-vX.Y.Z`；缺资产/来源、不兼容或不是新版本时不得交接。
3. 选择候选并明确确认由主机运维执行检查、备份和安装，点击“生成更新交接单”。服务端重新检查官方信息和本地状态，先保存审计再返回 JSON；选择已变化、查询失败或审计失败不得显示成功。
4. 下载交接 JSON，交给获准主机运维。状态 `awaiting_host_operator` 表示“待运维处理，未开始安装”，不代表后台已下载、解压、迁移、切换或重启。交接有效期30分钟；过期或现场状态改变时重新检查并明确生成，不盲目重复提交。

网页不取得 root、sudo、运行目录写权限或服务管理能力。API 只查询发布信息和生成交接，不能通过安装插件或“更新”入口执行文件。交接JSON未签名，运维须核对来源与审计，并明确授权自己的主机操作，不能仅凭JSON标识执行安装。网络断开/返回结果不确定时先核对审计与交接记录，原交接可能已经审计，不把未知结果改成成功或自动再次安装。

私有仓库或API访问策略需要只读凭据时，API使用主机受保护的 `UPDATE_RELEASE_TOKEN_FILE` 引用；值只由获准秘密管理途径提供，不从网页输入、不自动创建。API文件无软/硬链接、仅owner可读，建议在 `/etc/aster/secrets/` 以 aster:aster 0400保存，父目录保持root控制；不能使用其他DSN文件的0640模式。引用变更需明确重启API，无效私密文件会拒绝启动。没有访问权限、被限流或官方来源无法核实时显示不可用，不把失败改成“已是最新”。主机暂存工具的token-file是另一独立root秘密引用，不从Web取得API秘密。

## 运维核验与暂存

主机工具 `deploy/scripts/update-manager.py` 随 Core 资源交付，仅提供 `stage/status`，没有 `apply` 命令。新后台对两种分发统一生成 schema 2 交接，以 `distribution_format` 区分 raw-binaries-v1 与 archive-v1；raw BUILD 为 schema 3。既有 schema 1 交接仍可读取，但只适用于旧四资产布局。`stage`：从固定官方渠道独立核对交接、仓库身份、稳定标签/源码、资产清单/摘要、BUILD/PROVENANCE、成功构建来源与归档内容，再下载到受限暂存目录。它**不安装、不执行新程序、不运行备份、不迁移、不改 current 链接、不管理 systemd**。不能将 `stage` 返回成功当作更新已应用。

操作前确认主机的真实版本、已批准插件版本、策略 revision 和数据库 schema。Core 当前版本参数必须与已验证的运行文件对应，不能为通过检查随意填写。交接文件包含内部操作者/请求标识，不是公开附件；通过受控途径放入 root 所有、0600、无链接的规范绝对路径，所有祖先目录受保护。状态目录由 root 管理，0700，不能在网页、共享目录或可写程序目录内。

以下示例用于已经安装 Core 0.5.0 / 已选 SMTP 1.1.0 后，确有新候选且通过后台生成了有效交接的场景；参数必须换成实际现场版本，不表示当前已有后续可安装版本。

以下路径为安装基线示例；首次建立状态目录前确认未复用其他应用目录，已有目录先检查属主/权限和历史 journal。交接从后台下载并经受控途径保存为真实路径，`REQUEST_ID` 必须替换：

```sh
sudo install -d -o root -g root -m 0700 /var/lib/aster-updates
sudo python3 /path/to/verified-new-resources/deploy/scripts/update-manager.py stage \
  --handoff /root/aster-update-REQUEST_ID.json \
  --state-directory /var/lib/aster-updates \
  --current-core-version 0.5.0 \
  --current-plugin-version 1.1.0
```

主机工具不会信任网页提供的摘要或“兼容”标志作为最终许可，而是独立核对固定官方来源、声明分发类型的精确资产集合与结构（新 Core 六项、SMTP 五项；旧归档四项）。来源校验依赖官方 TLS/仓库和未签名元数据，**不是独立密码学发行签名**；仓库/发行权限失陷仍是信任风险，不宣称 SLSA 或防恶意发布者认证。

同一状态目录使用锁限制并发，按请求标识记录不可覆盖的暂存文件与持久操作日志。状态保存在 `/var/lib/aster-updates/REQUEST_ID/JOURNAL.json`，资产同目录、root私密，**没有解压/安装到运行目录**。出现已有请求、文件/摘要冲突、过期、网络/权限错误时停止并保留真实状态，不删除 journal 后重复请求或覆盖旧文件。备份证据验证失败会记为 `rejected`，此前已核验的归档可能保留，不能据文件存在判定成功。该工具不支持自动回滚、自动切换或断点后的任意补执行。

可只读核对本机检查点，命令对已验证状态还会重核暂存资产摘要，输出始终说明没有应用：

```sh
sudo python3 /path/to/verified-new-resources/deploy/scripts/update-manager.py status \
  --state-directory /var/lib/aster-updates --request-id REQUEST_ID
```

私有仓库可能需要独立的只读 GitHub 凭据。来源核验读取本库 Contents（标签/Release/资产）和 Actions（构建运行）；凭据应只授权这些必要读取，不能赋予发行或仓库写权限。只有确实需要且已经由获准秘密管理途径提供时，追加 `--github-token-file /root/aster-github-read-token`，使用受限 root 普通文件；不要写入参数值、环境变量、网页或日志，不为此创建长期高权限凭据。无访问权限/受限 API 返回拒绝时报告不可用，不能关闭 TLS 或改成未知镜像绕过。

## 备份、前置条件与实际应用

Core 暂存完成但没有提供备份时，状态为 `backup_required`，仍未安装。首次stage若要携带已有备份证据，以下三个参数必须同时提供；不能在已有请求目录上补写或覆盖：

```sh
  --backup /var/backups/aster/VERIFIED_BACKUP/database.sql.gz \
  --backup-sha256 VERIFIED_BACKUP_SHA256 \
  --backup-metadata /root/aster-backup-schema.json
```

上面是追加参数，不是单独可执行命令。备份与metadata都须root受控的私密普通文件；由独立非root备份身份产生时保留原恢复点，只将经过核对的运维副本放到root保护路径，不递归更改原备份目录所有权。metadata由运维根据当前部署和备份记录提供，准确含 `schema:1`、source_commit、core_version、database、schema_version，以及 `migration_checksums` 的完整 `"1"` 到当前版本编号和真实64位SHA值；不得编造历史或仅复制候选版本数据。

工具核对文件SHA-256/gzip稳定性、metadata结构和当前Core版本，只记录所提供schema/checksum，不查询或证明SQL内容、真实数据库一致性、空库恢复或足够RPO/RTO；结果明确 `database_contents_verified=false`、`isolated_restore_verified=false`。工具不生成备份。操作备份前后按 [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)留存演练与时点，不能为通过门禁提供任意gzip、复制校验值或绕过恢复准备。没有备份的既有检查点仍保持backup_required；准备后重新核对新交接，保留旧记录，不伪造状态。

Core 没有备份时为 `backup_required`。提供有效文件备份证据且 `--current-plugin-version` 非空时为 `compatibility_review_required`，并记录 `installed_plugin_compatibility_verified=false`：工具没有独立读取本机审批 manifest 的兼容区间，不能相信未签名交接中的区间，不能省略真实已选插件参数来绕过检查。

运维需独立核对真实 root 策略 revision、manifest/程序哈希、UID/socket、`core_min/core_max_exclusive` 与协议，确认适用于目标 Core；或按经审查的方案明确停用不兼容插件并保留恢复路径。此工具不提供把检查点强行改为 ready/applied 的动作。SMTP 更新，或没有已选插件约束且文件备份校验通过的 Core，状态为 `awaiting_host_operator`。这仍只是等待主机运维：需进一步检查维护窗口、schema/checksum、恢复点、配置/unit差异、权限、磁盘与当前请求，确认交接仍适用，再按组件处理：

- **Core**：按 [UPGRADE.md](UPGRADE.md)停写、独立迁移、同提交 API/网页版本切换、就绪与业务检查。尚未证明的自动跨 schema安装/迁移/降级不支持，没有向下迁移；不能因暂存成功就运行未经核对的新程序。
- **SMTP**：按 [PLUGINS.md](PLUGINS.md)分别验证原始程序和资源并安装新版本，CAS选择/明确启用/重启插件；保留旧版本及在途结果处理。只暂存不改变插件审批，也不会重启 Core。

网页不自动回收 root 操作结果或推断安装成功。完成手工应用后重新检查实际运行版本、Core/插件健康与业务并记录证据；应用前后状态、失败现场和回退决定由运维记录。不同机器或不兼容 schema 的结果不能沿用到当前主机。

## 故障与验证范围

官方查询失败、凭据/限流/网络拒绝、不完整来源或资产、候选变化、审批冲突、过期交接、已有暂存请求都应显示明确失败/待处理；禁止假成功、自动重发或扩大权限。运维暂存状态与真实程序应用相互独立，恢复须先判断已经执行了什么，再按 [UPGRADE.md](UPGRADE.md)处理数据库/程序兼容。

当前云端测试与上线限制以 [VALIDATION.md](VALIDATION.md)的对应源码和实际 run 为准。没有新增 CI 证据不能填写通过；合成发布/离线归档测试不证明用户主机更新、真实公共域名、整机恢复或跨版本迁移已验收。

工具有明确输入界限：交接32KiB，资源归档压缩80MiB/展开160MiB、单文件及原始程序64MiB，备份压缩256MiB/展开2GiB、metadata16KiB。超限或不支持的归档/布局停止，不通过增加临时参数或解压执行绕过；需要维护方修改并验证支持范围。
