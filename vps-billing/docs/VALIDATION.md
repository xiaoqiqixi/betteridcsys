# 验证记录

各项结果绑定实际执行时的提交、日期和 GitHub run；后续源码或界面修改不沿用旧提交的通过结论。

## Core 0.5.1：安装准备、只读预检与未付取消

[Core v0.5.1](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/v0.5.1) 已于 **2026-10-15 02:57:17 UTC** 正常公开，Release ID **413373046**，非草稿、非预发布，latest 指向 `v0.5.1`。标签与发布来源均为 `91cc3c18e50b51f01ca0003e3d18de3ade69f25d`（下称 F）；[源码完整 CI 38672137982](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38672137982)、[标签构建 38672929446](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38672929446) 和[发布 38673669158](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38673669158) 均完成成功，相关全部 job/步骤通过。发布仅生成正常发行资产，没有执行部署。

### 实施范围与边界

本轮复用既有系统，补齐明确版本的主机准备器 `core-manager.py prepare`、只读主机事实 `doctor`、生产 CLI 的 `-preflight` / `-schema-status`、自动机器备份元数据 `BACKUP.json`，以及权限和状态受限的未付订单取消。取消只在付款适配器禁用、订单/唯一配对账单和未处理创建事件一致、无未知服务或处理历史等条件下原子执行，同时作废配对账单并保留金额、历史快照和审计；不能用于退款、修改已付状态或撤销真实开通。

全新安装默认 CNY、运营者配置独立币种/价格、升级保留既有 USD 与历史快照的规则保持不变；没有汇率或自动换汇。当前仍为七项迁移、14 张基础表，本轮没有新增迁移或破坏性降级。

`prepared` 只表示经官方来源/资产验证的新完整目录已准备。prepare 不执行包内程序、不切 `current`、不启停服务、不创建身份/秘密、数据库或首位管理员；`manifests/PREPARED.json` 是明确标记的本地准备回执，不冒充官方资源清单或独立发布者签名。首次使用须审阅新资源中的工具和摘要，旧 0.5.0 检查器的受信清单不会自行升级或放宽。`doctor` 只读主机事实，不运行程序、不连接数据库或占用端口；数据库预检只读且不等于服务、业务、完整授权或恢复已验证。系统/数据库身份、秘密、迁移、首次管理员、systemd/Nginx 与真实 HTTPS 切换仍由主机管理员明确执行。Web 更新入口继续只做版本检查与审计交接，主机 updater 继续只做 stage/status；没有 Web root 权限、完整安装/升级执行器、自动应用或数据库自动回滚。

### F 的完整源码 CI：通过

[主检查 116217489488](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38672137982/job/116217489488)、[Go 扫描 116217489637](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38672137982/job/116217489637) 和[官方元数据 116217489641](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38672137982/job/116217489641) 均完成成功。下表只使用 F 的实际日志和脱敏 JSON，不沿用失败候选或历史版本的结果：

