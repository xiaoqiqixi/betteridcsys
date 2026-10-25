# 星屿云主控与 KVM 计算节点

独立于 [`vps-billing/`](../vps-billing/README.md) 的云资源系统，**当前为开发版，尚未完成真实 KVM、物理网络和生产部署验收**，不包含在财务 Core 的发行包中。

财务销售商品、确认付款；主控接纳意图、预留资源并派发任务；被控安装在计算宿主机，通过 libvirt / QEMU / KVM 管理客户虚拟机。客户虚拟机不需要安装被控服务。三个系统使用独立进程与权限，财务和主控使用独立数据库；主控不能改账单、确认支付或读取财务数据库。

使用 Go、MySQL、Vue 3 / TypeScript 与原生 systemd。当前支持目标为 Ubuntu 22.04 / 24.04 amd64；Ubuntu 26.04 暂不支持，各受支持发行版须单独验收。不对接 IDCsmart API；安装器不自动修改宿主机桥接、防火墙、已有 VM/镜像数据或物理上联。

## 原生安装：主控与被控各一条命令

Cloud 使用独立的 `cloud-v0.1.0-rc.1` **预发布通道**，不是财务 Core `v0.5.9`，也不是已验收稳定版。
源码只在 `main` 更新；独立 Cloud 标签与资产不覆盖财务历史 Release，不改变财务 `latest`。
**可执行命令以通过发布门禁的 [Cloud Release](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/cloud-v0.1.0-rc.1)
正文为准**：每个角色一条固定完整提交 SHA 的 HTTPS bootstrap 命令。如果该 Release 尚不可下载，不能将本地开发包当正式通道。

初始脚本是操作者审核并信任的固定源码入口；它不是靠下载自己的 checksum 自证可信。
后续主控 / 被控包和安装器代码必须通过 GitHub Actions 的 Sigstore 身份、精确源码 SHA、制品哈希和完整清单核验；
无需 GitHub 登录，不读取用户 token。验证器固定版本与哈希，只放在 root 私有缓存，不替换系统 `gh`。
包、签名、来源或代码邻接文件不一致即停止，不回退开发包。完整信任边界见[发布通道](docs/RELEASE_CHANNEL.md)。

- **主控**：一条命令进入交互向导，采集真实域名 / TLS / 专用数据库与管理员信息。
  可以显式选择官方 Ubuntu 依赖和新专用 MySQL；runtime DML 与迁移 DDL 身份分离，绝不复用财务库。
  只有严格 HTTPS、数据库、管理员引导与服务检查通过才报告就绪。密码私密输入，不进命令行和日志。
- **KVM 被控**：一条命令进入节点向导，可明确批准自动准备官方 libvirt / QEMU 完整软件栈。
  先约束 vendor 服务 / socket 的启动，再使用仅本机 Unix socket 的专属守护进程；空网络目录的只读 mount namespace
  隔离包脚本生成的默认网络。核对真实 PID、unit、mount 与网络状态，不改物理上联、netplan 或防火墙规则。
  已运行的外来 libvirt 仅做只读核验，不接管、不重启。
- **默认安全边界**：先显示只读 plan，再由操作者明确批准依赖、配置、apply 与 start。
  软件准备不要求假造 `/dev/kvm`，也不把安装成功等同于节点可接单；启动仍要求真实 KVM、证书、已批准镜像与预算。
  维护开启、网络与删除关闭。本机启动状态仅为 `node_started_pending_controller`，真实 pinned mTLS 准入从主控发起，
  不向节点复制主控 client 私钥。现有 1GB 财务测试机不能用作计算节点。
- **兼容范围**：安装器仅接受 Ubuntu 22.04 / 24.04 amd64、Python 3.10+ 与 booted systemd；
  Ubuntu 26.04 及未知版本明确拒绝。CI 对 22/24 分别使用官方验签镜像进行隔离 TCG 安装测试，结果绑定精确提交；范围收敛后的新提交仍须重新通过门禁。TCG 只验证真实 APT/systemd/libvirt 软件准备，
  不代表 KVM 客户虚拟机、物理网络、迁移或整机升级恢复验收。真实 KVM 验收仍按计划后置。

已有审核过的本地开发包仍可使用 `deploy/install/controller.sh` / `node.sh`，但必须显式批准 development
和独立可信 SHA，不能据此安装 release 形态的包。详细参数、恢复与未验收项见[安装器说明](deploy/install/README.md)、
[包合同](docs/INSTALL_PACKAGES.md)、[安装安全测试](docs/INSTALL_VALIDATION.md)及[精确验证记录](docs/VALIDATION.md)。

