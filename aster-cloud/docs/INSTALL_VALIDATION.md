# 主控 / KVM 被控安装器验证边界

本页记录安装器安全回归的范围，**不是正式发行或整机安装验收声明**。
当前没有已发布的 cloud 正式 release。开发候选包、Python 合成载荷、mock
runner 或文件系统单测均不能称为真实主控 / KVM 安装、升级、恢复通过。

## 本地安全回归

仓库根目录运行：

```sh
python3 aster-cloud/deploy/ci/test_cloud_installer.py
```

测试只在 `tempfile.TemporaryDirectory` 内构造**合成** tar.gz、manifest
和输入文件。所有凭据字符串均为测试标记，不读取用户真实凭据。测试进程
禁止实际 `subprocess.run` 和网络连接；个别系统边界通过 Python `unittest.mock` 替换，
不会执行 sudo、apt、systemctl、网络配置、虚拟机命令或远程操作。
固定生产路径的节点 fixture 在测试进程内映射至临时文件；没有创建真实
`/etc/aster-node` 或 `/var/lib/aster-*`。此映射不在生产 CLI 中暴露。
生产 CLI 不提供 root-prefix、任意 runner、跳过 TLS 或绕过所有权的测试开关。

回归核对的公开边界：

- `verify_bundle`：只读验证外部 SHA256 和 manifest 中每个文件的 SHA256、
  大小、权限、角色与平台，不执行包内程序；库存与包成员必须完整对应。
- 恶意归档：拒绝绝对路径、目录穿越、反斜线 / 非规范路径、PAX 路径穿越、
  软链接、硬链接、目录及设备/FIFO等特殊项、重复成员、重复 / 非法 manifest、
  缺失 / 多余文件和超限输入。上界用测试进程内的常量替换触发，不分配巨型包。
- 哈希 / 解包竞争：完整外部 SHA 完成后替换源路径，或原 inode 写入另一份
  同大小合法包并恢复 mtime，均只能拒绝或返回原先已哈希的字节。
  PAX / GNU 元数据声明在读取载荷前被拒绝，避免 stdlib tar 迭代器提前分配。
- `make_plan` / `execute` 的默认 plan 和 dry-run：非 root 可读、无安装写入、
  不执行宿主命令、不将开发候选包伪装为正式 release。
- apply：非 root 必须拒绝；具体私有审批、已有 / 部分安装、未就绪节点和
  故障恢复结果以实际测试项为准，不能从 plan 的通过推断 apply 已经安全完成。
- 配置 / 恢复：已有配置与 unit 不同即拒绝；部分 init seed 的 token 保留，
  不重写 init 原配置；重复安装、换包或改变向导意图不得默默恢复。
  当前 schema 仅运行 runtime check；需要迁移时必须同一专用数据库、不同
  非 root 本机账号的独立迁移 DSN，并以单独 0600 配置执行，不能写进 serve unit。
- 节点：未就绪 preflight / doctor 不启动；qemu-img info / check 使用固定参数，
  没有修复 `-r`，拒绝 raw、backing、external-data、encrypted 和畸形信息。
  自身 TLS、镜像、state/storage/artifact/inbox 限于固定 unit 可见目录。
- 控制面身份：节点审批即使显式提供 controller client cert/key 也拒绝，
  向导不采集此身份。节点只有本机 doctor / systemd active / TCP listener
  检查，结果必须为 `node_started_pending_controller` / `active-unadmitted`。
  **这不是 mTLS 健康探针，也不是已加入主控**；真实 mTLS 核对必须从主控端
  使用仅保留在主控端的 client 私钥执行。主控 TLS 健康失败则不 enable 服务。
- 可选原生依赖 / MySQL：默认关闭，带 opt-in 的 plan 仍不执行命令或生成秘密。
  测试核对固定包列表、独立 HTTPS Ubuntu signed-by 源、禁升级 / 移除、拒绝
  网络 daemon 模拟计划、临时 policy 的独占创建与 inode/内容绑定删除、失败后
  显式原计划恢复。已有 policy、MySQL 配置、数据或 drop-in 均拒绝覆盖。
  **节点依赖列表没有 libvirt daemon/default network**，不能称为干净节点端到端安装。
