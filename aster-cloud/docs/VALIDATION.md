# 主控 / KVM 被控开发验证（非成品验收）

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

## 测试环境清理

独立测试MySQL已停止，临时DSN和mysql.cnf删除，私有停机data目录及日志保留。doctor自身临时惰性镜像/配置/程序已删除，SSH复用连接已关闭。正式财务API/Nginx/MySQL仍active，未升级或修改；未新增CA或改钥匙串。

## 明确未完成

没有真实VM启动/SSH/公网连通、实际网络隔离、安全组/VPC/IPv6、非零带宽/流量计量、数据盘/快照/备份/迁移、宿主恢复、原生systemd安装或Ubuntu24/26真机验收。被控的成功create只表示libvirt域running；不保证guest或业务可用。

当前是首条安全垂直链，不是完整云平台：没有管理UI、多用户RBAC/MFA/客户自助控制、完整分页、HA和日志保留/外部审计。主控API暂用root私有策略与独立scoped token；非特权分离待实现。节点单worker、私有JSON journal有64MiB上限，未知结果保留容量，主控容量有刻意保守双扣，不能声称完整高吞吐调度。

原始证据在 ignored `vps-billing/artifacts/cloud-20261022/`；功能目标与后续门槛见 [ARCHITECTURE.md](ARCHITECTURE.md)。本目录不附在财务0.5.9六资产，不创建独立主控正式Release。
