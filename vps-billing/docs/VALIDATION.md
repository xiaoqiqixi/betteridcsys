# 验证记录

各项结果绑定实际执行时的提交、日期和 GitHub run；后续源码或界面修改不沿用旧提交的通过结论。

## Core 0.5.1：安装准备与未付取消

本轮新增主机自动组装、只读预检、机器备份元数据及受限未付订单取消。实施范围见 [REFERENCE_SCOPE.md](REFERENCE_SCOPE.md)。首轮源码 `93f6d994f4b4fd9e8623ae2d81a655e005cecf05` 的 [CI 38668093106](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38668093106) 在 Go 数据库回归失败，没有放行发布：取消异常状态测试被先前损坏夹具的全量列表读取干扰，迁移前缀 3 的结构判定也未通过。后续修复必须以新提交完整运行证明，不把旧失败改为通过。实际构建另发现 GNU 长文件名与受限解包器的兼容问题，当前新增安全兼容与 ustar 分发修复。当前不填未来通过或发布状态，完成后以实际运行和资产核验补齐。历史 0.5.0 和更早结果保持下方原记录，不能代替本轮验收。

## 历史 Core 0.5.0 / SMTP 1.1.0 的验证与来源

已验证源码：`6be81aaed4868adb3c60b30accbfd87d0bb899c5`，执行日期为 2026-10-14 UTC。[完整 CI 38655661440](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38655661440) 的[应用、原生与浏览器检查](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38655661440/job/116164687273)、[独立 Go 扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38655661440/job/116164687106)及[官方发布元数据读取](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38655661440/job/116164687294)均成功。以下结果绑定该源码，不沿用历史版本或未提交修改的结论。

| 检查 | 实际结果与范围 |
|---|---|
| Go / MySQL | 403 个 PASS 事件（含子测试），0 失败、0 跳过；race、vet、编译及真实 MySQL 财务迁移、报价确认、历史快照、事务回滚与权限回归通过 |
| 前端与工具 | 前端 194，Python CI 198，清单 8、插件安装 39、更新暂存 33、配置 9、回环 HTTP 14 项通过；类型、格式、生产构建及 actionlint 通过 |
| 原生业务与恢复 | Ubuntu 24.04 / amd64，MySQL 8.4.11；systemd API、验证证书的 Nginx HTTPS、DML/迁移权限分离通过；7 次迁移，原库和恢复库各 14 表完整数据哈希一致，HTTPS 各 22 项通过 |
| 财务与状态保留 | 先验证新库仅 CNY，再由管理员明确登记其他币种及独立价格；API 重启及同 schema A→B→A 保留 6 个订单；加密 SMTP 设置恢复后可解密，保持关闭且未外发 |
| 独立 SMTP 插件 | 9 项检查、0 失败、0 跳过；双摘要安装、危险审批拒绝、独立 UID/进程隔离及受控崩溃恢复通过；`1.1.0 → 测试夹具 1.1.1 → 1.1.0` 的 11 阶段 Core PID、磁盘与存活程序哈希不变，健康及订单接口持续正常 |
| 浏览器 | Chrome 155.0.8059.39，沙箱开启；桌面/手机及财务配置等自动交互通过；日志记录 16 张合成截图的名称、大小、SHA-256，未下载截图或逐张人工视觉审阅 |
| 扫描与清理 | npm 审计 0；Go 可达函数 0、导入包 0、模块级告警 19；原生及浏览器自有资源清理成功，原生测试与清理退出码均为 0 |

插件回环 TLS 夹具只接受两封固定合成消息，没有外部中继。投递到 DATA 后发生一次受控 worker 崩溃，Core 保留“投递不确定”结果且未自动重发；systemd 重启 worker，Core 没有因安装、替换、回退或崩溃而重编或重启。`1.1.1` 是未发布的测试版本。Go 扫描使用 Go 1.27.2 / govulncheck 1.9.0；19 项模块级告警不等于可达漏洞，也不能据此概括为全部依赖无已知漏洞。