## 当前能力与限制

下表表示代码和开发测试范围，不是生产可用承诺。完整差距见[功能与验收矩阵](docs/ARCHITECTURE.md)及 [KVM 能力对照](docs/KVM_ENHANCED_PARITY.md)。

| 范围 | 已有实现 | 重要限制 |
| --- | --- | --- |
| 独立管理台 | staff 登录/RBAC、实例/节点/任务/审计/用户管理，中英、浅深色 | 不是财务客户 SSO；没有 MFA 或受控 VNC |
| 管理工作台 | 52px 一体导航；`<=1024px` 紧凑入口与抽屉，桌面资源表、手机连续清单；中文/英文、浅/深主题 | 当前视图与会话/API 分离；完整同提交实库与浏览器结果以 GitHub Actions 为准，不继承旧侧栏证据 |
| 实例与监控 | 审批 preset 创建、电源/删除、持久任务、只读实时样本 | 采样不是历史监控、来宾健康证明或计费账本；真实 libvirt/KVM 待验 |
| 快照/备份/迁移 | 旧普通网络实例的停止态系统盘快照/备份、四阶段冷迁移 | OVS 实例拒绝旧存储/迁移合同；没有热迁移、HA、定时异地备份 |
| VPC 与网络 | MySQL IPAM、不可变实例绑定、OVS 启停门禁、固定 VXLAN peer、全节点 epoch、批准路由和显式恢复 | 专用桥、underlay 与 root profile 须预备；没有完整子网/DHCP/IPv6/租户安全组 |
| NAT 与公网地址 | 批准 namespace SNAT、TCP/UDP DNAT、公网 IPv4 出站、地址池/分配/确认回收、普通网络直绑和 VPC 浮动 IP | 地址库存不证明上游路由或所有权；不热换运行实例主 IP；没有 IPv6/hairpin NAT 或负载均衡 |
| 浮动 IP 公网入站 | 实例独立 IPv4 来源/协议/端口规则；新绑定默认拒绝未经允许的新入站 | 仅保护 VPC 浮动 IPv4 入口，不覆盖东西向、直绑或完整安全组；旧 legacy 映射须明确升级 |

所有写任务先持久化意图。丢响应、崩溃或结果不明时保留原操作，只读核对，不自动重发开通、释放地址或清空 journal。节点只执行预定义动作及 root 批准的资源，不接受外部 shell、XML、宿主路径、SSH 命令或任意下载 URL。

## 财务资源插件兼容范围

由插件管理器加载的 `resource.aster-cloud` worker **0.1.1** 使用 `aster.resource/1`，
最低财务 Core 为 **0.5.10**（当前候选，未发布）；`core_max_exclusive=0.6.0`。
旧正式 **0.5.9** 二进制没有该资源协议，不能因 `main` 代码曾标作0.5.9而宣称已兼容。
worker改用0.1.1避免与旧main本地0.1.0产物同版不同哈希；不覆盖旧目录或放宽包校验。
Core、plugin-host、plugin-manager 必须来自支持该协议的同一候选构建；启用插件不等于资源服务已启动或VM已开通。

独立 `aster-billing-plugin` CLI 仍为 `aster.controller/1` 的显式HTTPS适配器，
其 `runtime_plugin=false`，不是上述worker；本次最低Core修正不改变CLI动作、财务金额、支付和历史快照。
具体构建/安装以[财务资源插件文档](../vps-billing/docs/RESOURCE_PLUGINS.md)为准，不把候选版本写成正式发行。

## 文档入口