| 检查 | F 的实际结果 |
|---|---|
| Go / MySQL | race 559 个 PASS、0 个 FAIL、0 个 SKIP，含 158 个顶层测试及子测试；真实隔离 MySQL、vet、静态 Linux amd64 构建与依赖边界检查通过 |
| 前端 | 12 个测试文件、305 项通过；类型、生产构建及格式检查通过；曾单独运行的 97 项为该 305 项中的子集，不重复累加 |
| Python / 工具 | 编排 200、清单 8、插件管理 39、updater 44、Core 准备器 20、生产配置 9、回环安全/HTTP 14 项，共 334 项 required regressions 全部通过；再加原生 HTTPS 22、恢复后 HTTPS 22，共 378 项全部通过 |
| 语法与供应链检查 | Shell/Python/工作流检查、mock 备份回归通过；npm audit 报告 0 vulnerabilities；Go 扫描实际报告受影响代码 0、导入包 0、依赖模块 19 项漏洞；19 项未发现被本项目代码调用，不等于模块完全无漏洞 |
| 实际公开 Core prepare | 选中正常公开 Core **0.5.0**，源码 **`6be81aaed4868adb3c60b30accbfd87d0bb899c5`**；真实官方 Release/成功构建/来源/六资产完整性核验后得到 `prepared`，未执行所下载程序、未切活动版本，数据库和服务动作均为 `none` |
| 只读主机与空库预检 | `HOST_DOCTOR_JSON` 为 `read_only_host_facts`；`PREFLIGHT_EMPTY_JSON` 为 schema 0、`empty_target_scope=base_tables`、表可见性已验证；预检后另断言 `information_schema.TABLES` 中该库的表/视图计数仍为 0；该断言不覆盖存储过程、事件等其他对象 |
| 当前库预检 | `PREFLIGHT_CURRENT_JSON` 为 schema 7、管理员数 1、待迁移为空；七项已应用迁移 checksum 均验证 |
| 备份与恢复 | `BACKUP_METADATA_JSON` 绑定实际 F 源码 BUILD、schema 7 和七项匹配预检的 checksum；源库与恢复库均为 14 张表，完整数据比较一致，恢复后 22 项 HTTPS 回归通过 |
| 服务持久化与目录切换 | 重启前六项订单持久化；API 重启和同 schema 的 A→B→A 受控目录切换通过，不证明跨版本数据库降级 |
| 独立 SMTP 插件 | 9 项检查、0 失败、0 跳过；11 阶段磁盘/存活 Core API 摘要均与 F raw API 一致，PID 不变，插件安装/升级/回退/受控崩溃过程中未重编或重启 Core |
| 原生清理 | `test_exit_code=0`、`exit_code=0`、`owned_resources_removed=true`；runner 自有临时资源清理成功 |
| 浏览器 | Chrome `155.0.8059.39`、要求 sandbox、固定 F 源码的脚本执行成功且清理成功；16 项截图文件名/大小/SHA-256 元数据有效，未下载或查看图片，不冒充人工视觉审查 |

F 的实际 raw、磁盘及存活 API SHA-256 均为 `98db08567ec86c0e1d0745e94c6ead3a8c5c1ffbcf2378ed74afd553a53a9d7b`。实际公开 prepare 的对象是旧公开 Core 0.5.0，原生服务/备份/恢复的对象则是 F 源码现场构建的 Core 0.5.1；二者各有来源绑定，不能把旧版本 `prepared` 写成新版本已经安装。公开 prepare 使用经护栏确认的一次性 GitHub-hosted runner 和最小只读 token，不使用伪造 `PROVENANCE.json`，不执行下载的二进制，不据来源/完整性检查宣称存在独立发布者签名。

五类新证据 `HOST_DOCTOR_JSON`、`PUBLIC_CORE_PREPARE_JSON`、`PREFLIGHT_EMPTY_JSON`、`PREFLIGHT_CURRENT_JSON`、`BACKUP_METADATA_JSON` 均在 F 对应阶段完成后实际输出。备份绑定的迁移版本 1–7 checksum 分别为：

| 版本 | SHA-256 |
|---:|---|
| 1 | `820c7dd58337da334097016a5278f2e31919766c76de896dafe199f2319a353c` |
| 2 | `43713837a1d1649f6011e0b7210ea063a03e5b308b71c17cf01120bf96f85fa8` |
| 3 | `a934b302afadb514de6e792d86d401d32185c974f93296889ca891709999b14e` |
| 4 | `8299e2463116256c84340cc578c209cde4685fd1972f636f5788b1014d397feb` |
| 5 | `38db56389f071bf9a81b8885128930a8039eb1908c61e32fd70d910678ceb083` |
| 6 | `60531806ef1ac55ce38bad09e95a3c03789bc46e2db7869f7c212a606381feab` |
| 7 | `a4e073da363299a5c0f6d231219a30003d57afa33c0fdae2bc38e244b06ba5bf` |

SMTP 原生场景为 `1.1.0 → 测试 1.1.1 → 1.1.0`，只接受两封回环 TLS 合成消息，未转发到外部；DATA 后受控崩溃保持“投递不确定”且不自动重发。测试 1.1.1 不构成正式插件发行，SMTP 1.1.0 正式资产没有更新。

