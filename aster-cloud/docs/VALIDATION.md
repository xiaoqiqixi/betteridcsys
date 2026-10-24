# 管理台 / 权限 / 实例 / 存储 / 冷迁移开发验证

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