原生验收脚本编译的未剥离 Core SHA-256 为 `af2615c54857753c76367c7710678f564a07c6b8b733a0e2539b38717c46ae19`。同一冻结源码另行构建的精简 raw Core SHA-256 为 `18a7f7da11f5f500b3c07265d6e8d804d8c79941cc6826330271f31a44333254`，该实际程序通过 9 项配置和 14 项回环 HTTP 检查，程序哈希保持不变且测试资源已清理；这项补充检查使用内存存储，没有运行 MySQL、systemd 或原生安装。

本地 Core、SMTP 各独立构建两次，所有对应产物字节一致；已核对静态 Linux amd64 ELF、资源包不含 ELF、所选源码的全部七个 SQL 及复制文件。未封装真实 Actions 来源证明的本地输出分别为 Core 5 项、SMTP 4 项，不含真实 `PROVENANCE.json`，不作为官方发布证据。最终 Release 的程序摘要、资源摘要和来源以实际公开的 `BUILD.json`、`PROVENANCE.json`、`SHA256SUMS` 为准。

首轮源码 `c1bf8a952af38c3ea8dcaedefcf59e0140e959ce` 的 [CI 38654191416](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38654191416) 因浏览器仍断言旧 `0.4.0` 而整体失败，未放行发布。夹具改为读取所选源码版本并核对 API/页面后，上述 `6be81aa` 完整运行通过；旧失败记录保留。

验收使用隔离 runner、私有测试 CA 和合成数据；没有用户服务器部署、真实付款或外部邮件。A→B→A 使用相同程序与 schema，不证明数据库降级；恢复使用同一 MySQL 实例的新空库，未验证 MySQL 进程重启、整机重启、异地恢复、PITR 或生产 RPO/RTO。浏览器结论限于自动化检查，宝塔实际面板仍未验收。

### Core v0.5.0 正式交付

[Core v0.5.0](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/v0.5.0) 已于 2026-10-14 23:56:26 UTC 公开，Release ID `413283648`，源码为上述 `6be81aa`。[标签构建 38656286815](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38656286815) 独立重跑完整门禁，应用/真实数据库、原生恢复、浏览器、依赖扫描及工作流检查均通过；测试数量与上表一致。该运行另完成 raw 产物重复构建、封装后的字节比较与实际 Actions 来源绑定。[发布 38657033711](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38657033711) 成功，GitHub API 已核对 `draft=false`、`prerelease=false`、latest 指向该 Core Release，且恰有下列六项已上传附件。

| Core 公开附件 | GitHub SHA-256 摘要 |
|---|---|
| `aster-api-0.5.0-linux-amd64` | `18a7f7da11f5f500b3c07265d6e8d804d8c79941cc6826330271f31a44333254` |
| `aster-plugin-host-0.5.0-linux-amd64` | `d439a39214ba0d238b4dcb01806ff7b9ff71786b8095539e7460cc49386d64bc` |
| `aster-core-0.5.0-linux-amd64-resources.tar.gz` | `ed83f461b7db3199a948dc0530d518aeda06a6d4c44abd9e978905c767f6a2d5` |
| `BUILD.json` | `0fc77cc49ab8bf394eca1e657e5bf908068e38a5b0cac77af57b9a797de1fa4a` |
| `PROVENANCE.json` | `35204c2bb88beba95e34b85133f78235f9337a4a38af7721c04493191eef91c2` |
| `SHA256SUMS` | `583f5515f833c5b57c48021b33ec248c72294daa6f7ebfbb5437a4f65304ef74` |

已公开 API 程序摘要与上述实际 raw 程序冒烟测试一致。资源包使用此次正式构建的摘要，不以本地构建摘要代替。Core 0.5.0 交付范围为可配置币种、独立价格、报价确认、订单/账单快照及相关审计；尚未实现完整财务账本、结算、续费、退款或控制器自动开通，正式版本发布不代表生产就绪认证。

### SMTP smtp-v1.1.0 正式交付