浏览器摘要本身不逐项枚举取消场景。对固定 F 源码的 `frontend/tests/e2e.mjs` 成功执行和源码复核，确认其客户/管理员真实 UI 取消调用（第 897/917 行，共用 helper 第 130 行）包含对话框校验、一次 POST、订单取消/账单作废、概览金额、服务保持、单条审计与幂等重放断言。浏览器运行于回环内存 demo，外部请求被阻断；不能据此替代原生持久化数据库回归或真实付款测试。

### 失败迭代与修复依据

保留失败和取消记录，不将后续修复回填为旧 run 成功：

| 源码 / 运行 | 实际终态、根因及修复范围 |
|---|---|
| A `93f6d994f4b4fd9e8623ae2d81a655e005cecf05` / [38668093106](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38668093106) | 失败；Go 498 PASS、15 FAIL、0 SKIP，包含父/子测试，两个顶层失败。取消异常夹具在同一所有者下留下损坏邻居快照，12 个后续子场景在建立夹具时被全量订单读取提前阻断；修复夹具隔离/读取，不接受损坏数据。schema 前缀检查误把迁移 4 才引入的 `services_currency` 约束要求于前缀 3；按真实迁移生命周期修复，SQL/checksum 未改。前端/Python/原生/浏览器未执行到 |
| B `8a0ee4d34f76dd6495b595a8f7d7c38d2a040d98` / [38669136092](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38669136092) | 失败于生产配置冒烟；Go 516/0/0（154 顶层）、前端 305/12、Python 199+8+39+40+20 及 mock 备份通过。9 项启动拒绝测试中 2 项因错误文案不符失败：未知 provider 已在 DB 前拒绝，但返回 `invalid integration provider selection`，旧断言要求 `integration configuration`。C 恢复既有通用消息，早期拒绝不变。原生/公开 prepare/浏览器未执行到 |
| C `54ec61a11ee104dbfcb8e8c2e4fb7fddec9123d3` / [38669842637](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38669842637) | 主回归通过，原生失败；Go 516/0/0（154 顶层）、前端 305/12、Python 329 全通过。实际源码 raw 包构建后，旧 GitHub token 格式限制误拒临时只读凭据，未进入公开版本选择/doctor/prepare、原生 preflight/HTTPS/备份/插件/浏览器。清理为 1/1、owned resources 已移除 |
| D `cf908205781ec4a87552152c92f066aee36e3293` / [38670909306](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38670909306) | 实际终态 cancelled，主检查第 6 步期间取消，没有观察到测试失败或取得完整通过；独立扫描/元数据和 runner 清理成功。不把取消写成路径故障 |
| E `e7ad7a5dde202f2fa96fc5150ee194c4a5714675` / [38671113923](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38671113923) | 主回归通过、原生备份失败；Go 559/0/0（158 顶层）、前端 305/12、Python 333、原生 HTTPS 22、插件 9/0/0 通过，API 重启/同 schema A→B→A 完成。公开 prepare 与预检断言执行，但失败前未打印实际选择版本/来源及新 JSON 正文，不能补造为预期 0.5.0。实际备份报 metadata 不可读/无效，恢复未执行到；清理 1/1、owned resources 已移除；npm/浏览器/该 run 工作流检查未执行到 |

本轮实际资源双构建还发现历史归档兼容缺口：101 字节 npm 许可证完整路径会让 GNU tar 产生 `././@LongLink` 的 `L` 名称记录。读取器仅接受严格限长 ASCII、单一末尾 NUL、零填充、固定 marker/头部、立即匹配普通成员的历史形式；继续拒绝链式扩展、链接、PAX、稀疏记录、穿越、重复及资源内 ELF。新生产者改用 ustar 前缀格式。实际 A 资源 176 文件和旧 0.5.0 资源 174 文件通过同一受限解析 helper；F 的实际公开 prepare 另证明旧公开版本的完整来源/资产核验。归档恶意头部回归及独立复核的 33 个畸形变体全部拒绝，不把辅助复核数量累加到主套件。

