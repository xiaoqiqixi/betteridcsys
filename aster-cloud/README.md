# 星屿云主控与 KVM 计算节点

独立于 `vps-billing/` 的云资源系统，当前为开发版，不是已验收的完整云平台。财务销售商品和确认付款，主控接纳任务并管理资源，被控安装在宿主机上，通过 libvirt / QEMU / KVM 实际运行客户虚拟机。客户虚拟机不需要安装本系统的被控服务。

不对接或复制 IDCsmart API；参考其产品与资源分层、区域/节点、实例生命周期和运维思路。使用 Go、MySQL、原生 systemd，禁止由安装器自动修改宿主机桥接、防火墙或存储。

## 当前工作边界

- 财务与主控使用公开的 `aster.controller/1` 合同，旧普通网络任务使用 `aster.node/1`，显式 OVS VPC 任务使用 `aster.node/2` 及完整不可变网络绑定；协议兼容测试不等于虚拟机已创建。
- 财务、主控使用独立数据库和权限。主控没有支付、改价、改账单状态的接口，也不能读取财务数据库。
- 主控持久接纳、资源预留和节点派发分离。超时、进程崩溃和丢失响应保留结果不明状态，不通过重发开通制造第二台虚拟机。
- 节点不运行外部传入 shell；仅允许预定义动作、审批镜像、存储和网络。客户端提供路径、XML、SSH 命令或下载 URL 均不是合法资源参数。
- 被控面向 Ubuntu 22.04 及以上的 amd64 宿主机。每个发行版必须单独经过 doctor、真 KVM 和重启恢复验收；不能把交叉编译称为全版本兼容。

本轮包含独立管理台、staff RBAC、实例动作，以及旧普通网络实例的停止态快照/备份与四阶段冷迁移。此前独立的 OVS CLI 核心现已通过 **MySQL 同事务 IPAM/任务绑定 → `aster.node/2` → 节点持久绑定 → fabric 启停门禁** 接入显式 VPC 创建/启动：先整桥隔离、paused/link-down 启动，再核验 TAP 身份与实时 flow/meter，最后放行；停机先隔离并清除旧端口规则。基础合同仍是单宿主私有 IPv4；新显式 `aster.overlay/1` 已连接全局 VPC/三阶段主控任务、固定 VXLAN peer、批准网关转发与原 VM 启停 gate。新实例先完成全组 epoch 再创建，失败使用新 recovery epoch。详见 [网络合同与恢复](docs/OVERLAY_DESIGN.md)。现增加 root 批准的独立 namespace IPv4 SNAT、TCP/UDP 单端口 DNAT，以及后台 VPC、成员、路由、NAT 和恢复管理；仅允许已批准前缀，不是无限制 Internet 出口，也不代表公网/跨节点连通性已验收。OVS 实例明确拒绝旧存储/迁移合同及旧仅观察电源状态的 reconcile，另有显式网络恢复流程，重启须显式关机再启动。热迁移、租户 SSO 和生产宿主验收也不在已完成范围。具体实现、支持范围、命令和测试结果见下列记录；当前禁止直接用于真实客户销售。没有用假按钮、内存数据或模拟执行器冒充已完成的主控功能。

- [功能与验收矩阵](docs/ARCHITECTURE.md)
- [本轮开发验证](docs/VALIDATION.md) · [管理台与资源 API](docs/CONSOLE_API.md) · [日志与审计](docs/LOGGING.md)
- [主控运维](deploy/controller-OPERATIONS.md) · [KVM 被控运维](NODE_README.md)
- [术语](GLOSSARY.md)
- [KVM 加强版逐项差距](docs/KVM_ENHANCED_PARITY.md) · [网络/IPAM API](docs/NETWORK_API.md) · [OVS 核心与嵌入门禁](internal/fabric/README.md) · [本轮 OVS 集成验收记录](docs/OVS_VM_GATE_VALIDATION.md)
- [后台网络管理合同](docs/NETWORK_MANAGEMENT.md) · [NAT 执行与审批边界](internal/fabric/NAT.md) · [NAT 与网络管理验收记录](docs/NAT_NETWORK_VALIDATION.md)
- [既有财务资源适配 CLI](plugins/billingconnector/README.md) · [财务系统插件管理器 resource transport](../vps-billing/docs/RESOURCE_PLUGINS.md)
- 财务产品配置合同：[PRODUCT_CONFIGURATION.md](../vps-billing/docs/PRODUCT_CONFIGURATION.md)

### 升级与生产阻塞项

- 主控 MySQL 当前为 schema **7**（006 实例网络绑定、007 全局 VPC/epoch）；节点首次持久接纳 `node/2` 任务后 journal 为 schema **3**，显式网络恢复 completion 升为 **4**；fabric 首次生命周期门禁使用 schema **2**，归档/overlay 使用 **3**，NAT 另保存 owner 与 `nat_profile_ids` 墓碑。新实现保留旧合同读取，不表示旧二进制能读取这些新状态；不能只换旧 binary 回滚，也不能删表、丢绑定或删除 journal 清空不确定状态。
- fabric 已移除 **64 次历史变更上限**：32 条活动页加不可变 SHA 链归档，保留精确历史重放与未知结果围栏。已有单宿主和跨节点显式恢复入口；不自动重试未知操作。完整历史校验仍有容量/性能成本，需规划磁盘与备份；真实 OVS/KVM 恢复验收仍待进行。
- 本轮代码与测试仍不等于真 KVM/OVS 验收。真实虚拟机、隔离/限速、重启恢复和生产部署验收继续延期；原 OVS 集成证据见 [OVS 集成验收记录](docs/OVS_VM_GATE_VALIDATION.md)，本轮精确实测与跳过项见 [NAT 与网络管理验收记录](docs/NAT_NETWORK_VALIDATION.md)。

开发环境使用相邻财务源码的公开 `controllerapi` 类型（`go.mod` 的本地 replace），不是复制或导入其内部数据库。正式主控发行时须把公共合同与对应来源、依赖锁定到可复现安装包；当前开发目录不附加到财务 Release 中。

```sh
cd aster-cloud
# 在安装 Go 的开发机运行；不修改宿主机或创建虚拟机
export GOTOOLCHAIN=go1.27.3
GOCACHE=/tmp/aster-cloud-go-cache go test ./...
GOCACHE=/tmp/aster-cloud-go-cache go vet ./...
```

本轮构建/安全扫描使用与 CI 一致的 Go **1.27.3**。模块的语言版本不是安全补丁承诺；本机旧 Go1.26.4 扫描命中标准库漏洞，换用独立 Go1.27.3 工具链后扫描通过。不要把旧工具链生成的测试 binary 当作生产安装产物，也不要因只更新业务依赖而忽略标准库更新。

独立开发 CI 包括 Ubuntu22/24 单测与构建、Ubuntu24 隔离真实 MySQL（禁止 skip）、独立 Vue 管理台检查、Go 扫描，以及 Ubuntu22/24 隔离 namespace 的原生 NAT 包流门禁。原生 NAT 测试不覆盖 OVS/KVM 或物理公网。Ubuntu22 单测没有数据库时明确跳过实库测试，不能当作 Ubuntu22 完整部署或真 KVM 验收；真实 Ubuntu22 MySQL 由独立测试机另外记录。
