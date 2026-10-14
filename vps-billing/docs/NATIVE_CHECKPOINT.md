# 原生部署与发布自动化检查点

日期：2026-10-14 UTC。基于应用维护提交 `0c849bc6739d8e8319ae4162c65a90d9883da27b`，开发分支 `codex/release-automation-20261014`。已交付检查点提交为 `1678652b90d56c39a624aa45ddc35ee8c8988a38`；后续修复须以新的提交和证据记录。本文件区分本地测试、真实 GitHub CI、发布自动化和原生主机验收，不是生产认证。

## 当前实现

- 当前源码移除旧的 Dockerfile、Compose、专用初始化/秘密/备份脚本及测试包装；CI 无服务容器或相关命令。历史提交与 `0.3.0-rc.1` 保留，历史验证记录明确标注，不作为当前教程。
- 唯一部署路径为单服务器原生 Linux amd64：加固 systemd API、Nginx HTTPS/静态网页、本机 MySQL；版本目录和 `current` 链接由管理员管理。高可用不在本次范围。
- 原生备份使用明确 Unix socket、私密客户端配置、可信祖先目录、当前 InnoDB 表范围检查、原子发布和不覆盖策略；恢复是人工核实目标后的隔离流程。
- 原生运行归档仅包含 systemd、Nginx 和原生备份安装材料；提交快照打包保留 LICENSE/README、工具链/依赖清单与 SHA-256。
- 只读 CI、标签/手动候选构建和受信默认分支草稿发布三段分离。发布 job 才有 `contents: write`，不执行下载包；核对仓库、精确 run/attempt、标签、Git 源码及产物。仅创建 draft + prerelease，不移动标签、不覆盖旧 Release、不自动正式发布或部署。

## 已完成的本地验证

- 发布守卫 59 项离线测试、CI 编排 4 项离线测试通过；GitHub 写操作全部使用测试替身。
- 旧通用归档版原生 MySQL 夹具 15 项离线测试通过，覆盖未验证分发在网络前拒绝、哈希/版本不匹配、初始化/就绪超时、子命令失败及遗留进程清理；使用假二进制和测试清单，不证明官方 MySQL 可启动。当时实际仓库清单的拒绝探针退出 1，未调用下载工具。DEB 修订的测试结果须单独记录。
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

## 交付边界与停止点

1. **原生 MySQL CI 需完成修复后实测**：提交 `1678652` 使用的官方通用归档请求返回 HTTP 403，实际 GitHub CI 按设计在未验证清单处失败。修订清单已改为 schema 2、`pinned_official_metadata`：从 Oracle 官方 HTTPS Packages 元数据固定 Ubuntu 24.04 amd64 的四个 `8.4.11-1ubuntu24.04` DEB 大小和 SHA-256。夹具先验证全部包，再核对控制元数据并安全提取数据，不安装数据库服务或执行包维护脚本。此云环境对实际包和 InRelease 的访问仍返回 403，因此没有本地 InRelease 签名核验或真实初始化结论；新方案的运行库兼容性及完整原生 CI 仍待真实 runner 证据。不能把固定元数据或替身测试当作数据库已启动。
2. **公开交付和正常合并已获授权**：只读 GitHub 元数据确认仓库为公开状态（`private:false`）。用户已明确同意公开源码、文档、构建包与校验文件，并进一步授权正常合并到 `main`，由维护方完成验收。密码、密钥、实际服务器配置、客户数据及敏感日志仍须排除；没有擅自修改仓库设置。授权不替代审查、测试或实际合并记录，自动化本身不执行合并。
3. **原生目标主机未验收**：发行版、架构、资源、已有数据/服务待确认。未连接用户服务器，未安装/重启服务、生成真实秘密、配置 DNS/TLS、防火墙、备份计划或恢复数据。实际 systemd 启停/开机恢复、Nginx/TLS、权限、升级回滚和原生恢复仍需授权测试环境。
4. **发布自动化尚未端到端验收**：真实只读 Actions 已运行，独立 Go 扫描成功，整体仍因数据库门禁失败，详见上节。候选构建/草稿发布尚无成功运行证据，artifact 下载/摘要及 GitHub Release API 行为仍需受控验收。合并到默认分支的实际状态以 GitHub 合并记录为准；默认分支仍是发布器信任边界，跨 API 检查不消除外部标签/Release 写入竞争。

维护方按已获授权继续修复、执行验收和完成正常合并，逐项记录实际结果；未通过的发布门禁不得跳过。历史候选保持原提交及哈希，不以新文件覆盖或重新命名旧产物；本检查点不构成外部服务器部署完成的证明。
