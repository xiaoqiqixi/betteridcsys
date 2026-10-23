# NAT 与后台网络操作验证

2026-10-23 至 2026-10-24。在 `981e0eaebab10899f1e6d9b583b498c7fd3eba23` 基线上继续开发，
只更新 main；不创建标签、不替换财务 Release。`vps-billing/` 源码没有改动，
金额、支付与历史财务 / node 创建快照不参与网络变更。

## 实现与边界

- 后台提供全局 VPC、完整成员选择、批准范围内的路由、SNAT / TCP 与 UDP
  端口映射、阶段回执、只读核对和明确恢复；使用实际 HTTPS 会话、CSRF、
  双权限校验和 MySQL 审计，不以 `202`、网络错误或历史回执表示已生效。
- NAT 接入 overlay 三阶段和 VM 生命周期；专用 namespace 的身份、网口、
  路由和 nftables 必须实时核对，规则撤销同时清除旧 conntrack。节点不改
  宿主 nftables、管理网口或公网路由。完整 root profile 变更须明确批准迁移，
  不通过后台上传宿主路径或绕开配置摘要。
- 修复 `checkOVS` / `stopOVS` 在门禁构造及早期校验失败时漏掉独立 guest
  隔离的问题。回归先复现运行中的受控 guest 仍然 link-up，再验证所有错误
  路径均独立 link-down / suspend；不碰非本系统或已经关机的 guest，不重试
  shutdown / destroy，不把原未知操作写成成功。

这仍是**批准前缀的 IPv4 NAT**，不是任意 `0.0.0.0/0` Internet 出口。
IPv6 / hairpin / ICMP DNAT、自动公网地址与上联配置、NAT HA、共享建站和
负载均衡不在此实现。真实 KVM、OVS 跨物理节点包流及整机生产验收后置。
操作合同见 [后台网络管理](NETWORK_MANAGEMENT.md)，节点约束见
[NAT 执行合同](../internal/fabric/NAT.md)。

## 已执行的自动化

| 检查 | 实际结果与限制 |
| --- | --- |
| Darwin arm64 / Go 1.27.3 | 最终全包 `go test -race -count=1 ./...`、`go vet ./...` 通过。没有 DSN 或原生工具的专用入口明确跳过，不能算实库 / Linux 网络通过。 |
| Ubuntu22 / 独立 MySQL 8.4.13 | 最终 control 测试 binary：87 个顶级测试、含子项 423 个 PASS，0 SKIP / FAIL。仅使用专属 Unix socket 和测试库，没有接入现有财务库。该 native binary 未开启 race；race + 实库另由 CI 门禁执行。 |
| Ubuntu22 / nftables 1.0.2 | `TestNativeNATPacketFlowAndRevocation` 6.41 秒 PASS；实际三个临时 namespace 与 veth 验证 TCP SNAT、TCP / UDP DNAT、未批准端口拒绝、program 阶段隔离、撤销后现存 TCP 连接失效，以及宿主 nftables 未变化；0 SKIP / FAIL。不是 OVS / VM 端到端测试。 |
| OVS 早期失败回归 | 全部 `^TestOVS` race 通过，5.861 秒；使用可核对的 runner 状态与原操作重放 / 核对测试，不是真实 libvirt guest。 |
| Vue 管理台 | format、typecheck、build 通过，17 个文件 / 616 个测试通过；单测不代替下面的实际浏览器记录。 |
| 依赖与构建 | govulncheck 1.9.0 / Go 1.27.3 未发现漏洞；npm audit 0 漏洞；Linux 静态构建及 actionlint 1.7.7 通过。依赖及锁文件未更改，扫描结论仅对本次执行时间有效。 |

原生测试 binary SHA-256：

```text
control e1d791af294c6b54b840cb298376231aad7d2bc5d5393036aac572a2a3636931
fabric  339be2251f2b1a3baa4d58b8e1065e5b0d12c1bf040a8e864d15561b979d3f7f
```

忽略目录 `aster-cloud/artifacts/nat-ui-20261023/` 保存最终与早期失败日志。
`control-native-final.log`、`nat-native-final.log`、`go-race-frozen.log` 分别对应
本表，不把修复前结果、各层重复覆盖或子测试相加宣传独立场景数。

## 实际浏览器

Ubuntu22 隔离环境已完成严格 TLS 的拒绝 / 私有 Firefox CA 信任验证、真实登录和
桌面页面截图；发现并修正列表 / 详情 / 回执共三处原始 ISO 时间显示，新增四项
中英文微秒 RFC3339 回归。截图并非组件渲染图。

该宿主同时运行财务且只有 1 GB 内存。完整浏览器流程触及专属 Firefox 240 MiB
cgroup 上限，均在首次导航失败、未提交业务修改；没有提高限额挤占财务资源。
因此不能把本地桌面截图说成手机 / 写操作验收。完整可重复流程改由独立
Ubuntu24 GitHub runner 执行，见 [浏览器门禁](../deploy/ci/NETWORK_BROWSER.md)。

门禁使用真实 Go HTTPS、会话、RBAC、CSRF 与 MySQL；节点 RPC 使用明确的
测试替身注入阶段丢 ACK。浏览器所有修改均点击实际控件，证据查询仅 GET；
必须验证新 VPC、路由 / NAT、只读核对、明确恢复、1440 / 390 像素、中文浅色 /
英文深色、焦点 / Escape / 返回、本地化日期，并等后端停机时验证旧财务、node
和初始网络快照 / 回执未变。脚本存在或 syntax 通过不是浏览器已通过，最终状态
以同提交 GitHub job 和 `network-management-browser` 截图 / JSON 为准。
这不是实际节点命令或 VM 执行验收。

## CI 与未验证项

新增必需的 Ubuntu22 / Ubuntu24 原生 NAT matrix，编译 race binary 后以 root
在隔离 namespace 中执行；必须出现指定测试 PASS，任何 SKIP / FAIL 均失败。
已有原生 OVS parser、实库无跳过门禁、前端和 Linux race / vet / build 保留。
加入真实 MySQL 浏览器门禁后，cloud 工作流共九项任务。GitHub 结果必须查看
本轮实际 main 提交的 Actions，不套用前一提交的成功。

本次没有真实 KVM / libvirt、跨物理节点 OVS/VXLAN、公网接入、物理断电 / 磁盘满、
节点整机升级回滚、HA、真实手机触控与软键盘验收。现有财务服务没有升级，
也不在其宿主网卡上搭桥。Chrome / Safari、真实手机软键盘、200% 缩放未验收。

## 临时环境清理

Ubuntu22 浏览器 fixture 已优雅退出 PASS，记录 `epochs=1 / audit=34 / vpcs=1`，
确认本地浏览器未创建业务变更且原始财务 / node 字节不变。其独立 MySQL 已按
精确 PID / datadir 识别后关闭；整个本轮私有目录、Firefox 信任库、凭据、私钥
与下载文件已移除，无残留 Firefox 或临时 namespace。现有财务 MySQL 保持运行，
未升级或改配置；SSH 与本机 43306 / 5447 隧道已关闭。

本轮 macOS CA 导入曾等待系统认证，没有形成可用信任；挂起操作已取消，
导入证书已删除，最终 `security find-certificate` 返回 44（不存在）。本地 CA /
服务器私钥与测试账号 / 会话导出也已删除。GitHub 门禁只信任独立临时 NSS
profile，不改系统信任，退出 trap 和 always 清理步骤负责删除该轮资源。