C 的 token 故障修复依据为实际读取的 [GitHub 2026-04-24 官方通知](https://github.blog/changelog/2026-04-24-notice-about-upcoming-new-format-for-github-app-installation-tokens/)：安装 token（包括 Actions）转为长度可变、约 520 字符的不透明格式。Go/Python 读取器现接受 1–4096 字节 RFC 6750 ASCII token，可有一个末尾 LF/CRLF，原始受限文件上限 4098 字节；不假定前缀或内部声明，不解析 JWT。私密文件属主/权限/链接、固定官方来源、重定向凭据隔离检查保持严格，没有查看或打印实际凭据。最大长度正向用例曾因本地根目录 UID 65534 不满足原安全夹具而跳过 1 项；F 托管 Go 回归实际 0 SKIP，未放宽根目录信任。

E 的固定 `/releases/latest` 读取路径缺口在 D 相关步骤执行前离线发现；只增加该固定官方仓库的只读动作并检验精确 URL/MAX_JSON。query、额外路径、列表或其他动作继续拒绝，生产 prepare 仍必须显式版本，不增加 latest 自动安装或任意 URL/执行器。

E 的备份失败由实际资源权限确认：umask 077 加 `tar --no-same-permissions` 后得到 0700/0600，再由 sudo 复制使 BUILD/SQL 成为 root 私密文件，普通备份身份无法读取；实际 BUILD、七项 SQL、14 张表内容有效。F 只修正 CI 完整公开资源夹具的模式（目录 0755、文件 0644、六个批准程序/脚本 0755），以普通 runner 实测 BUILD/SQL 可读，并增加真实权限回归。生产备份保护不放宽；新 JSON 改为阶段完成即输出，避免后续失败掩盖已完成事实。F 完整恢复通过另有实际证据，不把 E 的失败改写为成功。

较早本地全量 Go 曾为 366 PASS、121 DB SKIP、0 FAIL，只作辅助工作区记录；F 真实 MySQL 的 559/0/0 才是冻结源码门禁。四份部署指南曾检查 50 个本地链接/锚点和 24 个 shell 片段；本地静态检查不能替代用户主机部署。

### F 的本地重复构建：已完成

F 两次独立 Core 构建五项未封装输出对应字节一致；176 个资源文件的源码复制与该 Git 提交匹配，含七个 SQL，资源内 ELF 为 0。以下为本地实际摘要与大小；F 原生运行的磁盘/存活 API 摘要另经 CI 记录，与该 raw API 一致，与下方正式 Release 六资产核验分别记录：

| F 的本地未封装产物 | 大小（字节） | 实际 SHA-256 |
|---|---:|---|
| `aster-api-0.5.1-linux-amd64` | 8921248 | `98db08567ec86c0e1d0745e94c6ead3a8c5c1ffbcf2378ed74afd553a53a9d7b` |
| `aster-plugin-host-0.5.1-linux-amd64` | 4853920 | `446b763589036d2221ad309ac9c442127bb5e710b1fb90d21b3403ce3a4c6dd4` |
| `aster-core-0.5.1-linux-amd64-resources.tar.gz` | 340898 | `23dd65a22503371d22050d96dca24258bc3e3bd119ab32d12c649047cf0c9ee4` |

五项本地输出为 API、插件宿主、资源、BUILD 与本地 SHA256SUMS，没有真实 `PROVENANCE.json`。实际标签构建另完成两次干净构建、两次来源封装，封装前和封装后的递归字节比较均通过；正式封装绑定实际标签构建 run。两种环境各自的双构建字节一致，不声明跨环境资源归档/BUILD 字节一致，也不把来源证明写成独立发布者签名或用户主机安装证明。

### 正式发行六资产与构建边界

实际标签构建 [job 116219973662](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38672929446/job/116219973662) 重新完整通过 Go 559/0/0、前端 305/12、Python 378、插件 9/0/0、14/14 表数据一致恢复、sandbox 浏览器 16 项截图元数据及零退出清理；其公开 prepare 实际仍选发布前已公开的 Core 0.5.0。两次构建/封装比较及上传成功后，[发布 job 116222282969](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38673669158/job/116222282969) 校验策略和来源并成功公开 Release 413373046。发布后文档提交的验证状态以该提交的 GitHub commit status 与外部交接记录为准；源码/标签运行中的旧版 prepare 结果不冒充公开 0.5.1 的准备结果。

以下为实际正常公开 Release 的六资产大小与 GitHub API SHA-256；安装核验以这些正式发行值及对应真实来源为准：

| 正式资产 | 大小（字节） | 公开 SHA-256 |
|---|---:|---|
| `aster-api-0.5.1-linux-amd64` | 8921248 | `98db08567ec86c0e1d0745e94c6ead3a8c5c1ffbcf2378ed74afd553a53a9d7b` |
| `aster-plugin-host-0.5.1-linux-amd64` | 4853920 | `446b763589036d2221ad309ac9c442127bb5e710b1fb90d21b3403ce3a4c6dd4` |
| `aster-core-0.5.1-linux-amd64-resources.tar.gz` | 340896 | `899565236ac310c2a45c77f44e2bb7fff6e20a6529083e223a10f884e6725bcf` |
| `BUILD.json` | 6980 | `7cf46cfee6e424c632ecd90afc092454da8f6f6cc626ef73c48db480d04b33d9` |
| `PROVENANCE.json` | 3480 | `69f21c8f3ec97399fdb0fc1e1a4ad36214264f1d2b0cbb381d1b506b236736c2` |
| `SHA256SUMS` | 467 | `880769cc47e4a135b0888262a4835524f6b30945d0fd7b4da811b30b99d909fe` |

两个 raw ELF 的公开摘要与本地核验字节一致；其中 API 摘要还与原生验收的磁盘及存活程序一致。公开资源为 `899565236ac310c2a45c77f44e2bb7fff6e20a6529083e223a10f884e6725bcf` / 340896 字节，和本地资源 `23dd65a22503371d22050d96dca24258bc3e3bd119ab32d12c649047cf0c9ee4` / 340898 字节不同；BUILD 也不同。本地 BUILD 记录 npm `11.9.0`，实际标签构建日志记录 npm `11.17.0`，工具元数据环境不同，因此只声明各环境内部的重复构建一致，不声称跨环境资源或 BUILD 完全相同。

本轮仅发布 Core `v0.5.1`，仍为原始 API、插件宿主、资源归档及三项元数据共六资产；SMTP `smtp-v1.1.0` 仍为五资产，没有重发或修改。独立公开库存核验确认六个既有 Release（`v0.3.0-rc.3`、`v0.3.0-rc.4`、`v0.4.0`、`v0.5.0`、`smtp-v1.0.0`、`smtp-v1.1.0`）及全部原附件保持不变。Git 源码和 LICENSE 保留，没有手动附加新源码包，也没有下载被拒绝的 Actions 候选 ZIP 或截图。

### 参考阅读与未验证范围

实际参考范围见 [REFERENCE_SCOPE.md](REFERENCE_SCOPE.md)。用户指定的 `https://www.idcsmart.com/wiki_list/479.html` 没有读到内容：浏览器工具不可访问，之后一次普通请求遇到网络隧道 403，已停止且没有重试绕过。官方安装、下载、升级、迁移恢复、订单、账单章节已分别实际读取；相关章节不能写成已读取原 479 页面，也不据产品页面推导对方内部安全实现或本项目验收结论。

全部验证限 GitHub-hosted Ubuntu 24.04 隔离环境和合成数据，浏览器为回环内存 demo。没有用户服务器或宝塔实际面板部署，没有 Mac、真实付款/退款、外部邮件、VPS/控制器动作、生产容量或人工截图视觉验收。私有 CA 的 localhost HTTPS 不证明公共证书签发/续期；API 重启和同 schema A→B→A 不证明数据库进程/整机重启、真实跨版本降级、独立实例/异地恢复、PITR、断电持久性或生产 RPO/RTO。预检只证明其限定配置、可见基础表和已知迁移前缀，不能证明完整业务/授权/运行时就绪。BACKUP.json、prepare 回执、文件摘要和 schema 结果均不构成运营认证。既有 Contributors/下载拒绝未重试绕过，未下载被拒绝的 Actions 归档或截图。

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
