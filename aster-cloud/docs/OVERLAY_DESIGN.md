# 路由与跨节点 VPC：后续执行设计

**状态：DESIGN / NOT IMPLEMENTED。** 本文不是已发布功能、可执行配置、安装说明或验收报告。本轮没有新增 overlay planner、VXLAN 执行命令或未接入的 CLI，也没有开放旧节点协议的安全限制。

目前单宿主实现使用 `aster.node/2` 的不可变 IPAM 绑定，以及 `fabric.Activate` / `Deactivate` / `Check`。它只在批准的专用 OVS 桥上提供私有 IPv4 成员互通和双向 drop meter，不提供网关、NAT、DHCP、Internet 接入或跨节点网络。下面的结构均为待评审草案，不是现有 Go/API 类型。

## 1. 目标与必须保留的边界

下一步应交付一个完整的网络执行切片，而不是把配置输入成功叫作网络成功：

1. 主控对全局 VPC、VNI、成员和 IP 租约做同事务、不可变绑定。
2. 节点核对本地 root profile、完整成员快照和实际隧道端口身份。
3. 用同一个 fabric 执行器、状态目录和跨进程锁隔离、编程、读回、放行 VM。
4. 两端均确认之前，主控只记录分阶段结果，不宣称跨节点原子成功或端到端连通。
5. 不改变订单金额、币种、支付幂等、历史商品配置或财务请求摘要。

不迁移、重接、配置宿主机管理物理网卡；不修改其默认路由、全局转发开关或防火墙。root 配置也不能成为任意 shell、URL、DNS 名或临时隧道目标的执行入口。

## 2. 先解决 underlay 信任，而不是把 VNI 当认证

