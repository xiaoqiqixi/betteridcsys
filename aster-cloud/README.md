# 星屿云主控与 KVM 计算节点

独立于 [`vps-billing/`](../vps-billing/README.md) 的云资源系统，**当前为开发版，尚未完成真实 KVM、物理网络和生产部署验收**，不包含在财务 Core 的发行包中。

财务销售商品、确认付款；主控接纳意图、预留资源并派发任务；被控安装在计算宿主机，通过 libvirt / QEMU / KVM 管理客户虚拟机。客户虚拟机不需要安装被控服务。三个系统使用独立进程与权限，财务和主控使用独立数据库；主控不能改账单、确认支付或读取财务数据库。

使用 Go、MySQL、Vue 3 / TypeScript 与原生 systemd。目标宿主为 Ubuntu 22.04 及以上的 amd64；各发行版须单独验收。不对接 IDCsmart API；安装器不自动修改宿主机桥接、防火墙、已有 VM/镜像数据或物理上联。

## 原生安装入口：仅本地开发包

**独立 Cloud 正式 Release / 官方下载通道尚未发布。** 财务 `v0.5.9` 不是主控或被控安装包，
这里不提供假 `curl | sh` 地址，也不把开发包校验当成部署完成。

在审核过的本地仓库根目录，每台目标主机只执行对应角色的一条命令：

```sh
sudo bash aster-cloud/deploy/install/controller.sh
```

```sh
sudo bash aster-cloud/deploy/install/node.sh
```

两条命令进入交互向导，**默认只读 plan**；向导要求本地开发包路径、独立可信来源的完整
SHA256、显式开发版批准、真实配置与最终 apply/start 批准。不是复制命令后无条件上线。
本轮实际核验过的本地包、真实 SHA 与可复跑的只读单命令见[当前验证记录](docs/VALIDATION.md#当前工作区开发安装器安全测试)。
详细参数、配置审批和恢复见[安装器说明](deploy/install/README.md)、[开发包合同](docs/INSTALL_PACKAGES.md)
与[安装器安全测试](docs/INSTALL_VALIDATION.md)。

- **主控**：可沿用独立 MySQL / 真实 TLS，也可明确选装固定 Ubuntu 依赖和新专用 MySQL。
  新 DB 的 runtime DML 与 migration DDL 账号分离，不复用财务库/账号；只对新建专用服务配置
  Unix-socket-only MySQL。管理员口令私密输入；只有数据库检查、管理员引导、活跃服务和严格
  HTTPS 健康检查完成才报告 `service-ready` 并输出访问入口。
- **KVM 被控**：可选装固定 qemu / virsh-client / cloud-localds 工具，**没有开放完整 libvirt
  daemon 与默认网络的自动安装**。仍须真实 KVM、已批准的 libvirt 服务、证书、镜像与预算；
  默认维护开启、网络和删除关闭，不改物理上联/桥接/防火墙。即使本机检查与服务启动完成，也只报告
  `node_started_pending_controller`，真实 mTLS 注册须从主控执行，不能把 controller 私钥放到节点。
- **未完成项**：干净 KVM 节点端到端“一键就绪”尚未完成；本轮未执行真实 APT、MySQL provisioning、
  systemd 安装或 KVM 部署验收。Ubuntu 22.04 / 24.04 / 26.04 amd64 是安装器目标检查，不是三个发行版已实测的承诺。
  新 UI 的实库、浏览器和截图门禁独立执行；安装器安全测试与旧 UI 的结果不能代替它们。

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

## 文档入口

- **了解项目**：[架构与支持范围](docs/ARCHITECTURE.md) · [更新记录](CHANGELOG.md) · [术语](GLOSSARY.md)
- **准备环境**：[主控运维](deploy/controller-OPERATIONS.md) · [KVM 被控运维](NODE_README.md) · [网络恢复](docs/OVERLAY_DESIGN.md)
- **使用管理台**：[管理台与资源 API](docs/CONSOLE_API.md) · [日志与审计](docs/LOGGING.md) · [网络管理](docs/NETWORK_MANAGEMENT.md)
- **配置网络**：[IPAM API](docs/NETWORK_API.md) · [公网池与 NAT 租约](docs/PUBLIC_IP_MANAGEMENT.md) · [公网 NAT 出口](docs/PUBLIC_NAT_EGRESS.md) · [VM 直绑/浮动 IP](docs/VM_PUBLIC_IP_MANAGEMENT.md) · [公网入站规则](docs/PUBLIC_INGRESS.md)
- **核对证据**：[验证入口与最新基线](docs/VALIDATION.md) · [真实 MySQL / TLS 浏览器门禁](deploy/ci/NETWORK_BROWSER.md) · [OVS 集成历史记录](docs/OVS_VM_GATE_VALIDATION.md) · [NAT 集成历史记录](docs/NAT_NETWORK_VALIDATION.md)
- **接入财务**：[财务资源 worker](../vps-billing/docs/RESOURCE_PLUGINS.md) · [独立适配 CLI](plugins/billingconnector/README.md) · [财务产品配置合同](../vps-billing/docs/PRODUCT_CONFIGURATION.md)
- **执行器细节**：[OVS 核心](internal/fabric/README.md) · [NAT 审批](internal/fabric/NAT.md) · [overlay 控制合同](docs/OVERLAY_CONTROL.md)

财务仍使用公开 `aster.controller/1`；普通网络为 `aster.node/1`，显式 OVS VPC 为 `aster.node/2`，托管直绑公网为 `aster.node/3`。不同合同不自动互相升级，协议通过也不表示虚拟机已创建。开发环境通过 `go.mod` 的本地 replace 使用相邻财务源码的公开 `controllerapi`，不导入其内部数据库。现有打包工具可制作本地开发包；独立发行前仍须锁定公共合同来源、建立正式发布通道并完成原生安装验收。

## 状态与升级边界

- **主控 MySQL：schema 10**。008 增加公网库存/租约，009 增加 VM 公网资源，010 增加实例入站策略版本与固定结果；001–009 历史迁移不改。财务数据库不随之升级。
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
