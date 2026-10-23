# KVM 加强版功能对照与开发验收规格

2026-10-23。本项目按用户指定的魔方云 **KVM 加强版功能范围**补齐独立主控及 KVM 被控，不把现有 Linux Bridge 基础链称为“加强版已完成”。本文记录当前差距、可交付顺序和逐项证据门槛，不是已完成的 Release 清单。

## 1. 对标范围与不变边界

- 对标**能力和管理流程**，自主设计数据模型、协议、执行器和 UI；不接对方 API，不搬运源码、商标、图片、安装包或 CentOS 安装脚本。
- 保留 Go + Vue/TypeScript + MySQL、原生 systemd/TLS 部署；被控目标为 x86_64 Ubuntu 22.04 及以上。22.04/24.04 分别验收，较新版本先探测；“能编译”不等于所有发行版兼容。
- 主控负责权限、租户资源、IPAM、调度、意图/审计；被控负责经审批的 libvirt/QEMU/KVM 与网络资源。财务负责销售和账务，不把付款成功当作虚拟机运行成功。
- 保持既有 `aster.controller/1`、`aster.resource/1` 和产品快照兼容。**金额、币种、支付幂等及历史快照不改**；本轮监控数据不自动入账，不添加按量扣费。集中 IPAM 仅预留资源，独立 OVS 执行器尚未接入实例创建/启动；旧开通链不得因新增管理对象而自动获得 VPC 能力。
- 所有后续写动作继承稳定操作 ID、冻结参数和目标、写前持久化、重复请求校验、未知结果保留。丢响应后只核对原任务，不自动重发写入。
- 代码只更新 `main`。真实 KVM 验收已由用户延期，但没有豁免代码测试、MySQL 测试、危险操作保护或后续实机验收。
- 当前财务宿主机不是网络实验机。不得自动桥接其 SSH/公网网卡、清空防火墙、安装 OVS 后重接管理链路、运行 `curl | bash` 或关闭 AppArmor/TLS 校验。

## 2. 实际阅读的官方资料与判断边界

以下为本轮 2026-10-23 查阅结果，均为官方资料。仅短摘要，产品具体行为仍以原文和后续版本核对为准。