[SMTP smtp-v1.1.0](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/smtp-v1.1.0) 已于 2026-10-15 00:06:23 UTC 公开，Release ID `413288577`，与 Core 使用相同源码 `6be81aa`。[独立标签构建 38657298153](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38657298153) 重跑完整应用、真实数据库、原生恢复、扫描及浏览器门禁，并完成重复构建与实际 Actions 来源绑定；[发布 38658019739](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38658019739) 成功。GitHub API 已核对 `draft=false`、`prerelease=false`、恰有五项已上传附件；latest 仍为 Core `v0.5.0`。

| SMTP 公开附件 | GitHub SHA-256 摘要 |
|---|---|
| `aster-smtp-1.1.0-linux-amd64` | `70127fd84e8d8c6339318b52da892b554d5644145da7a7b2587ca30bf570c068` |
| `aster-smtp-1.1.0-linux-amd64-resources.tar.gz` | `c597dbd736820be9d618afd580b8cbb3264ff557f7fd7db7e4fc4a7088ab9577` |
| `BUILD.json` | `625e3f83ad689b4c3e7e1949ae0109a6b63894d953e35df85617ff4cd171fd08` |
| `PROVENANCE.json` | `44d9f94929626fedf4055822dea20fa962cef52d96aa79fd438bc7b39b676976` |
| `SHA256SUMS` | `34491447e78ff7c3d88ba43bc7b9285da2d7a64c4859d2047c4ef3ca70f5be13` |

GitHub API 返回的三个公开 raw 程序摘要均与本地已核验程序一致。历史 `v0.3.0-rc.3`、`v0.3.0-rc.4`、`v0.4.0`、`smtp-v1.0.0` 的 Release 与附件元数据、摘要对照未变；本次核对未下载 Actions 归档或截图。SMTP 仍须独立安装、审批及启用，既有 Core 0.4.0 应先按 [升级说明](UPGRADE.md) 处理插件兼容性，不能因两个版本已公开而跳过迁移备份或自动启用邮件。

后续仅文档提交的 CI 结果单独记录；本节的程序、资源与发布结论始终绑定上述冻结源码和实际运行。

## 历史 Core 0.4.0 / SMTP 1.0.0 正式交付

交付源码：`b7699f98d926458f2b96c809c3be3ce66920f4be`。[完整 CI 38608932956](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38608932956)的[应用、真实数据库、原生与浏览器检查](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38608932956/job/116006961638)和[独立 Go 扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38608932956/job/116006961025)均成功。以下数量属于该提交，历史 rc 结果不计入。

| 检查 | 实际结果与范围 |
|---|---|
| Go / MySQL | race 91 个顶层与 125 个子测试，0 失败、0 跳过；包含真实 MySQL 更新交接审计，vet 与 Linux amd64 编译通过 |
| 前端 | 123 项测试、类型、格式与生产构建通过 |
| 工具与编排 | Python CI 193 项，插件安装工具 34 项，更新暂存工具 30 项通过；另有清单 8、配置 9、演示 HTTP 13 项 |
| 原生业务 / 恢复 | 原库和恢复库各通过 21 项 HTTPS 检查；13 张表完整数据哈希一致，加密 SMTP 设置保持关闭并可解密；同 schema A→B→A 与 API 重启保留 4 个订单 |
| 独立插件 | 8 项检查、11 个 Core 不变检查阶段通过；实际安装、替换、回退、危险审批拒绝和一次受控崩溃恢复 |
| 浏览器 | Chrome 155.0.8059.39，沙箱开启；桌面/手机交互及更新页本地版本状态通过，14 张合成截图与 SHA-256 留存在该 run 的浏览器 artifact；未逐张人工视觉审阅 |
| 清理与扫描 | 原生和浏览器自有资源清理成功；npm 审计 0；Go 可达函数 0、导入包 0、模块级告警 19（未导入的 SSH/OpenPGP 代码），不能概括为全部依赖零漏洞 |