VXLAN 是封装，不提供对端密码学认证。固定源 IP、VNI、UDP 校验和都不能单独证明远端节点身份。RFC 7348 指出了外部封装注入风险及另行使用 IPsec 等措施的需求。[RFC 7348 §7](https://www.rfc-editor.org/rfc/rfc7348.html#section-7)

最小可接受的部署边界二选一，必须显式 root 批准：

- 由运营方保证只有批准节点能收发的隔离 underlay，并记录独立的 `underlay_trusted_ack`；
- 预先配置并独立验证的认证 underlay，例如固定节点身份的 WireGuard/IPsec。不能用一个布尔字段冒充密钥、内核策略和对端握手已经验证。

若选择由本系统管理 IPsec，还需要独立的密钥生命周期、peer pin、内核策略读回和防明文泄漏门禁。OVS 文档明确讨论其数据面与 IPsec 策略配置之间的先后竞争，不能仅写 `options:psk` 后宣称加密已经生效。[OVSDB IPsec 与明文策略](https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.txt)

## 3. 待定版本合同

### root 节点 profile

建议独立版本，至少包含：

- `schema`、`node_id`、专用 `bridge`、唯一 `state_directory`、`dedicated_ack`；
- 固定 `local_ipv4`、underlay 信任模式及批准证据引用；
- `underlay_mtu`、`guest_mtu`，IPv4 VXLAN 预留至少 50 字节封装空间；
- 显式 peer 清单：远端节点 ID、固定规范 IPv4、稳定隧道 UUID/名字；
- 独立批准的网关附件清单（若启用），不能从客户请求取宿主设备名。

不接受 `remote_ip=flow`、`local_ip=flow`、任意 remote URL、客户指定的隧道名称或不在批准清单内的目的地址。一个专用桥只能有一套状态目录/执行权，不能用第二个 profile 的新锁绕开第一套 journal。

### 全局成员快照

建议独立 `aster.overlay/1` 合同；名称和字段未冻结：

- `cluster_id`、单调 `epoch`；
- VPC：`id`、`owner_ref`、规范私有 IPv4 CIDR、固定 VNI；
- 成员：`instance_id`、`node_id`、`owner_ref`、`vpc_id`、IP、MAC、interface UUID、显式双向 Mbps、生命周期资格；
- 所有相关节点 root profile SHA，以及规范完整快照 SHA。

VNI 范围为 24 bit；同一集群内唯一，不等于原有 VLAN ID。IP 在 VPC 内唯一，MAC、实例、节点和租约必须有明确绑定；节点不能临时自行发号。禁用或不确定成员仍保留身份记录，但不能生成 allow 规则。

将这些值作为新协议完整必填字段，而不是向 `aster.node/2` 或 `aster.controller/1` 添加可被旧实现忽略的可选字段。旧 `normal`、单宿主 VPC 和历史订单保持原义；不把带宽 0 擅自换成有限正速率。

## 4. VXLAN 数据面草案

OVS 支持按固定远端端点建立 VXLAN，并可用控制平面预置 MAC 映射，不要求 multicast/flood 学习。[OVS VXLAN FAQ](https://docs.openvswitch.org/en/latest/faq/vxlan/)

建议每个批准 peer 一条固定 local/remote IPv4 的 VXLAN 口，UDP 4789，`key=flow`。执行器必须核对 OVSDB type、options、外部身份标签、所属 bridge、实际 ofport 和稳定接口 UUID；ofport 只是观察结果。OVSDB 文档描述了固定端点、输入 key 和输出 key 的含义。[OVS tunnel options](https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.txt)

拟议流程：

- table 0 默认 drop；租户端口只接受其精确源 MAC/IP 和 ARP sender。
- 隧道入口同时匹配批准 tunnel `in_port`、外层 `tun_src` / `tun_dst`、精确 VNI、该 peer 所属成员的源 MAC/IP。未知成员、错误 VNI、内部 VLAN/QinQ、IPv6 默认 drop。
- 由匹配规则写入 VPC metadata，另标记 remote ingress；租户自己不能设置这些 metadata。
- 目的表只接受同 VPC 的精确目的 MAC/IP。ARP 单目标定向，不使用 NORMAL、FLOOD 或未知单播泛洪。
- 本地来源发往远端成员时，设置固定 VNI 并输出到唯一批准 peer 口；remote ingress 不得再转发到另一个 peer，避免节点成为 transit 或绕过成员入口检查。
- 本地源 egress 和本地目的 ingress 分别执行已有速率语义。不能声称远端节点必然执行了自己的 meter，也不能把 policer 当队列整形或财务流量计费。

OVS `set_tunnel` 可设置隧道 ID；当前设计只使用有明确成员映射的固定输出，不动态计算任意隧道目标。[OVS actions](https://www.openvswitch.org/support/dist-docs/ovs-actions.7.txt)

## 5. 明确区分“网关接入”和“内建路由器”

最小 north-south 方案是**独立 root 批准的 router appliance / gateway TAP 接入**：每个 VPC 有固定的网关 IP/MAC、稳定接口身份和明确允许的目的 IPv4 prefix。普通宿主物理/管理端口不是可选网关设备。

需要同时验证：

- 网关 IP 在对应 VPC 内，且不与成员、网络地址、广播地址冲突；
- 只有固定网关身份可以回复网关 ARP；租户不能冒用网关 MAC/IP；
- 前往和来自网关的数据都有明确 VPC 绑定，不能靠默认路由让客户访问其他 VPC、underlay、管理网或元数据地址；
- 目的 allowlist 与管理/underlay denylist 冲突时拒绝配置，不靠规则顺序猜测；
- 真实网关返回路由、NAT（若需要）、MTU 与回包验收独立存在。

只有这个附件层完成时，应称“批准网关接入”，不能宣称本系统已提供 NAT、Internet 或完整路由器。若改为系统自建路由器，必须另交付受限 network namespace / veth / nftables 的所有权、事务、反欺骗、回滚和验收合同；不得顺手改宿主全局网络。

## 6. 不能复用单机成功冒充集群原子性

单机 flock、OpenFlow bundle 和本机 receipt 不能构成跨宿主事务。下一切片至少需要：

1. 主控同事务冻结 VPC/VNI/租约、完整成员快照、epoch、各节点 profile pin 和请求 SHA。
2. 所有参与节点先持久准备并隔离，明确保存原 epoch、目标 epoch 和身份映射。
3. 节点逐一编程并实时核对；重启、端口替换、丢包、单边失败全部保留未确认状态。
4. 只有所需参与节点都确认目标 epoch，才允许相应成员 VM 放行；中途失败不自动回滚到未知旧拓扑，更不能自动重新 POST。
5. 每个节点的 journal 能拒绝旧 epoch、同 epoch 换成员，以及旧二进制忽略新网络绑定。

同一桥的 overlay、单宿主成员、网关和 VM admission 必须由统一执行器编译整份规则，并使用同一锁跨越隔离到 resume。不能并排运行两个各自 `replace-flows` 的执行器。

## 7. 完成标准与未完成项

代码测试应覆盖严格合同解码、成员/VNI/owner 绑定、错误隧道身份、端口复用、跨 VPC 注入、ARP 冒用、网关绕过、MTU 越界、所有存储/命令故障、节点崩溃、单边 epoch 及显式恢复。

真实验收需要至少两台独立 Ubuntu22+ KVM/OVS 节点和专门测试网络，检查 VM 双向流量、隧道注入、错误 peer、跨 VPC/管理网隔离、限速、MTU、丢包和重启。尚无这些证据时，只能报告代码/协议级验证，不能报告“跨节点已开通”或“路由已可用”。

本文没有执行官方示例中的物理网卡接入、IP flush、iptables flush 或宿主路由修改。官方示例是语义参考，不是本项目已批准执行的操作。[OVS tunnel how-to](https://docs.openvswitch.org/en/latest/howto/userspace-tunneling/)