| 编号 | 官方资料 | 本轮读取程度及用于本项目的要点 |
| --- | --- | --- |
| R1 | [KVM 加强版和轻量版的区别](https://docs.idcsmart.com/docs/魔方云/1.%20环境部署/KVM加强版和轻量版的区别) | 正文已读取。主要区别在网络：加强版按 IP 限速、跨节点内网、VPC/浮动 IP 等；不能把基础 libvirt 网桥当作功能等价。 |
| R2 | [魔方云概览](https://docs.idcsmart.com/docs/魔方云) | 官方搜索返回功能表；作为监控、磁盘、租户、自助管理等功能域索引，非实现细节依据。 |
| R3 | [创建及管理实例](https://docs.idcsmart.com/docs/魔方云/3.%20管理实例/创建及管理实例) | 正文已读取。实例与客户、预备镜像、网络相关联；经典网络与 VPC 要区分。 |
| R4 | [添加 IP](https://docs.idcsmart.com/docs/魔方云/7.%20网络与安全/添加IP) | 正文已读取。地址池包含网关、前缀、DNS、可用节点及 VLAN/MAC 等管理属性。 |
| R5 | [弹性 IP](https://docs.idcsmart.com/docs/魔方云/7.%20网络与安全/弹性IP) | 正文已读取。公网地址是独立、归属客户且可绑定的资源，不是实例字符串字段。 |
| R6 | [NAT 转发与建站](https://docs.idcsmart.com/docs/魔方云/7.%20网络与安全/NAT转发与建站（单IP与NAT分开）) | 正文已读取。区分宿主单 IP 与独立转发方式；本项目不沿用其中不可回滚的宿主改造或默认放行大端口范围。 |
| R7 | [创建负载均衡](https://docs.idcsmart.com/docs/魔方云/7.%20网络与安全/负载均衡/创建负载均衡) | 正文已读取。独立资源、所属 VPC、监听器、后端及健康检查应分层管理。 |
| R8 | [实例配置调整](https://docs.idcsmart.com/docs/魔方云/3.%20管理实例/实例配置调整) | 正文已读取。变配需要明确停机影响；本项目不因参考系统会强制停机就隐式强停客户实例。 |
| R9 | [流量计费设置](https://docs.idcsmart.com/docs/魔方云/3.%20管理实例/流量计费设置) | 正文已读取。额度、方向、重置日分开；本项目计量账本与金额账本保持分离。 |
| R10 | [更换网络类型](https://docs.idcsmart.com/docs/魔方云/3.%20管理实例/更换网络类型) | 官方搜索正文可读。跨 VPC、经典/VPC 切换是有状态资源变更，不是改显示标签。 |
| R11 | [添加本地存储](https://docs.idcsmart.com/docs/魔方云/4.%20磁盘与存储/添加本地存储)、[对接 Ceph 存储](https://docs.idcsmart.com/docs/魔方云/4.%20磁盘与存储/对接Ceph存储) | 官方搜索正文可读；单页打开遇到 4 MiB 获取上限。确认本地/Ceph 与节点关联的管理思路，不声称完整读过其中全部命令。 |
| R12 | [本地存储热迁移](https://docs.idcsmart.com/docs/魔方云/9.%20插件与增值功能/9.3%20本地存储热迁移) | 官方搜索正文可读；单页打开 cache miss。确认开机迁移、能力/硬件匹配、节点/磁盘迁移区分，未采用其 SSH 凭据流程。 |
| R13 | [克隆实例及创建为模板](https://docs.idcsmart.com/docs/魔方云/3.%20管理实例/克隆实例及创建为模板) | 官方搜索正文可读。模板/克隆与原实例独立；磁盘不可缩小。 |
| R14 | [磁盘扩容](https://docs.idcsmart.com/docs/魔方云/3.%20管理实例/磁盘扩容) | 单页目录及官方摘要可读。宿主磁盘扩容与客户系统内分区/文件系统扩容不能冒充同一完成状态。 |

读取限制：网络、存储、迁移等大章节汇总页返回内容过大，未把获取失败写成“已通读”。R1 对轻量版第二网卡 OVS/VLAN 的一行说明与末段“无 OVS”存在表述不一致；这里只采用明确列出的加强版能力，不推断其私有实现。R1 没有证明隧道选型、控制面算法或所有功能的可用性等级。下面网络架构与约束属于**本项目设计**，不是对方实现披露。

## 3. 状态定义与代码锚点

- `implemented-partial`：仓库存在某个受限实现和自动测试，不代表完整目标或实机验收。
- `missing`：没有可交付实现；目标字段、按钮、fake runner、示例配置不能替代功能。
- `in-development`：本轮正在开发，须通过独立测试后更新记录；不计入已交付。
- `realhost-required`：需要真实 Ubuntu/KVM/交换或存储条件验收。可与前述状态并列。当前所有会实际改变 VM、数据盘、宿主网络的能力均有此门槛。

当前代码锚点（路径相对 `aster-cloud/`）：

| 锚点 | 文件/入口 | 已有边界 |
| --- | --- | --- |
| A1 | `internal/control/config.go`、`store.go`、`admin_create.go` | root 审批节点/preset，资源预留、能力/心跳门槛；不是网页完整节点/区域 CRUD。 |
| A2 | `internal/nodeproto/contract.go`、`internal/hypervisor/engine.go`、`ledger.go` | 创建及电源任务、精确请求摘要、独占 journal、未知结果隔离、受限删除。 |
| A3 | `internal/hypervisor/config.go`、`network.go`、`engine.go:prepare/domainXML/seed` | 单 IPv4 静态配置、预配置专用 Linux Bridge、确定 MAC、固定防欺骗 filter；无租户安全组、VLAN 或 VPC。 |
| A4 | `internal/hypervisor/doctor.go`、`internal/nodeproto/capabilities.go` | 只读探测与受 root 上限约束的能力公告，不自动改宿主。 |
| A5 | `internal/nodeproto/storage_contract.go`、`internal/hypervisor/storage_engine.go`、`storage_manifest.go`、`qcow_header.go` | 停止态单系统盘全量快照/备份、签名清单与保守恢复。 |
| A6 | `internal/control/migration_transfer.go`、`operation_runner.go`、`internal/hypervisor/storage_transport.go` | 固定双向 mTLS 的四阶段冷迁移；源 fence、目标审批/容量占位；不是热迁移/HA。 |
| A7 | `internal/identity/`、`internal/control/console.go`、`audit_query.go`、`internal/diagnostics/` | Secure Cookie/CSRF、明确 RBAC、审计精确分页、白名单日志。 |
| A8 | `frontend/src/pages/`、`components/OperationActions.vue`、`MigrationWizard.vue`、`composables/mutation.ts` | 管理员实例/节点/任务/审计/用户 UI；待确认写入防重；不是客户 SSO 或 VNC。 |
| A9 | `internal/control/resource_view.go`、`../vps-billing/backend/controllerapi/` | 独立只读资源视图与既有财务开通协议；不把控制台用户 ID 猜为财务客户。 |
| A10 | `internal/nodeproto/metrics_contract.go`、`internal/hypervisor/metrics.go`、`internal/control/metrics.go`、`frontend/src/components/InstanceMetricsPanel.vue` | owner/node/实例绑定的实时只读样本；缺值为 null、累计计数为十进制字符串，非历史监控/计费账本。 |
| A11 | `migrations/005_network_ipam.sql`、`internal/networking/`、`frontend/src/pages/NetworksPage.vue` | MySQL VPC/地址池/租约及管理台；planned/reserved，不执行宿主网络或自动释放。详细合同见 [NETWORK_API.md](NETWORK_API.md)。 |
| A12 | `internal/fabric/`、`cmd/aster-network/` | 独立 root CLI 的单宿主 OVS 微分段/双向 meter 核心；写前 journal、整桥隔离、读回及点时 VerifyLive；尚无 VM-start gate 或主控下发。 |
| A13 | `plugins/billingconnector/`、`cmd/aster-billing-plugin/` | 复用原公开协议和安全 transport 的独立资源适配 CLI；不是支付插件，不由财务 runtime-plugin manager 加载，不替代财务原生持久任务。 |

## 4. 加强版核心网络差距（最高优先级）

R1/R4/R5/R6/R7/R10 是功能依据；具体执行器选型须再查 Ubuntu/libvirt/OVS 上游资料并在专用宿主验证。

| 目标能力 | 当前状态/锚点 | 本项目待补交付及验收门槛 |
| --- | --- | --- |
| 地址池与分组、前缀/网关/DNS、节点适用范围 | `implemented-partial` A3/A11：集中 IPv4 池与租约已实现 | 单节点、显式 1–4096 地址、网关及批准节点；实库并发/幂等/权限/分页已测。DNS/区域组/IPv6/编辑/释放尚缺；预留不等于公网生效。 |
| 多 IPv4、IPv6、多个 IP 限速组 | `missing`；A2 严格拒绝不支持规格 | 能力显式匹配，逐地址/组唯一绑定。IPv6 RA/NDP/DAD、路由、反欺骗实测；不得仅接受字段而忽略执行。 |
| OVS 数据面 | `implemented-partial` A12；旧 A3 仍是 Linux Bridge；`realhost-required` | 独立 root CLI 已有强类型编译、专用桥审批、TAP/stable identity 检查、整桥 drop→meter→allow、exact 读回与持久未知状态。尚未接主控任务/VM 启动门禁/安装服务；不得改现财务网卡。 |
| 按 IP 上下行限速、IP 组共享及混合策略 | `implemented-partial` A12：单 IP/端口双向 drop meter；旧 A2 仍拒绝非零带宽 | guest 发出与接收分别 metering，Mbps×1000=kbps；不是排队整形、IP 组共享或流量额度。多 IP/组策略和端到端套餐能力仍缺，吞吐/突发/重启实测待补。`realhost-required`。 |
| VLAN 隔离 | `implemented-partial` A11 的 node/VLAN 唯一预留 + A12 的 VPC metadata 微分段 | 当前用 VLAN 编号作 bridge 内 OpenFlow metadata 标签，并非已提供 802.1Q trunk/access；来宾 tagged frame 默认 drop。物理 VLAN 上联、跨节点承载仍 `missing`，不能把 OVSDB tag 当显式 flow 隔离。 |
| 节点内/跨节点私网 | `implemented-partial` A12 单宿主静态 IPv4 微分段；跨节点 `missing` | root 已审批 TAP 的已知 peer 可按 VPC 精确转发 ARP/IPv4，无 flooding/LOCAL/NORMAL。节点内抓包/欺骗/速率待实测；跨节点网络 ID、MTU、封装与故障仍须独立设计。 |
| VPC、子网、路由及客户归属 | `implemented-partial` A11：owner/node/CIDR/VLAN 管理对象，状态 planned；A12 独立静态 L2 | 当前 MySQL 同节点 CIDR 不重叠、租约严格匹配实例 owner/node；尚无 DB→fabric 原子绑定、VM-start gate、路由/网关服务、子网 CRUD 或跨节点 VPC。不能以 planned 当已联网。 |
| 浮动/弹性公网 IP | `missing` | 独立 owner 资源、可用区域/节点、唯一绑定及 bind/unbind 操作。未知状态不转绑；读回数据面；迁移不能静默换 IP/释放旧 IP。 |
| NAT 端口转发/共享建站 | `missing` | 端口、协议、地址三元组冲突与配额；域名唯一归属、合法目标网口。独立受控执行区，不占宿主 SSH/财务端口、不默认放行 20000–60000。 |
| 租户安全组 | `missing`；A3 固定防欺骗不是安全组 | 入/出方向、协议/CIDR/端口范围、优先级/状态语义明确；默认策略、规则版本、原子替换、绑定读回。IPv4/IPv6/ARP/NDP 及失败时旧策略保留。 |
| IP-MAC 绑定与反欺骗 | `implemented-partial` A3/A12；`realhost-required` | 旧 bridge filter 和新独立 OVS exact IP/MAC/ARP+VPC metadata 各有测试，不互相替代。必须实测同桥非托管端口、ofport 重用、双标签、宿主服务攻击及断电恢复。 |
| DHCP | `missing`；A3 当前使用 NoCloud 静态地址 | 地址授权绑定、租约与持久 IPAM 一致；隔离 rogue DHCP，重复 DISCOVER/请求/租约恢复、DHCP 服务故障不能重复发放地址。 |
| 负载均衡 | `missing` | owner/VPC 资源、监听器、后端、健康检查、证书生命周期；后端/探测不可借机访问管理网。先交付明确协议范围，故障后旧配置继续工作。 |

**不能把当前基础 profile 放开为增强 profile。** A2 `prepare` 正在拒绝数据盘、VPC、IPv6、非零限速/流量等；保留拒绝直至该能力拥有端到端实现、能力探测和验收证据。0 带宽只在明确批准默认不限速模式下有效，不代表执行了 0 限额。

## 5. 主控及被控其余功能矩阵

| 功能域 | 当前状态/锚点 | 距离完整目标与验收 |
| --- | --- | --- |
| 原生 Ubuntu22+ 安装/doctor | `implemented-partial` A4 | Ubuntu22/24 单独验证 libvirt/QEMU、权限、AppArmor、systemd、TLS、干净安装/升级/卸载保留数据；当前没有实机完整认证。`realhost-required`。 |
| 区域/节点组/节点、容量、维护、排空 | `implemented-partial` A1/A4/A8 | 网页区域/节点组 CRUD、受控纳管/证书轮换、版本兼容、排空流程待补；心跳过期不调度、容量并发无超卖、维护不删除实例。 |
| 实例创建/电源/删除 | `implemented-partial` A1/A2/A8 | 真实引导/SSH/关机/强停/删除/重启不确定恢复待实机。启动成功不得推断客户应用就绪。批量操作须逐个稳定 ID/状态，不全批冒充成功。 |
| 暂停/恢复、锁定、回收/恢复 | `missing` | 与真实 libvirt 状态分开，锁定有明确权限，回收保留磁盘/地址及保留期；清理任务未知不自动删资源。 |
| 变更客户/归属迁移 | `missing` | 原 owner 与新 owner、磁盘/VPC/安全组/地址依赖的原子约束；审计前后归属；不能修改历史账单客户快照。 |
| CPU/内存变配与磁盘扩容 | `missing` | 资源增量事务预留、允许的停机影响、磁盘只增不缩、失败后真实配置读回；系统分区扩容单独报告。 |
| 内存超售/KSM 与资源超分策略 | `missing` | 默认不超售；若支持，须管理员显式设置物理/承诺/预留上限，OOM/balloon/租户干扰监控与回退；不能沿用参考的性能宣传直接开启。 |
| 审批镜像、公钥及初始化 | `implemented-partial` A2/A3 | root 批准哈希、静态 NoCloud；镜像目录/版本/撤销、Windows 支持、克隆模板、重装/救援/ISO 待补。禁止任意宿主路径/下载 URL/客户命令。 |
| 密码重置/guest agent | `missing` | 单独能力与镜像适用性、加密传输/短期秘密、guest 成功证据、失败不显示成功；日志/审计/浏览器缓存不可保留密码。 |
| 应用预设/初始化脚本 | `missing` | 只允许运营者审查并版本化的 guest 预设，明确镜像/动作/时限/结果校验；客户字段不得变为宿主命令，不记录或任意导出应用凭据。 |
| 本地池、独立数据盘、IOPS/吞吐限额 | `implemented-partial` A2/A5：仅批准系统盘本地目录 | 磁盘独立对象、挂载/卸载、容量/配额、IO 限额和断电恢复待补。磁盘归属/路径硬边界、空间不足不得破坏原盘。 |
| Ceph/共享存储 | `missing` | pool/image 与密钥最小权限、节点能力、RBD 锁/fencing、读写路径、备份一致性及故障演练；不可上传 Ceph admin key 到普通网页。 |
| 快照/备份手动操作 | `implemented-partial` A5/A8；`realhost-required` | 仅停止态全量系统盘、同实例恢复；不含 RAM/在线一致性、增量、独立数据盘、删除实例后重建恢复。必须验证客户数据/引导，而非仅哈希正确。 |
| 定时备份/保留/异地恢复 | `missing` | 稳定计划 run ID、错过运行策略、锁/配额、已验证恢复点再剪枝、对象存储凭据隔离；演练原盘损坏及完整恢复。 |
| 冷迁移 | `implemented-partial` A6/A8；`realhost-required` | 四阶段停止态链已实现；双宿主数据/网络迁移和断电逐点验收仍缺。源未知必须持续 fence/占位，不能因超时双启动。 |
| 热迁移/磁盘热迁移/HA | `missing` | CPU/QEMU/网络/存储能力前置；目标预留、唯一启动权、可恢复进度和故障 fencing。不能把文件复制进度或 QEMU 指令 ACK 当迁移成功。 |
| 实例实时 CPU/内存/磁盘/网卡读数 | `implemented-partial` A10；`realhost-required` | 只读链及管理面板已实现，测试 raw domstats、单位、NULL/uint64、owner/node 绑定、pending 拒绝、陈旧内存和切换迟到；GET 不推进任务。**尚未真实 libvirt/KVM 采样，不是历史监控或客体健康证明。** |
| 历史图表/流量周期/额度/超额策略 | `missing` | 累积计数重启/回卷/迁移语义、采样去重、方向/周期、缺样显示；自动限额动作另经幂等任务；不直接改变财务金额。 |
| 告警/滥用策略 | `missing` | 租户/管理员收件权限、持续阈值和恢复、通知去重/失败重试；自动资源动作需可审计批准，不通过监控 GET 隐式强停。 |
| 管理 UI/RBAC/用户/审计 | `implemented-partial` A7/A8 | 已有管理路径；MFA、客户 SSO、客户级隔离自助页面、作用域 API key 待补。每个新增权限默认拒绝且 admin 明确获得；动态撤权及时生效。 |
| 受控 VNC/控制台 | `missing` | 一次性短期票据、owner 与实例绑定、Origin/权限验证、连接撤销；不能暴露宿主 VNC 端口或把 root 密码交财务。 |
| 日志/任务/排障/运维 | `implemented-partial` A7/A8 | 安全 JSON 日志和审计查询已有；告警外送、留存落地、磁盘满、节点故障、备份还原及升级回滚实机演练待补。 |
| 财务资源产品兼容 | `implemented-partial` A9/A13 | 原生财务开通链不变，新增独立资源适配 CLI 的严格请求/结果绑定、固定安全目的地、显式 send/只读 lookup 测试。不是财务插件管理器新 kind，不自动证明已付款/创建服务；续费/挂起及增强网络产品映射仍缺。 |
| GPU/其他增值能力 | `missing` | 计入范围盘点，但后置；IOMMU 组/硬件独占、设备重置与回收安全须专用硬件验收，不伪造 capability。 |

## 6. 分批交付依赖（不是并行堆按钮）

```text
现有稳定操作/归属/RBAC/能力边界
  ├─ P0 只读 metrics（受限链已实现，待实机）→ 后续历史采样/告警
  └─ P1 MySQL IPAM + 管理 UI（本轮已实现，仅 planned/reserved）
       └─ P2 专用 OVS 静态核心（本轮独立 CLI）→ DB/task/VM gate 集成
            ├─ P3 单 IP 双向 meter（独立核心）→ 组限速/多 IP/IPv6/采样
            └─ P4 VPC/子网/DHCP/跨节点内网
                 └─ P5 浮动 IP/NAT → LB/客户自助网络

P1 资源模型 + 现有持久任务
  └─ S1 独立磁盘/扩容/IO → S2 调度备份/恢复 → S3 Ceph
       └─ 与 P4/P5 网络迁移能力汇合 → M1 热迁移/HA
```

- P0 不能绕过 P1–P5。实时读数可独立交付，但计数器不是可靠计费账本；没有历史库不能标“任意时段图表”。
- P1 先提供**可独立运行的实库模型/管理 API/并发测试**，尚不下发宿主网络，避免 UI 创建成功被误认为网络已生效。
- P2 的独立 CLI 限定运营者预备并 root 标记的专用整桥/TAP，绝不把 Linux Bridge profile 改名为 OVS。显式确认整桥后，端口未知可触发整桥 drop 隔离并中断全部端口；foreign controller/flow 不接管。只读 VerifyLive 不修复、不 quarantine，是点时观察而非永久启动授权。
- 存储及生命周期工作可与网络并行，但热迁移必须等待地址绑定、网络隔离和唯一启动权；不能先做“迁移成功”的按钮后补 fencing。
- 每批同时交付前后台、接口文档、权限/审计、失败状态、旧协议回归和可复现验收。未支持项明确不可选，不向用户暴露“开发模式/数据来源”等测试设置。

## 7. 本轮具体实现与下一步集成门槛

### 7.1 已落地的 IPAM 管理核心

Migration 005 新增 `controller_network_vpcs`、`controller_network_pools`、`controller_network_leases`，未改 001–004。写事务共用 `controller_lock.id=1`，审计同事务；数据库列类型/符号/排序规则/索引形状都要核对。VPC owner/node/CIDR/VLAN 受约束；地址池显式数组上限 4096、IPv4 数值排序；租约唯一键同时约束 pool+address 和 node+address。

`/console/v1/networks/{vpcs,pools,leases}` 提供 create/list/按原 ID detail；实际 Console 写须同时拥有 `nodes.read` 与 `nodes.manage`。Idempotency-Key 即资源 ID，canonical 强类型意图/actor/kind 绑定，同 key 变意图 409。池分页既受 100 条又受约 512KiB 预算，不能用“少于 100 条”断言最后一页。丢 ACK 后只能按原 ID 查询，不能换 ID 再建。

状态严格为 `planned` / `reserved`，没有 delete/free/自动到期回收，不改实例 resources 或财务快照，也没有预留后自动接线。真实 MySQL 已测并发最后地址、持久重启、幂等、越权/禁用池、分页/GET 不变式、schema 冲突和真实 HTTPS 会话；此证据不是包转发验收。完整 API 见 [NETWORK_API.md](NETWORK_API.md)。

**升级/回滚：主控数据库现在为 schema 5，旧二进制不认识它；不能只换旧 binary 回滚。** 必须停写、备份，采用兼容应用或已演练的数据库完整恢复路径。没有自动删除网络表/租约的降级迁移；任何恢复都必须保留已占地址和未知任务，不能当作清理重试。详见 [主控运维](../deploy/controller-OPERATIONS.md)。

### 7.2 独立 OVS 核心，不是完整 VPC

`aster-network plan/apply/status/verify` 只操作 root 明确审批的专用 `aster-` bridge，不创桥、改 uplink、装包、搬网卡或运行 shell。静态 topology 为 node+revision+VPC/owner/IP/MAC/stable Interface ID/ofport/双向 Mbps。来宾 untagged IPv4/ARP 先验证源，再凭 VPC metadata+目标 IP/MAC 精确输出；ARP 指向已知 peer，不泛洪。tagged/未知/IPv6/LOCAL 默认 drop。每端口一个 IPv4，各方向分别使用 drop meter；它不是有保证的排队整形、共享组限速或流量账本。

Apply 写前持久意图，整桥 drop 后改 meter，再 bundle allow 并 exact flow/meter/端口映射读回。相同 revision/digest 只返回原回执，未知/崩溃阻止自动重做；ofport 不是身份。已审批整桥出现未知 physical/tunnel/TAP 时可能整桥 drop，这不是“拒绝意味着无宿主写入”的接口。未通过整桥标记或存在 foreign flow/controller 时不接管。

Status 和同 revision replay 是历史回执；VerifyLive 只读最后 applied topology、专用桥、稳定身份、flow 与 meter，返回绑定摘要和观察时间。校验失败无 repair/写入/新回执；成功也只是点时证据，**不是可长期复用的 VM-start 授权**。root OVS 外部修改及端口重用仍须后续启动门禁/运行时失效控制。

这批自动测试使用受控 runner 和私有临时 journal；**没有真实 OVS/KVM 隔离、吞吐、重启或攻击包验收**。原 aster-node 创建/启动仍走批准 Linux Bridge，不允许靠放宽旧 `prepare` 接收 VPC/带宽来伪装闭环。细节见 [fabric README](../internal/fabric/README.md)。

### 7.3 下一步不能跳过的纵向依赖

1. **DB→fabric 绑定合同**：新增独立网络 operation/port snapshot，把现有 owner+instance+node+lease+VPC ID 显式绑定，不给旧 `aster.resource/1` 历史对象补写 VPCID。不能从 `network_type=vpc` 猜哪个租约；经典/VPC 切换必须是版本化新操作。
2. **租约→端口审批**：固定本地 profile/bridge 与 endpoint、确定 MAC/Interface ID、不可变 revision/raw digest；禁止客户端传 OpenFlow、root path、host route、URL 或命令。多实体顺序继承 controller_lock，提交后才显式分发任务。
3. **VM-start gate**：主控任务、节点 journal、端口出现/启用与实时 proof 组成启动前拒绝边界；proof 绑定精确 topology+live mapping，失效或未知不得启动/自动回退到旧桥。只拿历史 applied 回执不得启动。
4. **应用与恢复**：写前持久化、失败整桥隔离影响显式确认、原任务只读核对、root 重启恢复/fencing；不能因超时换 IP/换节点重发。先专用双租户单节点抓包/限速，再做跨节点承载。
5. **释放**：必须证明旧数据面解绑且无迁移/恢复依赖后，独立确认并审计释放。删实例记录、禁用节点、客户取消、查不到回执都不是可回收证据。
6. **完整路由 VPC**：明确 subnet/router/gateway/DHCP/DNS/MTU/IPv6/安全组状态模型；之后才做 cross-node、floating IP/NAT 和 LB。现 metadata 隔离不等于这些能力。

所有阶段均须最坏输入、权限动态撤销、并发唯一、崩溃/丢 ACK/磁盘满、旧 capability、真实 MySQL、GET 不写与手机/桌面交互回归。地址族、DNS、多节点及删除功能尚未实现，不在当前管理页放可点击假按钮。

## 8. 每项完成门槛与发布口径

同一项功能保留四份互不替代的证据：

1. **代码/契约**：输入/输出、能力、权限、持久模型、幂等、失败/未知状态与兼容说明完整。
2. **自动测试**：单元/race/构建/静态检查/安全扫描、真实 MySQL迁移/并发/恢复；明确跳过项与已知依赖例外。
3. **真实宿主**：Ubuntu22/24 的 VM/数据面执行及崩溃/丢响应/重启/磁盘满/证书过期；网络功能须双租户、双节点、抓包/吞吐和管理链路存活证据；备份恢复须实际数据与引导一致。
4. **真实 UI/运维**：同源 HTTPS真实 API，手机/桌面实际截图；干净原生安装、升级、备份还原、回滚、安全权限及日志留存。

用户将第 3 项延期时，可交付开发代码和第 1/2 项结果，但状态仍保留 `realhost-required`。不能将“main 已推送/CI 绿/页面有按钮/命令退出 0”写为完整 KVM 加强版已上线。现财务 Release 不因主控功能盘点被覆盖；主控正式发行需单独列明版本、能力、验收与未支持项。

当前实现/协议边界同时参见 [ARCHITECTURE.md](ARCHITECTURE.md)、[CONSOLE_API.md](CONSOLE_API.md)、[NODE_README.md](../NODE_README.md)、[VALIDATION.md](VALIDATION.md)。