- **了解项目**：[架构与支持范围](docs/ARCHITECTURE.md) · [更新记录](CHANGELOG.md) · [术语](GLOSSARY.md)
- **准备环境**：[主控运维](deploy/controller-OPERATIONS.md) · [KVM 被控运维](NODE_README.md) · [网络恢复](docs/OVERLAY_DESIGN.md)
- **使用管理台**：[管理台与资源 API](docs/CONSOLE_API.md) · [日志与审计](docs/LOGGING.md) · [网络管理](docs/NETWORK_MANAGEMENT.md)
- **配置网络**：[IPAM API](docs/NETWORK_API.md) · [公网池与 NAT 租约](docs/PUBLIC_IP_MANAGEMENT.md) · [公网 NAT 出口](docs/PUBLIC_NAT_EGRESS.md) · [VM 直绑/浮动 IP](docs/VM_PUBLIC_IP_MANAGEMENT.md) · [公网入站规则](docs/PUBLIC_INGRESS.md)
- **核对证据**：[验证入口与最新基线](docs/VALIDATION.md) · [真实 MySQL / TLS 浏览器门禁](deploy/ci/NETWORK_BROWSER.md) · [OVS 集成历史记录](docs/OVS_VM_GATE_VALIDATION.md) · [NAT 集成历史记录](docs/NAT_NETWORK_VALIDATION.md)
- **接入财务**：[财务资源 worker](../vps-billing/docs/RESOURCE_PLUGINS.md) · [独立适配 CLI](plugins/billingconnector/README.md) · [财务产品配置合同](../vps-billing/docs/PRODUCT_CONFIGURATION.md)
- **执行器细节**：[OVS 核心](internal/fabric/README.md) · [NAT 审批](internal/fabric/NAT.md) · [overlay 控制合同](docs/OVERLAY_CONTROL.md)

财务仍使用公开 `aster.controller/1`；普通网络为 `aster.node/1`，显式 OVS VPC 为 `aster.node/2`，托管直绑公网为 `aster.node/3`。不同合同不自动互相升级，协议通过也不表示虚拟机已创建。开发环境通过 `go.mod` 的本地 replace 使用相邻财务源码的公开 `controllerapi`，不导入其内部数据库。打包工具从同一精确 monorepo 提交编译公开合同与 Cloud 二进制；正式预发布通过独立签名与下载门禁，真实 KVM 和完整生产生命周期仍须另外验收。

## 状态与升级边界

- **主控 MySQL：schema 11**。008 增加公网库存/租约，009 增加 VM 公网资源，010 增加实例入站策略版本与固定结果，011 仅新增成员稳定分页索引；001–010 历史迁移不改。财务数据库不随之升级。成员分页与配套升级/回滚边界见[成员分页](docs/MEMBERS_PAGINATION.md)。
- **节点 journal：最高 schema 5**。node/2 绑定使用 3，显式网络恢复 completion 使用 4，托管公网绑定与永久退役墓碑使用 5。新程序保留旧合同读取，不表示旧程序能读新状态。
- **fabric journal：最高 schema 3**。生命周期门禁使用 2，归档/overlay 使用 3；NAT owner 与 `nat_profile_ids` 墓碑不能删除。历史 64 次上限已移除，采用 32 条活动页和不可变 SHA 链归档；历史核验仍有容量与性能成本。

升级须停写并备份独立主控库、节点/fabric journals 和制品。回滚需要匹配版本的一致备份，不能只换旧 binary、删表、删绑定、删 journal 或释放未知地址。真实整机备份恢复、断电、宿主重启和生产升级验收仍未完成。

## 开发检查

在安装对应工具链的开发机运行；以下命令不安装服务、不修改宿主网络，也不创建虚拟机。

```sh
cd aster-cloud
export GOTOOLCHAIN=go1.27.3
GOCACHE=/tmp/aster-cloud-go-cache go test ./...
GOCACHE=/tmp/aster-cloud-go-cache go vet ./...

cd frontend
npm ci --ignore-scripts
npm run format:check
npm run typecheck
npm test
npm run build
```

CI 使用 Go 1.27.3 和 Node 24.19.0。无测试 DSN 的本地 Go 测试会明确跳过实库场景，不能算 MySQL 验收；实库和原生网络门禁必须在隔离 runner 执行，不能指向生产数据库。依赖/语言版本也不等于安全补丁承诺。

以下是**历史**已核对源码基线 `66e2d49`（2026-10-25）的结果，不代表本轮安装器或新 UI 已通过实库/浏览器验收：管理台 32 文件 / 845 tests，真实 MySQL 483 顶层 / 2006 子测试、0 skip；严格 TLS 的 Firefox / MySQL 浏览器共 213 检查、64 PNG，同 SHA 的 12 项 CI 通过。节点 RPC 为测试替身，六张代表截图经过人工查看，不声称逐张检查全部图片。详见[验证记录](docs/VALIDATION.md)。后续源码或文档提交不能自动沿用该 SHA 的通过结论。

真实 KVM/OVS 隔离与限速、跨物理节点包流、公网上联、宿主故障恢复和生产部署仍须单独验收；当前不应据此承诺真实客户资源可用。
