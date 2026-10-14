# CI 与草稿 Release 自动化

本方案固定用于公开仓库 `xiaoqiqixi/betteridcsys`（仓库 ID `1418618420`）的代码验证与候选版本归档，默认生成 **Draft + Pre-release**。用户已明确授权公开经审查的源码、文档、构建包及校验和，并进一步授权正常合并到 `main`、由维护方完成验收；秘密、实际服务器配置、客户数据和敏感日志仍不在公开范围内。

这些工作流本身不合并 PR、不部署服务器、不接通支付/邮件，也不把候选版本标记为正式可运营版本。维护方在审查与验收后按授权正常合并，不更改仓库可见性、全局权限、计费或其他设置。

2026-10-14，提交 `1678652b90d56c39a624aa45ddc35ee8c8988a38` 已触发真实 [push CI](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38552892283/job/115814866235) 和 [PR CI](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38552974701/job/115815128764)。两次均在原生 MySQL 来源门禁失败，后续扫描被跳过；不能再把当前状态写成“Actions 从未运行”。候选构建和草稿发布的端到端流程仍未完成验收。后续修复、合并与运行结果须绑定实际提交和 run URL，不以本地测试或 YAML 存在代替。

之后的 [独立 Go 扫描 job](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38554416310/job/115819884945) 已成功；PR head 为 `a41e05e`，实际分析的是 GitHub 虚拟合并提交 `7d38101904817a00b8d266dec74a039d2fd44a4e`。数据库 job 仍失败，因此整体 CI 没有通过；主分支合并仍待实际完成记录。

最新部署目标为 **单服务器原生 Linux 安装**，当前源码、部署工具和 CI 都只保留原生路径；高可用后续单独评估。CI 使用一次性原生 MySQL 8.4 进程与隔离数据目录；修订的官方 DEB 固定清单已准备，但实际下载在本云环境受阻，新方案尚无真实 runner 初始化通过证据。数据库夹具不代表原生 systemd、开机启动、升级或恢复已验收。修订后的原生安装包与操作文档必须完成实际验证，再进入候选发布。

## 三段流程

| 流程 | 入口 | 权限与产出 |
|---|---|---|
| `ci.yml` / `Read-only CI` | 分支 push / PR / 手动；push 排除 `artifacts/**` | 只读源码，验证 Go、MySQL、前端及接口；不创建 Release |
| `release-build.yml` / `Release candidate build` | 预发布标签 push；或默认分支上的手动入口指定已有标签 | `contents: read`；验证精确源码，构建候选文件并上传该次 run 的 Actions artifact |
| `release-publish.yml` | 指定构建流程的 `workflow_run: completed` | 仅发布 job 声明 `contents: write`、`actions: read`；检查成功 run 与产物后创建新草稿 Release |

GitHub 的 `workflow_run` 发布流程来自默认分支，并可获得前序只读流程没有的写权限，因此它是单独的信任边界。发布 job 不检出或执行 PR 源码，不执行候选包中的脚本/二进制；只运行默认分支受信版本的验证与 REST 发布程序，下载内容只作为待核验数据。[GitHub：workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)

## 标签、源码和流程的绑定

只接受完整的 `vX.Y.Z-(alpha|beta|rc).N` 预发布标签，使用首尾锚定的严格格式校验。四个数字段均为 ASCII 非负整数，除单独的 `0` 外不允许前导零，标签总长不超过 64 个字符，例如 `v0.3.0-rc.2`。稳定标签、任意分支名、提交号作为标签输入、空白、路径片段和额外后缀都不是支持的发布入口。YAML 的标签 glob 只负责筛选触发事件，不能代替严格校验。

标签必须已经存在于本仓库；解析轻量/附注标签后得到的 commit 必须与构建的 `source_commit` 完全一致，而且属于默认分支（当前为 `main`）的已合并历史。手动运行只能从当前默认分支入口指定已有合法标签，不支持“从任意工作分支上传一个包”。验证器每次从 GitHub API 核对固定仓库全名、ID、公开状态（`private: false`）和默认分支；名称相似的其他仓库、fork 或不符状态不会取得发布权限。

发布器重新读取触发 run 的仓库、事件、状态、源码与产物信息；不能仅相信 artifact 文件中的声明。构建流程、控制程序、打包配方等受信文件在上游 head 和候选 source 中的 Git blob ID，必须与发布流程使用的默认分支提交一致。旧流程或改写过的打包/发布控制代码不能沿用一次成功构建取得发布权限。

