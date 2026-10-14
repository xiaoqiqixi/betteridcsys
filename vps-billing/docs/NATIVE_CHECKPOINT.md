# 原生部署与发布自动化验证记录

日期：2026-10-14 UTC。应用维护 [PR #1](https://github.com/xiaoqiqixi/betteridcsys/pull/1) 已正常合并到 `main`，合并提交为 `95ca53ed2cf280ea49b5e1f2c7bb6e342c9d3512`。原生部署与自动化 [PR #2](https://github.com/xiaoqiqixi/betteridcsys/pull/2) 仍在完成验收，尚未合并。本文件区分本地替身测试、真实 GitHub CI、发布自动化和外部主机部署，不是生产认证。

## 当前实现

- 当前源码移除旧的 Dockerfile、Compose、专用初始化/秘密/备份脚本及测试包装；CI 无服务容器或相关命令。历史提交与 `0.3.0-rc.1` 保留，历史验证记录明确标注，不作为当前教程。
- 唯一部署路径为单服务器原生 Linux amd64：加固 systemd API、Nginx HTTPS/静态网页、本机 MySQL；版本目录和 `current` 链接由管理员管理。高可用不在本次范围。
- 原生备份使用明确 Unix socket、私密客户端配置、可信祖先目录、当前 InnoDB 表范围检查、原子发布和不覆盖策略；恢复是人工核实目标后的隔离流程。
- 原生运行归档仅包含 systemd、Nginx 和原生备份安装材料；提交快照打包保留 LICENSE/README、工具链/依赖清单与 SHA-256。
- 只读 CI、标签/手动候选构建和受信默认分支草稿发布三段分离。发布 job 才有 `contents: write`，不执行下载包；核对仓库、精确 run/attempt、标签、Git 源码及产物。仅创建 draft + prerelease，不移动标签、不覆盖旧 Release、不自动正式发布或部署。

## 已完成的本地验证

- 发布守卫 59 项离线测试、CI 编排 4 项离线测试通过；GitHub 写操作全部使用测试替身。
- 旧通用归档版原生 MySQL 夹具 15 项离线测试通过，覆盖未验证分发在网络前拒绝、哈希/版本不匹配、初始化/就绪超时、子命令失败及遗留进程清理；使用假二进制和测试清单，不证明官方 MySQL 可启动。当时实际仓库清单的拒绝探针退出 1，未调用下载工具。后续官方 DEB 方案 22 项离线测试通过（13.555 秒），包含真实 dpkg 数据提取及假数据库二进制；日志为 `mysql-native-deb-offline.log`。该结果仍不是 Oracle 数据库运行结论。
- 原生备份六组回归通过，包含 8 个同秒并发备份、搬移校验、dump/gzip/checksum 失败、危险配置/权限/祖先路径、已有目标不覆盖。使用模拟 mysql/mysqldump；云环境系统目录的映射属主在测试中明确建模，未伪称实际原生备份成功。
- 依赖许可证清单 4 项测试通过。三个 workflow 经 actionlint `1.7.7` 语法/表达式检查通过；shell/Python 语法、文档链接和空白检查另有日志。
- systemd `257` 在隔离文件系统中验证 unit 通过；使用占位可执行文件，未启动服务。Nginx 静态审查修复 HTTP 重定向日志泄露查询串的问题；本环境没有 Nginx，未运行 `nginx -t`。
- npm 完整审计报告已知漏洞 0。本地 Go 漏洞扫描曾因 `https://vuln.go.dev/index/modules.json.gz` 返回 Forbidden 未完成；后续独立 GitHub 扫描已成功，具体范围见下节，不能把本地网络失败或单项扫描成功当作整体门禁结论。

改为完全原生 CI 前，本云环境还运行过未改动应用代码的 Go race（38 顶层 + 50 子测试，0 跳过）、vet、编译、前端 62 项、配置 8 项和 HTTP 13 项回归。当时数据库使用此前的一次性夹具，该进程已停止；这份证据不能宣称原生 MySQL CI、原生启动或恢复已经通过。当前修订须完成下面的原生门禁。

证据目录：`/workspace/aster-automation-validation-20261014/` 和 `/workspace/aster-native-validation-20261014/`。打包后的准确源码提交、工具链、归档校验和以相应 `BUILD.json`、`SHA256SUMS` 及交付报告为准；本文件不提前断言尚未运行的打包结果。

## 已发生的 GitHub CI

提交 `1678652b90d56c39a624aa45ddc35ee8c8988a38` 已通过开发分支 push 和 [PR #2](https://github.com/xiaoqiqixi/betteridcsys/pull/2) 触发两次真实 `Read-only CI`：

| 入口 | Run / job | 实际结果 |
|---|---|---|
| 分支 push | [38552892283 / 115814866235](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38552892283/job/115814866235) | 2026-10-14 10:55 UTC 运行；原生 MySQL 来源门禁失败 |
| PR | [38552974701 / 115815128764](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38552974701/job/115815128764) | 2026-10-14 10:55–10:56 UTC 运行；同一门禁失败 |

两次 checkout、Go 和 Node setup 均成功，但数据库清单仍为 `awaiting_verification`、SHA-256 为空，夹具在下载/执行数据库之前拒绝运行。因此应用集成回归没有开始，后续 npm 漏洞扫描、actionlint 和 Go 漏洞扫描全部被跳过。这不是完整 CI 通过，也不能据此断言 GitHub runner 能否访问 Go 漏洞数据库。证据为上述 job 页面与本地 `github-delivery.json`。

`Release candidate build` 及 `Draft prerelease publication` 的真实端到端运行尚未完成；只读 CI 已执行不能证明候选 artifact 下载、来源核对和草稿 Release 上传已验收。

随后将 Go 漏洞扫描拆为独立 job。[Run `38554416310` / job `115819884945`](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38554416310/job/115819884945) 已成功；PR head 为 `a41e05e9a297635534165a09607f57ff6f919c87`，实际 checkout 的 GitHub PR 虚拟合并提交为 `7d38101904817a00b8d266dec74a039d2fd44a4e`。使用 Go `1.27.2`、`govulncheck v1.9.0`，漏洞数据库更新时间为 2026-10-08 22:31:09 UTC。

扫描报告 **0 项可达函数层面的漏洞**，同时报告 **1 项导入包、19 项依赖模块告警**，工具未识别代码调用对应漏洞函数。该结果不能概括为“0 项已知 Go 漏洞”，依赖告警仍需复核。此 run 的数据库 job 仍因旧未验证清单失败，整体 run 为 failure；独立扫描成功只证明上述提交、工具和数据库快照的扫描范围。

## 当前原生运行证据

官方 DEB 方案固定 Ubuntu 24.04 amd64 的四个 MySQL `8.4.11-1ubuntu24.04` 包，大小和 SHA-256 来自 Oracle 官方 HTTPS Packages 元数据；先验证所有包，再核对控制元数据和安全提取数据，不安装数据库服务或执行包维护脚本。本地对实际包和 InRelease 的 HTTP 403 仍作为历史网络限制记录，没有声称本地完成 InRelease 签名核验。

提交 `cf971f1988065222083439e90215e7bdcc1ba090` 的 [push job 115823726412](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38555568661/job/115823726412) 已下载并校验四个真实官方 DEB；MySQL 初始化退出 0，数据库进程保持运行。该次 TCP readiness 探测因客户端 `2061/HY000` 失败，系统服务验收未执行。随后修订为本机 socket 就绪检查。提交 `9ed815cdaf15f9e91d9e4068dfddbde4cf033d2b` 的 [job 115825623287](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38556135255/job/115825623287) 首次通过真实原生数据库回归与完整核心原生验收；详见下表。该 job 最终因 actionlint 的 SC2097/SC2098 环境变量表达式告警失败，原生验收及 npm 审计已通过。已修复该表达式，完整流水线仍需在最后修订上重跑。

同一 `cf971f1` 提交的 [push Go 扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38555568661/job/115823726899) 和 [PR Go 扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38555576197/job/115823748608) 均成功。前者检出 `cf971f1`，后者实际分析虚拟合并提交 `80c5991865c01fde5c7a5fdc5454f3b71ce08528`。Go `1.27.2`、`govulncheck v1.9.0`、数据库更新时间 2026-10-08 22:31:09 UTC；结果为 **0 项可达函数、0 项导入包、19 项模块级告警**。修复 edwards25519 后先前的导入包告警不再出现；余下告警属于当前应用未导入的 `x/crypto` SSH/OpenPGP 包。不能概括为“依赖无已知漏洞”，也不代表未来版本或不同构建配置的扫描结论。脱敏摘要：`govulncheck-cf971f1-postpatch.md/json`。

### 首次原生核心验收：`9ed815c`

| 项目 | 实际结果 |
|---|---|
| 真实 MySQL 应用回归 | Go 38 个顶层 + 50 个子测试，0 失败/0 跳过；vet、Linux amd64 编译通过 |
| 前端与离线回归 | 前端 62 项；Python CI 89 项（发布守卫 59、数据库夹具 22、检查编排 4、原生验收守卫 4）；许可证清单 4、配置 8、演示 HTTP 13 项均通过 |
| systemd 与 Nginx | 加固 API unit、只读发布目录、临时 Nginx 与验证测试 CA 的 HTTPS 通过 |
| 业务与权限 | 首轮 17 项 HTTPS 验证通过；运行账号 DML 与迁移身份分离，运行身份 DDL/跨库负向检查通过 |
| 重启与目录切换 | API 重启及相同二进制/schema 的 A → B → A 链接切换通过，既有订单保留 |
| 原生备份与恢复 | 实际 `backup-native.sh` 导出、校验、恢复到同一 MySQL 实例的全新空库，完整基础表数据比较一致 |
| 恢复后业务 | API 切换至恢复库，另一次 17 项 HTTPS 验证通过 |
| 清理 | 测试自有服务、账号、数据库与目录的清理步骤成功 |
| 其他门禁 | npm audit 通过；随后 actionlint 失败，不能把整个 CI run 写为成功 |

以上依据为 GitHub job 日志。该次原生证据 artifact ID 为 `11890592304`，API 报告大小 1,801 字节、SHA-256 `4c1f3cbb90f8a399e409e3eca24d6615f793515db5186bc8fca440abd8f941c1`；云环境访问其签名下载地址返回 HTTP 403，因此没有在本地重新读取 JSON 或校验归档字节。脱敏 job 日志摘要存于 `native-first-pass-38556135255.json`。这里不推造未取得的表数、备份耗时或恢复耗时。

## 验证与交付边界

- **核心原生验收已通过，完整流水线待重跑**：`9ed815c` 的上述核心验证真实完成；工作流静态检查修复及新增验证仍须最终运行。当前通过的迁移身份隔离不提前证明后续更窄 DDL grants、双客户端代理限速或新增时间统计已运行。
- **真实主机范围**：没有连接或部署用户服务器。自动化使用私有测试 CA 与 localhost；不证明公共 CA、真实 DNS、证书续期、整机开机恢复、数据库进程重启、异地灾备或生产容量。单次同实例空库恢复不等于独立实例灾备。
- **公开交付范围**：仓库为公开状态，源码、文档、构建包和校验文件可公开；密码、密钥、实际服务器配置、客户数据及敏感日志排除。根 LICENSE/README 保持不变，没有修改仓库可见性或全局权限。
- **发布流程范围**：候选构建至草稿 Release 上传尚无真实成功记录。默认分支是发布器信任边界，跨 API 校验不消除其他写入者移动标签或修改 Release 的竞争。应用 PR 已合并不代表自动化 PR 或候选版本已经发布。

历史 `0.3.0-rc.1` 保持原提交及哈希。新源码需要新的构建与版本记录，不覆盖、重新命名或伪造旧产物的来源。