插件验收中 Core UID `999`、worker UID `995` 为一次性测试身份。11 个阶段的 Core PID 均为 `25987`；磁盘文件及 `/proc/25987/exe` 的 SHA-256 均为 `b0be65091026923573d33ee416c8bbbc5e5aa36001fcb3e254bb17c4f3300057`，健康与已认证订单接口持续正常。Core 没有因插件安装、`1.0.0 → 1.0.1 → 1.0.0` 替换/回退或崩溃重编、重启。`1.0.1` 是同一受审源码的测试版本，未作为官方 Release 发布。

原生检查实际证明额外非 CLOEXEC 描述符未传入插件、环境被清除、错误 peer UID 被拒绝、API 秘密不可读、未知程序被动发现不执行、安装不自动启用、已有版本不可覆盖，以及软链接策略/改动程序摘要被拒绝。回环 TLS 夹具只接受两封固定合成消息，没有外部转发。第二次发送到达 DATA 后杀死 worker 一次，Core 报告投递不确定且未重发，systemd 出现新 worker PID；三次/60 秒及五秒重启参数保留，未实测反复崩溃耗尽启动次数。

上述 Core 摘要来自原生脚本编译的 API，未带正式包的 `-ldflags='-s -w'`；**不是最终 Release 内程序的摘要，也不是以最终归档完成原生安装的证明**。正式包另以同一冻结源码双构建，检查静态 ELF、版本、许可证、复制文件和全部四项产物字节一致性。两种构建的证据分别记录，不混用 SHA。

| 正式 Release | 成功构建 / 公开核验 | Linux amd64 程序归档 SHA-256 |
|---|---|---|
| [Core v0.4.0](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/v0.4.0) | [构建 38609890466](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38609890466) / [发布 38610823637](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38610823637) | `ab6b9e7a91a9058b360d202e287c2e64135d157d69b7eb6620696b5a181eb662` |
| [SMTP smtp-v1.0.0](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/smtp-v1.0.0) | [构建 38611074961](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38611074961) / [发布 38612615460](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38612615460) | `719d2047f24433bf9141ecad6222a5f974cda6306bbbf06741e48ecd691fdb81` |

两个 Release 已经 API 核对 `draft=false`、`prerelease=false`、相同交付源码及精确四项附件：对应程序包、`BUILD.json`、`PROVENANCE.json`、`SHA256SUMS`。Core 先公开并保持 latest，SMTP 未取得 latest。没有手动上传新源码归档，历史标签和附件保持原样。正式发行是版本交付状态，不是生产就绪结论。

更新接口和真实 MySQL 审计、隔离 HTTP/资产回归已通过；浏览器仅检查本地版本页，主机工具只核验、锁定和暂存，**未执行用户主机安装、迁移或自动回退**。文件备份 SHA/gzip/metadata 检查不证明数据库内容或隔离恢复。当前工作区不带凭据的正式客户端实读返回不可用，独立 DNS 查询无法解析固定 `api.github.com`；未改 DNS/代理/传输策略，也不把该实读写为成功。来源一致性和 TLS 不是独立发行签名，具体边界见 [UPDATES.md](UPDATES.md)。

此前 [a48cee8 CI 38606157488](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38606157488) 在描述符 canary 身份阶段失败，未放行发布。修复隔离测试身份、启动与诊断后，重新以 `b7699f9` 完成上述检查；旧失败不重写为通过。下列 rc 记录仍作为历史证据保留。

已纠正的历史测试缺陷：旧 `test-backup-native.sh` 在 `if rg ...` 中把缺失工具的退出码 127 当成“无匹配”，因此此前该夹具输出的泄露扫描 PASS 不能作为扫描已执行的证据。此问题不替代或否定独立原生恢复中记录的表数据哈希，但相关泄露扫描必须在修复后重新执行并以新 run 为准。

## 选购流程与完整云端验收

已验证源码：`97a2f72b36f4aa4a0954a1406f36a65c64c21dc4`。[Run 38575990819](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38575990819) 的[应用与浏览器检查](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38575990819/job/115893100080)和[独立 Go 扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38575990819/job/115893100530)均成功。