本流程不提供创建、移动或删除标签操作，也不覆盖已有草稿或正式 Release。发现标签缺失/已移动、来源不一致或同名 Release 已存在时停止，不用 `target_commitish` 把它自动补成新标签。[GitHub：创建 Release 参数](https://docs.github.com/en/rest/releases/releases#create-a-release)

这些校验不是跨 API 的原子锁。其他有权限的人仍可能在检查后移动标签、删除标签或发布草稿；发布前后复查和工作流并发限制不能提供密码学不可变性。需要服务器端标签/分支规则才能进一步限制外部写入，本轮不更改仓库规则或权限。具有仓库写权限的人也可能修改其他工作流申请权限，这套实现不是针对恶意仓库写入者的全仓库安全沙箱。

## 构建与上传前核验

候选构建使用标签对应的精确源码，固定 Go `1.27.2`、Node.js `24.19.0`，按锁文件安装依赖。常规 CI 和候选构建的实际步骤以同提交 workflow/验证脚本为准，必须报告每项结果：

- Go race、vet、Linux amd64 编译，以及显式一次性 `_test` 数据库的 MySQL 集成测试。未配置数据库而跳过测试不算通过。
- 前端锁文件安装、单元/组件测试、类型检查、格式检查和生产构建。
- 独立 HTTP 安全/配置冒烟、发布程序与归档处理的负向测试。测试账号与秘密仅用于该次临时测试，不能写入发布资产。
- 候选构建调用 `package-release.sh` 从同一提交快照打包两次，并用 `diff -r` 逐字节比较完整输出；核对工具链/输入锁文件清单、`BUILD.json`、`SHA256SUMS`、版本标签、源码 commit 和预期文件集合。
- 固定版本 `actionlint` 校验三个工作流；这不是 GitHub 上实际运行成功的证明。

**提交 `1678652` 的原生数据库门禁失败，真实完整 CI 未通过。** 当时 `deploy/ci/mysql-distribution.json` 的候选版本为 `8.4.11`，状态为 `awaiting_verification`，`sha256` 为 `null`。官方通用归档访问返回 HTTP 403，未取得归档或可信校验值；`mysql-native.sh` 因此在任何下载、解压或数据库二进制执行前拒绝运行。两次真实 Actions 的应用回归没有开始，后续 npm、actionlint 与 Go 扫描均为 skipped，不能计为通过。

修订的 `mysql-distribution.json` 为 schema 2、状态 `pinned_official_metadata`，固定 Ubuntu 24.04 amd64 的 MySQL `8.4.11-1ubuntu24.04`。`server-core`、`client-core`、`client-plugins`、`client` 四个官方包的大小和 SHA-256 来自 [Oracle Packages 元数据](https://repo.mysql.com/apt/ubuntu/dists/noble/mysql-8.4-lts/binary-amd64/Packages)。夹具先验证全部包，再检查包名/版本/架构并提取数据；不安装数据库服务，不运行包维护脚本，也不接受临时传入的哈希或已解压二进制目录。

这属于官方 HTTPS 元数据固定，并非本地 InRelease 签名核验：本云环境访问 InRelease 和实际 DEB 均返回 HTTP 403，未绕过限制。Ubuntu 原生运行库、真实 MySQL 初始化、socket 访问、测试和清理仍须在真实 runner 验证。使用假 `mysqld/mysql` 的编排测试只证明拒绝/清理逻辑，不证明数据库已启动或系统库兼容；没有证据前不把新方案记为成功，具体结果见 [原生检查点](NATIVE_CHECKPOINT.md)。

发布器只读取指定上游 run 的指定 artifact，通过有上限的 ZIP 下载/解析校验文件名、大小、路径和内容。拒绝目录穿越、重复/多余文件、链接、超限压缩内容、来源不匹配或校验和错误。归档数据不能覆盖受信脚本目录；不会从下载包中导入 Python 模块、执行 shell 或运行二进制。

保留在源码归档中的文件集合及每个文件的 Git blob 哈希还须匹配候选 commit，不能只相信归档自报的清单。修订后的运行包只携带原生 systemd、Nginx 配置和 `backup-native.sh`；源码归档跟随修订后的提交，不重新加入已删除的旧部署实现。历史文件仅存在于不可改写的旧提交/旧候选中。`BUILD.json` 新增 `deployment_model`，明确原生单服务器模型及目标主机验证待完成。

打包输出严格为同一候选版本的源码包、Linux amd64 包、`BUILD.json` 和 `SHA256SUMS` 四个文件。构建验证后额外生成 `PROVENANCE.json`，记录仓库、tag/source commit、run ID/attempt、受信控制文件 blob ID 和四个文件的哈希/大小。因此中间 artifact `candidate-RUN_ID-ATTEMPT` 与最终草稿 Release 各含五个文件；发布说明写入 Release 正文，不增加说明附件。`SHA256SUMS` 覆盖两个归档与 BUILD，`PROVENANCE.json` 的传输完整性由 GitHub artifact 的整体 digest 校验。来源记录没有签名，也不是 SLSA 认证或完整供应链证明。

Actions artifact 是中间交付，不等于 Release 已创建；草稿 Release 也不等于部署成功。完整人工放行条件见 [RELEASE.md](RELEASE.md)。

常规 CI 与候选构建另行执行 `npm audit --audit-level=high` 和固定版本 `govulncheck`；命令返回非零（包括扫描网络失败）会使该 job 失败，不跳过门禁。npm 低于 high 的审计发现不一定使该命令失败，因此必须结合输出报告范围，不能把绿灯解释为“零漏洞”。目标主机系统软件审查、浏览器验收、TLS、真实支付/邮件、完整恢复和负载验收不在该自动化覆盖范围内；这些放行项仍按 RELEASE.md 单独完成。扫描源不可访问时记录失败/未完成与原因。

本地云环境曾因官方漏洞数据库返回 Forbidden 未完成 Go 扫描，前两次 GitHub run 又因数据库前序失败跳过扫描。拆为独立 job 后，run `38554416310` 的 Go 扫描实际成功：Go `1.27.2`、`govulncheck v1.9.0`，数据库更新时间 2026-10-08 22:31:09 UTC；报告 0 项可达函数漏洞，仍有 1 项导入包和 19 项依赖模块告警。工具未发现调用对应漏洞函数不等于依赖没有漏洞，告警仍需复核；扫描结果仅覆盖该次虚拟合并提交，不能替代数据库或原生部署验收。

## 权限与依赖

使用 GitHub 为 job 提供的短期 `GITHUB_TOKEN`，不需要 PAT、部署密钥或自定义长期秘密。构建仅只读；写权限只声明在草稿发布 job，不修改仓库全局默认权限。写权限属于整个发布 job，不能因 token 只通过环境传给 Python 就称为仅某一个 step 有权限。未声明的权限保持关闭。checkout 设置 `persist-credentials: false`；不使用 `pull_request_target`、不启用不安全 PR checkout，不在特权发布器中恢复不受信任缓存；Go/Node setup 的自动依赖缓存也关闭。[GitHub：权限语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)、[GitHub：安全使用工作流](https://docs.github.com/en/actions/reference/security/secure-use)

以下版本于 2026-10-14 从 GitHub 官方 `actions/*` Release → commit 链接及对应 `action.yml` 核验，workflow 使用完整 SHA，版本名仅作审查注释。它们当时是官方最新 Release，不代表永远最新，也不是完整代码审计证明。

| Action | 版本 | 固定 commit |
|---|---|---|
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| [actions/setup-go](https://github.com/actions/setup-go/releases/tag/v7.0.0) | v7.0.0 | `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e` |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0) | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

这四个 Action 使用 Node 24 运行时；发布器自行受控下载 artifact，不需要增加 download-artifact 依赖。机器可读的核验来源、日期与运行时信息保存在 Git 仓库的 `.github/action-pins.json`；发布包内不包含整个 `.github` 目录。每次升级 pin 都应重新核验官方仓库来源、Release 变化、最低 runner 要求和本地负向测试。固定 SHA 限制标签漂移，不证明 Action 没有缺陷。[GitHub：固定完整提交](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)

## 首次安装与现有 rc.1

现有候选 `0.3.0-rc.1` 来自 `0c849bc6739d8e8319ae4162c65a90d9883da27b`，其已核验产物作为历史候选保留在独立的 `artifacts/v0.3.0-rc.1` 分支。它不是修订后的单服务器原生安装版本。自动化变更不修改这些文件、既有源码提交或已有候选哈希。

该旧提交没有本轮新增的受信工作流，不能靠现在安装流程就“追溯触发”旧提交的 tag-push 构建。应用与自动化经过审查、正常合并后，未来标签须指向包含已安装流程和应用代码的受审查提交，并使用未占用的候选号。已经生成的候选仍按其原提交和哈希保留；新源码必须重新构建，不能通过改名或覆盖旧文件制造新版本。

候选构建首次运行前，由维护方核对原生安装包与操作文档、安装提交、严格标签映射、默认分支祖先关系、测试结果、权限与费用状态，并按已获授权推进验收。旧拓扑测试不能替代 systemd、开机启动或原生备份恢复验收。创建标签、触发候选及草稿上传各自需要实际结果记录；本文件不提前宣称这些动作已完成。

## 草稿创建失败后的处理

所有本地/下载产物检查须在首次 Release 写入前完成；上传只面向本次创建返回的 Release ID。保持 draft、prerelease，且不设置为 latest。发现已有同名草稿/正式 Release 时停止，不通过删除/覆盖“修好”重试。

网络超时、部分资产上传、同名资产冲突或 API 错误可能留下不完整草稿，也可能存在请求已执行但客户端未知的结果。程序应保留现状并报告 run、Release ID、已确认资产与不确定步骤；禁止自动重新创建、替换、删除或把草稿改为正式发布。由负责人检查 GitHub 上的真实状态后再决定后续操作；重复运行不会被当作安全的自动恢复办法。

## 运行资源与费用边界

只使用标准 GitHub-hosted `ubuntu-24.04`；不使用 larger runner、自托管机器或用户 Mac，不启用付费计划，不设置预算，不修改账户或仓库级权限。常规应用检查、独立 Go 扫描、候选构建、草稿发布的 job 超时分别为 35、15、45、10 分钟，中间 artifact 保留 7 天；配置并发限制以减少失控运行和无意覆盖。过期中间产物不触发自动重建/补传。

公开仓库授权不代表已经核验本账户的 runner 资格、存储使用、费用策略或工作流运行权限；本轮未检查账户额度，也不承诺所有相关资源免费。若账户策略、额度或组织权限阻止执行，应报告限制，不自动开通付费能力或扩大权限。[GitHub：Actions 计费与用量](https://docs.github.com/en/actions/concepts/billing-and-usage)
