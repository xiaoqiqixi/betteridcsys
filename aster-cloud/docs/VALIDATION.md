# 开发验证入口与历史记录

验证结论绑定精确源码与执行环境，不随 `main` 更新自动继承。本页先列当前本地安装器安全测试，再列精确历史源码；历史日期段落保留原轮次的数量、工具链和限制，不是当前完整测试数量。Cloud 的独立预发布不等于稳定版或真机验收；财务 v0.5.9 发行包不因这些记录而改变。

## 当前工作区：官方通道与 libvirt 自动准备

本轮只改 Cloud 安装 / 打包 / 发布 / 测试 / 文档，不改 Cloud Go 业务或迁移，更不改财务源码。
精确 main 提交、官方 CI 与 Release 的结果须逐层核验，不能由本地模型测试推导真实安装成功。

| 门禁 | 范围 | 不覆盖 |
| --- | --- | --- |
| installer / provision 离线安全测试 | 归档、恢复审批、固定依赖、libvirt units/masks/挂载视图及已有服务只读边界 | 实际发行版包脚本 / kernel / systemd 语义 |
| 独立 publisher verifier 负例 | 缺失或伪造 receipt、错误来源/身份/版本、相邻代码篡改、输入边界 | 模型输出不是实际加密验签 |
| Ubuntu 22 / 24 Linux unit 中匿名实签名核验 | 固定版本 gh、固定信任根、本地 Sigstore proof；无用户登录、无隐式下载或缓存写入 | 不是本项目新 Release 已发布 |
| Ubuntu 22.04 / 24.04 / 26.04 隔离 TCG guest | 官方镜像签名及 SHA，真实 APT、systemd、libvirt、禁止默认网络、只读 namespace、宿主网络不变 | 没有 KVM 加速，不创建客户虚拟机，不证明物理网络可用 |
| 同提交现有 CI | 真实独立 MySQL、严格 TLS 浏览器、NAT namespace 包流、OVS parser、前后端与依赖扫描 | 节点 RPC / 部分执行器仍为受控替身 |
| 官方预发布后匿名下载 | 两角色实际 GitHub 资产、Sigstore 来源、完整字节、认证安装器生产 plan | 不执行生产主机 apply / service start |

已实际执行的本地结果（2026-10-25）：installer 安全测试 **108**、安装器 unit **14**、packager **25**、
release 合同 **25**、独立 verifier **19**、native fixture 合同 **24** 均通过；它们以模型 / 临时目录为主，不是真实安装。
前端 format / typecheck / **37 文件 892 tests** / production build 通过。Cloud 全部受跟踪 `cmd` / `internal` / `plugins`
包 Darwin race 与 vet 通过；未配置 MySQL 的本地场景不是实库验收。三个 workflow 的 actionlint 1.7.7 与 Python 3.10 AST 通过。
最初本机 `go test ./...` 因 ignored 历史证据中的孤立 Go 测试文件和沙盒禁止监听失败，保留失败日志；
随后按全部受跟踪包范围、允许仅测试 loopback 监听重跑通过，没有删历史证据或放宽业务断言。

首轮精确提交 `766c055` 官方结果：财务 **3/3** 通过；Cloud **7/12** 通过、**5/12** 失败，
不计完整验收。实库 / 严格 TLS 浏览器为163项业务 +53项导航、64张PNG，历史财务 / 网络快照保留，节点RPC仍为替身。
两项 Linux unit 在 ShellCheck SC2024（普通shell有意读取review脚本、sudo消费stdin）处失败，后续匿名验签未执行。
Ubuntu24/26确实进入guest，但APT simulate非零；22达到TCG总时限，不能猜成网络波动或KVM不可用。
首轮还暴露失败JSON误套成功schema、宿主差异覆盖guest原因的问题。后续补固定诊断 / 阶段心跳，并收紧APT update
为任何索引失败即停止；未放宽签名、TLS、无升级 / 移除、无默认网络或真实doctor门槛。修复提交仍须全套重跑。