| 验证项 | 实际结果 |
|---|---|
| Go 与数据库 | race 64 个顶层 + 75 个子测试，0 失败、0 跳过；真实 MySQL、vet 与 Linux amd64 编译通过 |
| 前端 | 97 项测试、类型、生产构建和格式检查通过；新增应用级延迟币种响应回归，修复前可复现组件卸载和选择丢失 |
| 独立回归 | Python CI 158 项、许可证清单 4、启动配置 9、演示 HTTP 13 项通过 |
| 备份测试扫描 | 无 ripgrep 时执行真实 grep 扫描；缺失 grep、错误退出码 2/127、实际注入标记均被对应回归正确拒绝；本次日志没有缺失命令错误 |
| 原生服务与恢复 | systemd、验证证书的 Nginx HTTPS、DML/迁移权限分离、API 重启与同 schema A→B→A 通过；原库和恢复库分别通过 21 项 HTTPS 测试，4 个已有订单保留 |
| 数据与 SMTP | 13 张表完整数据哈希一致；关闭状态的加密 SMTP 设置恢复后可解密且配置有效，未发送外部邮件 |
| 浏览器 | Google Chrome 155.0.8059.39；沙箱开启；1440×1100 桌面与 390×844 手机交互、地区筛选、币种切换保留选择、摘要金额/布局、下单与历史快照、管理员设置、SMTP 默认关闭检查通过 |
| 浏览器证据 | 12 个合成截图及各自 SHA-256 记录在该 run 的 `browser-acceptance-38575990819-1` artifact；未逐张人工视觉审阅 |
| 清理与扫描 | 原生和浏览器自有资源清理成功；npm 审计 0；Go 可达函数/导入包 0，模块级告警 19，范围见下文 |

Chrome 执行前校验了已安装包的 255 个文件，并收紧可写权限；这是同一 runner 内受保护的安装记录一致性检查，不是新增包来源认证。版本命令的标准输出与私有警告分离，未关闭沙箱或改变系统沙箱策略。浏览器连接独立回环内存 demo，不将其计入真实 MySQL 的 HTTPS 测试；该 run 没有向外部服务商发送邮件或发起真实付款。

## SMTP 首轮原生验收

已验证源码：`86288e3627bdc8f4cb937c1c235633e8c0db4af4`。[Run 38563825244](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38563825244) 的[应用检查](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38563825244/job/115851338909)和[独立 Go 漏洞扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38563825244/job/115851339569)均成功。这是 SMTP 首轮验收的历史证据；新的选购界面与浏览器结果见上方记录。

| 验证项 | 实际结果 |
|---|---|
| 环境与数据库 | Ubuntu 24.04 / amd64；四个官方 MySQL 8.4.11 DEB 按固定大小、SHA-256 校验后提取，原生初始化与 Unix socket 连接通过 |
| Go | Go 1.27.2；race 64 个顶层 + 75 个子测试通过，0 失败、0 跳过，包含真实 MySQL 回归；vet 与 Linux amd64 编译通过 |
| 前端 | Node.js 24.19.0；84 项测试、类型检查、格式检查和生产构建通过 |
| 独立回归 | Python CI 112 项；许可证清单 4、启动配置 9、演示 HTTP 13 项通过 |
| 原生服务与业务 | systemd API、Nginx HTTPS、私有测试 CA 和权限检查通过；21 项 HTTPS 测试通过 |
| 重启与切换 | API 重启及同二进制/schema 的 A→B→A 目录切换通过，4 个已有订单保留 |
| SMTP 配置与恢复 | 保存关闭状态的加密凭据；恢复后管理清单 `configured=true`，证明匹配密钥下凭据可解密且配置有效，保持关闭且未发送外部邮件 |
| 备份与数据一致性 | 实际备份、checksum/gzip 校验、同一 MySQL 实例中新空库恢复通过；包括 SMTP 设置的 13 张表完整数据哈希一致 |
| 恢复后业务 | API 切换到恢复库，再通过 21 项 HTTPS 测试 |
| 清理 | 测试与清理退出码均为 0；自有测试资源已移除 |
| 审计与工作流 | npm 审计 0 项已知漏洞；工作流检查通过；独立 Go 扫描范围如下 |