- 数据库 bootstrap：只允许本机 root Unix socket 的一次性管理操作；实际 runtime
  必须是新建的非 root DML 身份，迁移为另一个非 root DDL 身份。测试核对 SQL
  仅走 stdin、client 不读 `/root` login-path、不继承密码环境变量；MySQL 生成随机
  密码的回包只写入 0600 DSN，不进入 SQL、argv、结果输出或日志。
  外来数据库、任一目标账号碰撞、异常隐式角色 / grant 语义均在创建前拒绝。
  恢复需要原 server UUID / names / nonce；CREATE 丢回包且凭据未落盘时保留
  数据库与账号，不自动 reset / recreate / adopt。runtime grants 仅四项 DML，
  拒绝 global、额外 DDL、role、GRANT OPTION 和未转义数据库 wildcard。
- 新 MySQL 仅依据本操作的 fresh receipt 和 exact socket-only drop-in 启动；
  classic TCP 与 MySQL X 都须关闭。服务启动丢回包也按可能已启动处理，尝试
  停止本操作的精确 unit，不写成“从未启动”，不 enable / 宣称 ready。

测试中的文件内容、模式和拒绝断言不能证明真实 TLS 证书链、MySQL 账户隔离、
KVM 设备权限、systemd sandbox 或宿主网络已正确配置。安装器不应重新生成、
覆盖或输出未知 / 部分安装的已有密钥、DSN、token、配置、journal 或 fence。