`cloud-v0.1.0-rc.1` 仅作为候选预发布，不能声明生产可用。下载命令以[该 Release](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/cloud-v0.1.0-rc.1)
实际正文为准；若未发布或任一最终 gate 失败，不称通道验收完成。发布协议见[RELEASE_CHANNEL](RELEASE_CHANNEL.md)。
本轮原始结果及脱敏回执留在 ignored `artifacts/native-channel-20261025/`；源码文档不预填尚未执行的成功结果。

下列“开发安装器”与旧 UI 段落保留各自历史阶段记录，不代表新增通道 / libvirt 的当前结果。

## 历史阶段：新管理工作台

- Gemini 原稿只提供视觉设计；生产使用独立 `WorkbenchHeader` / `InstanceLedger` 视图，仍接原有 API、session、RBAC 与持久化操作意图，不引入演示数据源或计时成功。
- 本地完整执行 format、typecheck、**37 文件 / 892 tests** 和生产构建；`npm audit` 当前报告 0 vulnerabilities。已移除侧栏/重复顶栏，手机不再隐藏实例节点，详情、浮层与控件统一语义色和轻边界。
- 本地实际浏览器的合成 DTO 视图用于检查手机/桌面布局、中英文、长名称、完整 ID、44px 目标与浅深主题；这些不是实库、真节点或生产部署证明，原型和截图不打进生产 bundle。
- 同提交的真实 MySQL / 严格 TLS 浏览器及不变性门禁必须独立执行。新的导航门禁要求 53 项（中文浅色37 / 英文深色16），业务门禁为163项（原162项全部保留，新增390/320px公网IP标题动作实际满行、对齐与单行文本检查），保留13个网络版本、原请求/财务/网络快照和64张互不替代的截图要求。新检查待精确提交 CI 执行；当前源码不能继承旧51项侧栏报告。
- 新增 `deploy/ci/test_cloud_mysql_grants.py`，只接受原生 CI 私有 MySQL fixture：实际 RANDOM PASSWORD / ATTRIBUTE / SHOW GRANTS、全部10份迁移 SQL 与外键、runtime 四项 DML 和拒绝 DDL/越库授权。仅临时替换测试传输，不绕过生产 root/文件属主保护；非 fixture 拒绝退出而不是跳过。完整安装器、Ubuntu包脚本和 KVM 真机验收另行进行。
- 当前 main 精确源码的 CI 运行见 [Controller development checks](https://github.com/xiaoqiqixi/betteridcsys/actions/workflows/cloud.yml)；必须核对运行所指向的 SHA 与结果，不把本地通过或旧运行当新完整验收。

## 当前工作区：开发安装器安全测试

> 本节为正式通道 / libvirt 增量之前的历史阶段记录；旧计数与“尚未开放”仅指当时实现。

本段记录已实际运行的本地开发检查，**不把未提交工作区或旧源码 SHA 写作新部署/发行验收终点**。
独立 Cloud 正式 Release 与官方安装下载通道尚未发布，财务 `v0.5.9` 不能替代主控或被控开发包。

| 检查 | 当前结果 | 明确边界 |
| --- | --- | --- |
| `deploy/ci/test_cloud_installer.py` | 93 tests 通过、0 skip | 合成归档、私有测试文件系统及 APT/MySQL/systemd/网络替身；含 legacy receipt 禁止 resume 新增宿主副作用 |
| `deploy/install/test_install.py` | 10 tests 通过、0 skip | TLS pair/SAN/有效期分支、固定命令/来源边界、文件模式/回执恢复及真实 migration SQL 的 FK/REFERENCES 权限对照；不替代原生安装 |
| `deploy/scripts/test_cloud_package.py` | 23 tests 通过、0 skip | 开发包合同、安全成员/权限与可复现规则；不证明发布者身份或生产升级兼容 |
| 静态入口 | shell 语法、Python 语法/AST、diff 检查通过 | 未执行目标机 apply；三组测试不相加宣传为独立真实业务验收场景 |
| 真实开发制品只读检查 | 两角色真实编译包通过外部 SHA、manifest 与 plan/dry-run | 是本地候选包，不是正式下载资产；其旧 UI 不能用于本轮新 UI 最终截图/API 验收 |

`59367c2` 的两个 Linux unit job 因夹具读取真实 runner 的 fresh-host 证据而失败；
本轮只更正测试隔离，另直接调用真实守卫覆盖已有工作负载与节点内存/KVM 拒绝，
未放宽生产限制。上述为本地结果，后续精确提交的 CI 尚须重新核验。

打包验证时的已提交源码为 `be617c8`，候选包版本为 `0.1.0-dev` / `linux-amd64`。这个来源说明
只绑定候选制品，不表示当前安装器、新 UI 或当前工作区获得了该旧源码的全部 CI 结论。
本机临时目录为 `/private/tmp/aster-cloud-package-real.frhGdh1n/candidate-two/`；它不是下载地址，
文件也不会自动出现在另一台 Ubuntu 主机。

| 已核验本地制品 | 完整外部 SHA256 |
| --- | --- |
| `aster-cloud-controller-0.1.0-dev-linux-amd64.tar.gz` | `a3e1e5365205a5e77799d5c847bc717fa2836dfdd0f92b3b9177409955f9a8e6` |
| `aster-cloud-node-0.1.0-dev-linux-amd64.tar.gz` | `85a1b2c14865776be968875499adc60f8fadcfbc17ccb81fe2268ee5ced85c68` |

以下是**本机已有制品**实际运行过的单命令只读入口，从仓库根目录执行；不是可复制到任意服务器直接上线的命令，
也不能将旧包 hash 用于新构建：

```sh
python3 aster-cloud/deploy/install/install.py controller --plan --allow-development --bundle /private/tmp/aster-cloud-package-real.frhGdh1n/candidate-two/aster-cloud-controller-0.1.0-dev-linux-amd64.tar.gz --sha256 a3e1e5365205a5e77799d5c847bc717fa2836dfdd0f92b3b9177409955f9a8e6
```

```sh
python3 aster-cloud/deploy/install/install.py node --dry-run --allow-development --bundle /private/tmp/aster-cloud-package-real.frhGdh1n/candidate-two/aster-cloud-node-0.1.0-dev-linux-amd64.tar.gz --sha256 85a1b2c14865776be968875499adc60f8fadcfbc17ccb81fe2268ee5ced85c68
```

目标机的单命令交互入口是本地审核后的 `deploy/install/controller.sh` 或 `node.sh`，向导默认 plan；
只有真实本地包、可信 SHA、环境/配置审批与明确 apply/start 才会执行安装。主控可显式选择固定 Ubuntu
依赖和新专用 DB，runtime DML 与迁移 DDL 身份分离；节点仅自动化工具依赖，**完整 libvirt daemon / 默认网络
安装没有开放，干净节点端到端一键就绪未完成**。详情见[安装器](../deploy/install/README.md)、
[包合同](INSTALL_PACKAGES.md)与[安全测试细则](INSTALL_VALIDATION.md)。

**本轮没有执行真实 APT 事务、MySQL provisioning、systemd 安装/重启、KVM/VM 或物理网络验收。**
包 maintainer scripts、socket-only 服务策略、MySQL 8.0/8.4 实际返回/权限与迁移、断电恢复仍须在隔离
Ubuntu 22.04/24.04/26.04 宿主单独验收。节点本机最多报告 `node_started_pending_controller`，须由主控
使用其本地私钥完成真实 pinned mTLS 心跳；不导入 controller 私钥到节点，不拿本地 TCP 监听冒充准入。

新 DB/账号的跨系统 DDL 与本地回执/口令落盘并非一个原子事务。CREATE 已提交但 marker、一次性密码回包或
私密文件落盘丢失时，程序保留对象并停步，由操作者核对；不 reset/drop/adopt 制造“恢复成功”。
新 UI 的真实 API 流程、严格 TLS 浏览器与最终截图有独立门禁，**本节安装器安全测试不代表这些门禁已通过**。下方 `66e2d49` 等历史结果必须
保持原来源与替身边界，不能直接沿用于当前 UI/安装工作区。

## 2026-10-25 · 已核对源码 `66e2d49`

精确提交：[`66e2d49a2f08e119f144c311756342be2a1aaa27`](https://github.com/xiaoqiqixi/betteridcsys/commit/66e2d49a2f08e119f144c311756342be2a1aaa27)。相对 `f58c4bd`，本轮只改管理台、测试、浏览器门禁和设计文档：修复响应式侧栏、短屏菜单独立滚动及完整焦点目标，并改为等待原生 WebCrypto 完成的测试断言。没有修改财务/主控后端、数据库迁移、依赖或工作流，也没有创建标签或 Release。

| 验证层 | 实际结果 | 不能由此推出的结论 |
| --- | --- | --- |
| 管理台检查 | 本地及官方 CI 的格式、类型、32 文件 / 845 tests、生产构建通过 | 不是生产部署验收 |
| 隔离真实 MySQL | 483 顶层 / 2006 子测试，0 FAIL、0 SKIP；race、静态构建与 Go 漏洞门禁通过 | 不是 VM 开通、物理网络或整机恢复验收 |
| Firefox / 严格 TLS / MySQL | 原 162 项业务检查 + 51 项导航检查，共 213；52 张业务 PNG + 12 张导航 PNG，共 64 | 节点 RPC 是确定性测试替身，不是真 KVM；CSS 小视口不等于物理手机或实际 200% 浏览器缩放 |
| 短屏与人工查看 | 四组短屏键盘证明各有 7 个完整、可见、可点击且已聚焦的目标，页面滚动位置不变；人工查看 6 张代表性正式截图 | 没有声称逐张人工检查全部 64 张截图，也没有宣称所有浏览器/设备组合通过 |
| 同 SHA CI | 两条工作流共 12 项必需任务最终全部成功 | 首次 MySQL runner 超时取消不算通过；后续文档/代码提交须另行核验 |

对应 [Read-only CI](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/40118438913) 与 [Controller and KVM node development checks](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/40118438918)。浏览器拒绝未受信任 CA 后，仅在独立私有 Firefox profile 中信任测试 CA，`ignoreHTTPSErrors=false`；未修改用户/主机信任库。产物 ZIP SHA-256 与 GitHub 元数据相符。

导航覆盖 320、390、768、1024、1025、1440 CSS px，真实长业务页的顶部/中部/底部，两种语言/主题的短桌面视口、抽屉焦点循环与 Escape/Back/遮罩关闭、跨 1024/1025 断点清理、skip link 不破坏 hash 路由。小 CSS 视口只证明等效 reflow。复现与断言边界见[浏览器门禁](../deploy/ci/NETWORK_BROWSER.md)。

脱敏回执、失败轮次和截图留在被 Git 忽略的私有证据目录 `aster-cloud/artifacts/sidebar-responsive-20261025/`，不把私钥、口令、Cookie、DSN 或原始业务数据放进公开仓库。当前功能范围另见[架构矩阵](ARCHITECTURE.md)与[更新记录](../CHANGELOG.md)。真实 KVM/OVS 隔离/限速、跨物理节点、公网上联、宿主重启恢复和生产安装仍后置。

## 按专题查阅

| 文档 | 用途 |
| --- | --- |
| [公网入站规则](PUBLIC_INGRESS.md) | schema10 的当前合同、默认拒绝、历史兼容与未验范围 |
| [VM 公网资源](VM_PUBLIC_IP_MANAGEMENT.md) · [公网库存](PUBLIC_IP_MANAGEMENT.md) · [公网 NAT 出口](PUBLIC_NAT_EGRESS.md) | schema8/9 引入的合同及各轮验证边界，不替代上方最新源码结果 |
| [NAT / 网络集成](NAT_NETWORK_VALIDATION.md) · [OVS 集成](OVS_VM_GATE_VALIDATION.md) · [网络增量](NETWORK_VALIDATION.md) | 2026-10-23 起的分阶段实现、失败修正、实测和跳过项 |
| [运维增量](OPERATIONS_VALIDATION.md) · [早期浏览器补验](BROWSER_VALIDATION.md) | 任务/审计/日志及 2026-10-22/23 的历史基线 |

## 2026-10-22 原始验证记录

2026-10-22。本轮仅更新 main，不创建或覆盖标签，不发布独立主控正式 Release。财务 v0.5.9 安装产物不变，Ubuntu22 上既有财务 v0.5.8 服务不升级。真实 KVM 宿主验收按用户要求后置。

## 2026-10-23 后续增量

NAT、后台全局 VPC / 路由 / 阶段恢复、OVS 早期失败隔离的本轮记录见
[NAT 与后台网络验证](NAT_NETWORK_VALIDATION.md)。下列历史数字不代表本轮结果。

网络/IPAM、独立 OVS、实时校验、metrics 及财务资源适配的本轮结果另见 [网络增量验证](NETWORK_VALIDATION.md)。下文旧轮次数量、截图和 CI 不用于替代本轮最终源码结果。

新增资源操作任务精准定位/独立详情、审计精确筛选及绑定分页、004索引安全重入与运行JSON脱敏日志。实际测试、UI未验证项与部署限制见 [增量验收](OPERATIONS_VALIDATION.md)。下面2026-10-22数据保留为其对应基线，不冒充新提交结果。

## 本轮实现范围

独立 Vue 管理台与 staff RBAC、持久实例动作、停止态快照/备份、四阶段冷迁移及流式 mTLS 转运、真实节点状态只读观察、实际操作人审计、财务只读 owner 合同。详见 [功能矩阵](ARCHITECTURE.md)、[API](CONSOLE_API.md)、[主控运维](../deploy/controller-OPERATIONS.md) 和 [被控运维](../NODE_README.md)。下面历史段落的“没有管理台/存储”仅描述上一轮，不代表本轮代码现状。

## 验证记账原则

- 本地 Darwin race 运行未配置 MySQL 的入口和子场景会明确 SKIP；不算实库通过。Ubuntu22 独立 Unix-socket MySQL8.4.13 另跑，财务库不参与。
- 管理 HTTP 回归确实使用 TLS、持久 MySQL、Cookie/CSRF/RBAC，节点动作使用受控 fake；迁移网络回归确实使用两端 mTLS 和真实流式 HTTP，但磁盘为合成数据、执行器为 fake。不能叫真实虚拟机开通/恢复/迁移验收。
- 第一轮 console seed 列数错误、identity 测试 binary 相对 SQL 路径错误、后续 fixture 复用用户冲突和 fault server 迟到请求计数问题均保留失败日志。修正 fixture/同步而不是删用例、放宽状态、加业务重试。最终结果必须单列对应测试 binary SHA。
- 既有财务 controllerapi 与传输包独立 race 回归通过；新的 resource JSON 与原六字段 Result 分离。此轮未改金额、支付、币种、历史订单快照或财务后端源码。

## 冻结源码的实际结果

- 本地 Go1.26.4 / Darwin arm64 全scope race：363 PASS事件，0 FAIL / race warning；13 个实库入口及子场景因未设置DSN明确SKIP。vet、固定actionlint1.7.7、Linux amd64静态构建通过。控制器binary SHA `67f581393962d08ec39214dd4072279d74e0b7526e8fd7c5f1a6c85c9a1cfe97`，节点 `4c77bf00fea0fd4e42dc8bc7c36900163f862e43fb33e5954aebd1de9f6ed523`。
- Ubuntu22 独立MySQL8.4.13：控制器最终测试binary `0423357dd99e6c0c5e1121a142f0db3c380a9a277445770aa95aa4e168aeb338` 完整PASS，包含原financial机器API、管理HTTP/RBAC/实际审计归因、CRUD/容量回收、快照、双节点冷迁移事务及真实mTLS流式故障测试。身份测试binary `9f3db346af13688626d8266036cc9bea3e5e0a639c391209b16937bf202b8361` 全部10个MySQL子场景PASS；两包 **0 SKIP / FAIL**。这不是race binary，也不是实际VM。
- 管理台：浏览器问题修复后最终149 Vitest /6文件 /0skip或FAIL，typecheck、format、production build均PASS；依赖及lockfile没有改变，先前npm全依赖扫描0漏洞。锁定的Vue依赖由独立scratch npm ci验证可重装。最终实测dist为`index-B636eQE5.js` / `index-CRtaRfOu.css`，产物不提交源码库。
- 财务公开合同与controller传输包：48 PASS事件、0SKIP/FAIL/race。它与主控测试有合同覆盖重叠，不相加宣传独立场景数量。
- 证据保存在ignored `vps-billing/artifacts/cloud-management-20261022/`，包含早期失败与最终实库日志、SHA及`test-receipt.json`。开发检查不等于真实宿主部署或生产安全认证。

## 真实浏览器补验（2026-10-22）

已使用 Ubuntu22 私有 MySQL8.4.13 与实际 Go HTTPS 管理接口，在浏览器完成限定范围的桌面/手机回归，详见 [浏览器记录](BROWSER_VALIDATION.md)。修复手机导航与返回竞争、重复历史项、退出登录合法204被误判未知、抽屉浅深主题与底栏位置、离场遮罩拦截点击及8项生产审计翻译。没有改后端协议、金额、支付、币种或历史快照。

页面实例是独立测试库的合成持久记录，不是真实VM；仅创建两笔accepted操作意图并验证幂等重放，没有派发节点、伪造心跳或推进迁移成功。实测截图、修前失败、最终构建与清理回执保存在ignored `aster-cloud/artifacts/cloud-browser-20261022/`，不作为生产数据/安装产物发布。

扩展功能基线提交 `ceda0bbc49924317953fc5e3b9b671a872d14f37` 的 [cloud CI](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/39731991017) 与 [财务 CI](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/39731990977) 已成功；不能把它们当作后续浏览器修复提交的CI。最终提交另查其对应Actions结果。

## 尚未验证 / 不包含

**本轮浏览器补验不等于完整产品验收**：没有完整执行慢响应/丢失ACK故障矩阵、跨身份迟到响应浏览器注入、200%浏览器缩放、实际手机软键盘、Safari/Firefox和减少动态效果的实际浏览器验证。相应单测仍不能代替这些未执行的人工/浏览器项。没有绕过证书警告或放宽Secure Cookie/CSRF。

没有真实 libvirt/KVM VM、磁盘满/物理断电后恢复、跨物理宿主迁移、guest SSH/联网/隔离、主控生产 systemd/Nginx/TLS 安装及整机升级/回滚。本轮不在现有 1 GB 财务测试机安装虚拟化包、创建 VM、改桥接或防火墙。热迁移、HA、VNC、MFA、租户 SSO、定时异地备份等仍未实现，见矩阵明确清单。

GitHub 的最终 Ubuntu22/24、原生 MySQL（禁止 SKIP）、管理台、依赖扫描结果应查对应 main 提交的 Actions；本文不提前宣称尚未结束的 CI 成功，也不把旧提交结果用于新源码。

## 历史记录

# 上一轮基础链验证记录（保留历史，非当前新增功能验收）

2026-10-22。用户明确暂无独立 KVM 宿主机，先开发，真实宿主验收留待后续；这不代表跳过财务发行门禁或把模拟测试算成虚拟机已开通。

## 已实际执行

- 最终 Go 1.26.4 / Darwin arm64 全 scope `go test -race -count=1 -v ./...`：175 个 PASS 事件、无 race warning、0 FAIL；**1 个真实 MySQL 入口因本机未配置 DSN 明确 SKIP**。vet 通过。证据为 `local-full-race-final4.log` / `vet-final4.log`；早期148 PASS记录不是本次最终源码结果。初次未获回环绑定权限的 EPERM 原日志保留，随后获准本机 TLS 监听后完整重跑通过。
- Ubuntu22 独立 MySQL8.4.13、Unix socket、固定256MiB：控制器完整测试 binary v2 **65 PASS 事件、0 SKIP / FAIL**，包括9个实库子场景和真实 TLS/mTLS。验证持久幂等、order/operation绑定、并发容量、维护/心跳失效、严格资源拒绝、发送后断线只GET、结果写失败和重启不重POST。此记录只绑定当时测试 binary `df1b4e26c495f06fffa620df06de6544983fa9a4f0cc72153708fa49c2b13f4a`；后续源码修订须单独记录，不借这批结果冒充最终同提交完整实库。
- 被控独立回归：37 个顶级测试、含子项106 PASS，race通过、0 SKIP。执行器使用受控 fake runner，测试幂等、异步接单、HTTP取消、进程重启/未知、域归属、路径/镜像、地址预留、权限、mTLS真实握手、只读核对，以及终态可见性必须等到worker释放、CLI显式空核对参数拒绝；**不是实际 libvirt/KVM VM 创建**。它与全scope测试有重叠，不将两者相加虚增独立测试数。
- 最终主控新增同节点派发门禁：有sending/dispatched/uncertain或未知状态时，后续任务保持accepted，不写入、不POST；SQL状态按字节比较。13种状态的本地SQL分支回归通过，并新增真实MySQL双订单并发/成功后释放门禁用例。**此修改晚于上述Ubuntu22实库测试，不能套用旧版65 PASS / 0 SKIP结论；最终原生MySQL结果另见下节精确提交CI。**
- 静态 Linux amd64 两个程序可构建，CGO关闭。实际上传被控只运行 `--doctor`：Ubuntu22 amd64、SVM/NPT和 `/dev/kvm` 可读写检查通过；virsh/qemu-img/qemu-system和libvirt连接缺失，正确报告 `ready=false`、退出1。没有启动被控服务、安装虚拟化包、修改宿主网络或创建VM。
- libvirt官方固定 **v8.0.0** 的 RelaxNG schema及3份依赖由官方源下载并记录SHA；当前静态IPv4 nwfilter模板通过 `xmllint --nonet --relaxng`。只证明XML结构兼容，不证明实际ebtables规则、VLAN/ARP/IPv6包隔离或guest联网。
- 新增cloud工作流经固定actionlint1.7.7检查通过；已执行的GitHub工作流结果绑定下节精确提交。Linux单测、真实MySQL和扫描分别记账，不合并为真KVM或全发行版验收。

## 精确提交的 GitHub 开发检查

源码 [`273549ca6908dab4c2eb5592c8f325ee3fbd20df`](https://github.com/xiaoqiqixi/betteridcsys/commit/273549ca6908dab4c2eb5592c8f325ee3fbd20df)，独立 [cloud CI 39721676458](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/39721676458)，首次运行全部成功，没有重跑或跳过门禁：

- Ubuntu22、Ubuntu24 单测/race/vet/Linux构建均成功，各49个顶级PASS、175 PASS事件；各有1个未配置DSN的MySQL入口明确SKIP，**不是两种系统的实库验收**。
- Ubuntu24独立原生MySQL8.4.11 Unix socket：50个顶级PASS、186 PASS事件、**0 SKIP / FAIL / race**。真实MySQL入口和10个实库子场景全部执行，包括最终 `single_node_worker_keeps_other_orders_queued_without_POST_or_audit`，不是本地SQL driver替身。
- 原生job的race、vet、两个静态Linux程序构建、Go1.27.3 / govulncheck1.9.0扫描和隔离环境清理均成功；扫描当时报告未发现漏洞，不代替持续更新。
- 同提交的财务 [Read-only CI 39721676452](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/39721676452) 也全部成功，覆盖财务实库、原生安装/TLS/业务/备份回滚、浏览器和依赖门禁；不是主控网页或KVM验收。

完整日志与精简回执留存于ignored `vps-billing/artifacts/cloud-20261022/ci-39721676458/`。这只证明上述开发检查，不包含真实KVM、宿主安装、网络包隔离、VM恢复或主控完整产品验收。后续代码变更必须重新绑定新提交结果。

## 上一轮测试环境清理

独立测试MySQL已停止，临时DSN和mysql.cnf删除，私有停机data目录及日志保留。doctor自身临时惰性镜像/配置/程序已删除，SSH复用连接已关闭。正式财务API/Nginx/MySQL仍active，未升级或修改；未新增CA或改钥匙串。

## 上一轮当时未完成（新增开发范围以当前矩阵为准）

没有真实VM启动/SSH/公网连通、实际网络隔离、安全组/VPC/IPv6、非零带宽/流量计量、数据盘/快照/备份/迁移、宿主恢复、原生systemd安装或Ubuntu24/26真机验收。被控的成功create只表示libvirt域running；不保证guest或业务可用。

当前是首条安全垂直链，不是完整云平台：没有管理UI、多用户RBAC/MFA/客户自助控制、完整分页、HA和日志保留/外部审计。主控API暂用root私有策略与独立scoped token；非特权分离待实现。节点单worker、私有JSON journal有64MiB上限，未知结果保留容量，主控容量有刻意保守双扣，不能声称完整高吞吐调度。

原始证据在 ignored `vps-billing/artifacts/cloud-20261022/`；功能目标与后续门槛见 [ARCHITECTURE.md](ARCHITECTURE.md)。本目录不附在财务0.5.9六资产，不创建独立主控正式Release。

## 2026-10-24 VM 公网直绑 / 浮动 IP 增量

本轮实现与部署边界见 [VM 公网管理](VM_PUBLIC_IP_MANAGEMENT.md)，不沿用 NAT-only
提交 af17f3c 的绿色状态作为本轮验收。逐项原始命令、red/green、同提交 GitHub
run/job、浏览器实库 proof 与截图另存 `artifacts/vm-public-ip-20261024/`。

必须执行：全量 Go race/vet、原协议字节与完整历史回归、真实隔离 MySQL（包括
并发末地址、跨owner/VPC、stale generation、source unknown、retire伪回执、事务审计
回滚、漂移与恢复解绑）、前端格式/类型/单测/构建/依赖扫描、真实API浏览器。
Ubuntu22/24 mandatory native NAT 入口在原测试内扩展整地址 TCP/UDP/ICMP、真实
源/目标地址、切换后 conntrack 撤旧及解绑；同矩阵另用发行版 `virt-xml-validate`
验证 CLI 生成的精确公网 filter，不启动 libvirt 或改变宿主规则。

本机 Darwin 缺 MySQL 与 Linux namespace 时的 skip 必须逐项列出；CI 的实库和原生
矩阵拒绝 skip，不能把“编译通过”当作上述测试已跑。Go 1.27.3 与锁定 Node24.19.0
用于最终门禁。TLS 浏览器使用隔离临时 profile/CA，不扩大用户系统信任，不忽略证书错误。

真 KVM、跨物理宿主、真实公网/上联、宿主重启、原生安装升级/整机备份恢复继续
按用户要求后置；本轮不据此宣称全部 KVM 加强版或生产部署验收完成。
代码只提交 main，不创建标签或 Release。金额/支付/历史财务快照源码无改动。

本轮首轮实库检查确实阻止交付：旧 storage/1 历史迁移没有 console prepare 行时，
新增退役投影错误地使详情返回404；修复为只省略不可证明的可选退役字段，写入路径仍
要求原 storage/2 任务与真实目标回执。新迁移 fixture 补齐注册后独立的退出维护操作，
另测健康心跳不能自动退出维护，不放宽生产容量门禁。浏览器对直绑解绑后的继续任务
改用持久资源行的精确同源任务链接，不依赖实例刷新会移除的临时 ACK 提示；仍要求一次
派发、真实节点结果与数据库确认，不能把202当成功。上述失败日志保留在验收目录，
最终结果必须以修复后同一 main 提交完整复跑为准。

随后可见浏览器流程继续捕获 public_detach 原任务派发403：后端动作权限映射遗漏，
不是节点执行失败。补齐 adopt/detach 的执行映射，同时在派发/核对与前端保持
`nodes.read + nodes.manage + instances.manage`，通用实例动作入口明确不能规划这两种
动作绕过资源 CAS。新增真实 TLS/实库缺权逐项拒绝、无审计/RPC 副作用、管理员及
完整自定义角色单次派发、丢 ACK 仅原 GET 核对的回归；浏览器严格检查派发HTTP202，
不再以关闭弹框超时代替直接报告403。最终仍要求该修复后同提交全部门禁重跑。