Go 扫描报告 **0 项可达函数、0 项导入包、19 项模块级告警**；余下告警来自应用未导入的 `x/crypto` SSH/OpenPGP 包，不能概括为“依赖无已知漏洞”。结果仅覆盖对应源码、构建配置和当次漏洞库快照，详细工具版本与输出见扫描 job。

SMTP 回归使用回环 SMTP/TLS 夹具，覆盖管理员 HTTP、加密保存、本机可信测试 CA 下的传输与接受，以及失败边界；没有向外部服务商或真实收件人发送邮件。SMTP 的 `accepted` 仅表示服务器接受，不能证明收件箱投递、SPF/DKIM/DMARC 或实际服务商配置有效。

## 验证范围

原生验收使用一次性 GitHub-hosted runner 和合成数据，没有连接外部业务主机、真实支付或 VPS 服务。HTTPS 使用 localhost 与临时私有 CA，没有测试真实域名、公共 CA 签发或续期。API 重启和 A→B→A 使用相同二进制及 schema，不证明不同应用版本间的迁移回滚。

备份恢复目标是同一实例的另一新空库；没有重启 MySQL 进程或整机，也没有验证独立实例、异地加密副本、断电恢复、PITR、容量或生产 RPO/RTO。当前浏览器结论是自动化交互和布局断言，不代表所有设备、完整无障碍或人工视觉验收。宝塔适配操作见 [BAOTA.md](BAOTA.md)，尚无实际面板运行结论。

具体发布与双构建结果以对应 Release 中的 `PROVENANCE.json` 和构建运行链接为准；只读 CI 不创建 Release，也不部署主机。新源码按 [发布要求](RELEASE.md) 重新生成并核对归档，历史候选的原文件和哈希保持不变。

## 应用与原生验收基线

以下为 SMTP 实现之前的历史基线，源码 `00654f431b070c44b8442fff71a18cdd65b29999`：[Push run 38557196471](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557196471)与[PR run 38557186363](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557186363)均通过应用检查和 Go 扫描。[Push 检查日志](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557196471/job/115829150826)保存原生验收摘要及脱敏 JSON；PR 使用合并测试引用，不与分支 checkout 混为同一源码。

该基线通过 Go race 38 个顶层和 50 个子测试（0 失败、0 跳过）、前端 62 项、Python CI 93 项、许可证清单 4 项、配置 8 项、演示 HTTP 13 项。原生与恢复库各通过 20 项 HTTPS 测试，12 张表完整数据哈希一致；API 重启及同 schema A→B→A 保留 4 个订单，最小权限负向检查通过，自有测试资源清理退出码为 0。这些数量不计入新的 SMTP 验收，也不证明 SMTP 行为。

此后历史候选归档处理新增 19 项离线回归，与原发布守卫 59 项一同通过；旧结果不替代新源码的完整 CI 或实际 Release 上传证据。

## 浏览器与历史候选

历史候选 `0.3.0-rc.1` 的云端 Chromium E2E 通过，浏览器沙箱保持开启。测试经回环 demo API 覆盖中文/English、CNY/USD 独立偏好、下单及历史快照、禁用支付、手机导航与管理员设置保存；检查了 1440×1100 和 390×844 截图，未出现页面错误或手机横向溢出。这不代表所有设备、完整无障碍、当前界面、宝塔环境或真实业务主机已验收。证据为 `/workspace/aster-validation-20261014/browser-final.log` 与同目录 `browser/`。

旧版本的构建、失败排查和阶段交付详情保存在 Git 历史与对应 Actions 记录中，不作为当前安装步骤。历史候选不覆盖、不改名；新源码重新构建并记录来源及哈希。
