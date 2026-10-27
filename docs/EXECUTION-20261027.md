# 2026-10-27 执行续记

继承[26日记录](EXECUTION-20261026.md)；旧失败不改写为成功，只更新main，不覆盖标签或发行资产。

## 当前同SHA结果：eb1e81f

- [Cloud 40350833850](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/40350833850)：11/11成功。
- [财务 40350833918](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/40350833918)：4/5成功；合计15/16，不是全绿。
- Ubuntu24完整native systemd/TLS/业务/升级/备份恢复/回滚链成功，独立真实MySQL财务浏览器成功。
- Ubuntu22已完成平台准备、真实MySQL/race和前端回归，完整native链在edge fixture失败：
  `Nginx >=1.19.4 is required; TLS/SNI protections are not relaxed`。Jammy发行包1.18不支持现有安全SNI拒绝。
  这是真实兼容缺口，不记作网络波动，也不删除最低版本或`ssl_reject_handshake`保护。

## W04：固定官方Jammy Nginx包，保留安全保护

22改用官方stable `nginx_1.30.6-1~jammy_amd64.deb`，固定1,224,970字节与SHA256
`ddafa6d5decef787c7942e6c4a9c62cf881d7ea598ec42b9997ecbf298e1bde3`。
下载只允许HTTPS、限定时间和大小；在任何dpkg元数据读取、解包或执行之前验证完整大小/SHA256，随后核对Package/Architecture/Version。
24仍使用已认证APT包，不切源、不添加主机签名信任、不安装宿主Nginx服务或执行maintainer脚本。

实际审查不是只抄hash：验证官方签名Release → Packages大小/SHA256 → 固定.deb大小/SHA256，篡改Release负例拒绝。
使用私有临时OpenPGP.js6.3.2验证器，不加入项目依赖。密钥来自vendor HTTPS并固定全文件SHA，
不宣称独立Web of Trust认证；也不宣称每次CI下载都重新在线验证PGP，运行时使用已审查固定包pin。

| 审查材料 | SHA256 / 签名信息 |
| --- | --- |
| Release | `15cccb6e55ac93372b23db0b006191f0705cbf9324c7e1a2d48552e8a1d5ddd2` |
| Packages | `54126ae885067e3c05b746eb0f91dc3241ba01101db6f7fe98f38956d8425c68` |
| 官方签名密钥束 | `55385da31d198fa6a5012d40ae98ecb272a6c4e8fffffba94719ffd3e87de37a` |
| 实际签名key ID | `2fd21310b49f6b46`；密钥完整指纹`8540A6F18833A80E9C1653A42FD21310B49F6B46` |

原始渠道：[官方Ubuntu安装/密钥说明](https://nginx.org/en/linux_packages.html)、
[Jammy Release](https://nginx.org/packages/ubuntu/dists/jammy/Release)、
[Jammy包索引](https://nginx.org/packages/ubuntu/dists/jammy/nginx/binary-amd64/Packages)。
新包本机未提取或执行，必须由新SHA的Ubuntu22完整链验证，不能把包审查当安装验收。

## W07-B2：财务账户原会话事务fence

先写[边界合同](FINANCE_IDENTITY_SESSION_FENCE.md)。四个账户写动作在等待全局账户锁后，
必须持有原请求的session X锁并复核owner/expiry，随后再复核当前admin、target/revision、最后管理员。
HTTP从原Cookie派生私有context，不接受客户端新增授权字段，不以同owner另一个会话续命。
原会话已撤销/过期时返回完整401，不改目标、目标会话或成功审计；不向响应补发清Cookie以误删刚轮换的新会话。

额外在真实MySQL8.4.11独立临时库复现一个边界：
锁定读取语句开始有效、等session锁期间已过期，语句内UTC_TIMESTAMP仍是开始时间，旧predicate错误接受过期行。
修复为先取得session X，再用下一条语句的数据库UTC时间检查expiry；实际验证后者拒绝该行，临时库已删除，生产表未动。
依据：[MySQL日期/时间函数求值规则](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html)。

新增回归覆盖：严格TLS四动作注销竞态；缺失/伪context、错actor/owner/hash、过期/删除/同owner替换、cancel；
真实MySQL通过performance_schema观察实际锁等待后注销、过期、轮换；session行等锁期间过期；
本人改密/撤销与logout并发不死锁。所有拒绝读取完整有界JSON，网络错误/截断/尾随垃圾/非JSON/超限响应不算通过。
保留原CSRF、分页、密码成本、登录发行竞态、最后管理员并发、审计失败整笔回滚及业务表不变断言。

### 提交前本机结果

- Linux/amd64完整billing测试包交叉编译、Linux目标`go vet ./cmd/... ./internal/...`通过；它们不是测试执行。
- 发行策略74、runtime26、更新器46、Cloud发行28、平台/pin13项通过；浏览器Node合同14项通过。
- workflow actionlint、shell语法、diff检查通过。
- Darwin不能执行Linux runtimeplugins，因此完整B2 HTTP/真实MySQL/race仍待新SHA的22/24 CI。
  未执行的旧HTTP回归不写成RED→GREEN；本机实际RED能力仅证明上述SQL时间primitive，不冒充完整HTTP链。
- 财务001–013、金额计算、支付、币种与历史快照均不改；没有部署、付款、VM或物理网络动作。

## SSH现状与仍可推进的工作

按用户要求自行处理首次连接：仅允许本轮私有known_hosts首次登记，后续固定key并拒绝变化，
不关闭主机校验、不删用户全局known_hosts，也不声称首次信任等于独立带外验证。
当前22端口TCP可达，但SSH在服务端banner/key交换之前主动关闭，尚未收到主机公钥、未进入密码认证、未发送密码。
私有known_hosts仍为空，不能称已连接或已部署；不反复尝试口令。Linux GitHub CI仍可继续，本项不阻断代码与隔离测试。

下一步：普通main提交后跑新同SHA全部16门，逐一核对B2和Ubuntu22完整native结果；继续W07-C/D与其余工作包。
员工权限组、MFA、所有财务写的统一fence、数据库强制append-only、正式0.5.10/Cloud下载通道、真KVM/物理数据面仍未记完成。

### 3b93252调度核对发现的来源证据缺口

本轮普通main推送已触发财务与独立performance，但Cloud旧路径过滤排除了纯财务/文档变更，因此该SHA缺少Cloud push run。
发行器严格只认同SHA main push，这时手动dispatch不能补位；不能拿eb1e81f的11门拼成新SHA的16门。
新增调度合同先1 RED确认paths过滤仍在，再删除Cloud的paths过滤，保留main分支、全部11任务、只读权限与原cancel/严格来源策略。
今后两个必需工作流每次main push完整调度；这是补齐证据，不是放宽验收、伪造commit触发或更换事件条件。
Cloud发行合同由28增至29项；当前发行文档同步为Cloud11+财务5，不再一处写15、一处写16。
3b93252尚未取得全套新门，接下来的完整结果只认包含调度修复的新精确SHA。