APT 包的 maintainer scripts 通常会管理服务生命周期；临时 policy 只能约束
遵循该机制的调用，并非所有包脚本无副作用的证明。原理参见
[Debian 服务策略](https://www.debian.org/doc/debian-policy/ch-opersys.html#running-init-scripts)
及 [invoke-rc.d policy](https://manpages.debian.org/trixie/init-system-helpers/invoke-rc.d.8.en.html)。
MySQL 的 `--no-login-paths` 是 8.2 才新增，不能盲用于 Ubuntu 的 8.0 client；
当前代码使用私有 HOME / login-path 隔离，仍需目标主机实测。
参见 [MySQL 官方说明](https://dev.mysql.com/blog-archive/new-client-option-no-login-paths-turn-off-login-path-file-processing/)。

## 必须另外执行的验收

正式使用前仍需在专用、可销毁的 Ubuntu 22.04 / 24.04 amd64 主机分别验证：

1. 来源可核验的正式 release、独立取得的校验和、版本与构建 provenance。
   外部 SHA 能发现传输变更，但不能单独证明发布者身份。
2. 干净主机安装、故障中断后的人工核对、重复安装拒绝、配套升级、备份与
   数据库 / journal / 制品一致性恢复。不能只换旧 binary 或删新表降级。
3. 真实 APT 事务、维护脚本 autostart/默认网络边界、policy 中断恢复与所有权；
   独立 MySQL CREATE USER 随机密码回包、SHOW GRANTS 的真实字节 / wildcard
   语义、owner marker 与 Go migration/check 兼容性，及原生 socket-only 服务。
   主控独立 MySQL / schema、runtime DML-only 与独立迁移 DDL 账号的真实 grants、
   受保护配置与文件所有权、有效 HTTPS 链、
   真实会话和 CSRF、首管理员私密 stdin 初始化、服务重启及日志脱敏。
4. KVM 被控的 `/dev/kvm`、libvirt、镜像 / 存储 / bridge / filter / IP 池、
   明确 root 审批的双向 mTLS 与叶证书 pin、资源能力和维护状态。
   未就绪时必须保持不启动，不把“软件装好”说成“节点上线”。
5. 真实 VM 创建 / 关机 / 恢复 / 冷迁移、网络隔离、公网上联、跨宿主包流、
   故障注入与重启恢复。真实 KVM 验收仍为后置步骤。

既有真实 MySQL / 严格 TLS 浏览器门禁见
[浏览器门禁](../deploy/ci/NETWORK_BROWSER.md)，它的节点 RPC 是测试替身，
不能代替上述主机生命周期和 KVM 验收。开发安装器不修改金额、支付、币种、
历史商品 / 财务快照或既有财务数据库。

## 当前结果

2026-10-25，Darwin 本地运行上述独立安全测试：**93 个 test methods 通过**
（含额外 subtests），无 SKIP；测试只使用合成文件与替代系统边界，没有
实际启动服务、连接 MySQL 或 KVM。与 packager 的 USTAR envelope / metadata
往返兼容也只使用合成字节，不是真实包安装。

首轮 RED 在安装器文件尚未落盘时失败；后续 RED 还发现向导的
`is_loopback` property 调用错误及畸形镜像信息异常。归档前置元数据边界、
TOCTOU immutable snapshot 和权限分离分别补入独立回归。**上述通过不是
完整安全审计结论**；后续源码改动必须重跑，所有真实主机验收仍未执行。

其中新增依赖 / MySQL 回归为 28 个 methods，另补 1 个真实002 FK源码对照
与 migration-only REFERENCES 回归，以及 3 个 native 入口/transport 安全单测；
另加 6 个 runner 隔离 / fresh-host 回归。APT source/policy 用例显式隔离
宿主 precondition；独立用例仍调用真实守卫，只虚拟文件读取，逐项核对全部
数据库 / virt / finance 路径（存在及悬空 symlink）、节点内存 / KVM 字符设备，
以及 MySQL 配置 / service / binary / socket 路径的拒绝和干净证据通过。
本轮 RED 在模拟占用 runner 上复现提前拒绝，并发现原 node simulation 负例
没有到达 APT；修复后强制 update / simulate 各一次，危险计划不进入 assume-yes。
不沿用此前旧 55 项的通过结论。REFERENCES 只在专用数据库 migrator grants，
runtime 仍为 SELECT/INSERT/UPDATE/DELETE，不扩展 global/DROP/GRANT OPTION。
这批使用 Python SQL 边界模型，不启动 MySQL、APT、systemd 或任何 daemon；
不能称为真实 MySQL provisioning、干净 Ubuntu 安装或 KVM 验收通过。
额外 RED 发现并回归了启动丢 ACK 的错误“未启动”归因，以及旧 receipt
缺少 `native_options` 时可在 resume 引入新副作用的问题；旧 receipt 只按
原始无 APT / 无数据库 provisioning 意图恢复，不因此获得新的安装授权。

## 独立 native MySQL SQL / grants 合同门禁（待 CI 执行）

`deploy/ci/check.sh` 在原有 disposable `mysql-native.sh` fixture 内强制执行
`deploy/ci/test_cloud_mysql_grants.py`。入口必须为非 root Linux amd64，且
`RUNNER_TEMP` 与四个 `ASTER_NATIVE_MYSQL_{ROOT,SOCKET,ADMIN_CNF,FIXTURE_ROOT}`
均严格匹配当前私有、当前UID所有、无链接别名的 native fixture 布局。
另外核对 socket 类型、mysqld PID / `/proc` executable / argv，以及真实服务器
basedir、datadir、socket、8.4版本和禁TCP状态。环境缺失或不符返回失败，
**没有 host mysql / host DB fallback，也没有 SKIP-success**。

仅借 fixture 原有 `aster_ci` 管理身份，在随机后缀的固定测试前缀下创建
两库两用户，碰撞不接管；凭据保留在0600私有client文件及私有HOME内，SQL
走stdin，参数不带密码。显式 `--defaults-file` 为第一个选项，随后才是
`--no-login-paths`，遵循 [MySQL 8.4 option-file 顺序要求](https://dev.mysql.com/doc/refman/8.4/en/option-file-options.html)。

门禁真实执行服务器 RANDOM PASSWORD / ATTRIBUTE / SHOW GRANTS，并仅在
测试模块临时替换 `provision.mysql_sql` transport 后调用生产 `verify_grants`；
不修改任何生产 root / owner guard。以实际 migrator grants 执行当前全部10份
SQL迁移；004确有6条 CREATE INDEX SQL，一并真实执行，不冒称只验证了Go逻辑。
同时核对002 FK、runtime DML成功而CREATE/ALTER/GRANT/DROP失败、migrator
DDL成功但无global/邻库权限，以及数据库下划线不得作为wildcard授权邻库。
负例先确认同一已认证身份执行了SELECT，再接受权限错误码；auth失败或语法错误
不能充当权限拒绝证明。

清理只对本脚本 nonce + server UUID 标记明确绑定的新库/用户执行DROP，
不凭名称接管；未知对象保留给外层拥有的fixture整体清理。stdout回执只有
固定scope/checks、迁移版本/hash、passed和cleanup状态，不输出SQL、grants原文、
密码、DSN、token或原始client诊断。

本机无 native fixture，实际调用已返回 `passed:false` / exit1，未运行数据库
权限门禁。上面的93项仅包括纯guard/transport单测；native真实SQL结果必须
以随后同提交GitHub native MySQL job为准。此门禁仍不覆盖生产root socket
bootstrap、APT、systemd、整机安装/升级恢复或KVM。
