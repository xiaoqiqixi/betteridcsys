# 实施与验收续记 · 2026-10-26

起始 main：`4626e321803f03be8d414f8f7cd29b77481eca97`，远端仅 main，无新标签或 Release。
用户原规划图片和三项 `.DS_Store` 保留；本轮不改财务源码或数据库 SQL。

## 上一批已取得的同 SHA 结果

| 4626e32 的实际门禁 | 结果 | 不能外推的范围 |
| --- | --- | --- |
| [Cloud CI 40188150956](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/40188150956) | 11/11 SUCCESS | 不是正式 Cloud 发布或 KVM 真机验收 |
| [财务 CI 40188151010](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/40188151010) | 4/4 SUCCESS | 不是生产部署或新 Core 公开资产已下载 |
| Cloud 真实 MySQL / HTTPS 浏览器 | 163 业务、53 布局、18 成员检查；70 PNG，0 console error | 节点 RPC 为隔离替身，不是真 VM 数据面 |
| 成员分页 | 205 人三页，桌面/手机均完整无漏重；匿名401、viewer403，成员业务写0 | 不含搜索/导出、MFA/SSO 或跨路由页码/滚动恢复 |
| 财务真实 MySQL / HTTPS 浏览器 | 20 检查、12 PNG；业务写0，历史表摘要不变，测试库删除与进程清理通过 | 这批财务图是暗色合成账户，不冒充全站/浅色视觉完成 |
| Ubuntu22/24 libvirt 准备 | 真实 APT、systemd、libvirt 准备通过；宿主网络未变，拒绝无 KVM | 官方镜像 TCG guest，`kvm_ready=false`；Ubuntu26仍不支持 |
| 财务原生链 | Ubuntu24 隔离 runner 的 systemd/Nginx/TLS、业务重启持久化、23表备份恢复及合成支付重放通过 | 未整机重启、未重启数据库进程、未验生产RPO/RTO、未真实付款/邮件/开通；Ubuntu22财务完整链仍待W04 |

浏览器和 libvirt 证据 ZIP 先核对 GitHub artifact 的 source SHA 与 SHA256，再解包；不是复用旧失败 run 的截图。
已实际查看成员桌面浅色、手机浅色及手机英文深色图；中文/英文标题、状态和上一/下一页可读，320px导航测试保留。
成员测试姓名本身是中文合成数据，切英文不翻译客户输入。长页截图中的固定栏位置不代表实时滚动行为已由静态图片证明。

## 本包：W07-B1 会话事务 fence

先写[具体设计与非目标](IDENTITY_SESSION_FENCE.md)，再在原生产 HTTP Handler 和真实 MySQL 上复现。
旧实现的6个 POST/PATCH × 注销/改密/到期用例全部 RED：新增仍返回201，修改仍返回200。
这不是网络波动或测试重连，也没有把网络错误算作拒绝。

实现：Require 传递不导出的 hash/subject 证明；账号创建/修改不再接受缺失证明的内部调用。
事务拿 identity_lock 后以 `FOR UPDATE` 当前读确认同一会话及 owner，锁等待完成后再判到期，随后继续原有权限/委派/最后管理员及审计。
注销统一 identity→session 锁序。原 Cookie 不入 DTO、日志、回执或持久任务，不添加生产测试 bypass。

验收增加：恰好到期、等待 identity 锁期间到期、session owner改变/变匿名、会话存储故障应503而非成功或认证拒绝；另一已有效设备/重新登录仍能正常管理。
最后管理员并发回归升级为两条真实 HTTP 会话先同时通过入口认证，结果必须一条200、一条完整401，且始终只有一名有效管理员。
Store 级旧测试仅在测试文件内准备真实持久会话并按 token 清理，没有放宽生产权限或最后管理员断言。

### 本地环境与边界

- 原 SSH 连接缺少可验证的主机 key；未忽略校验、未发送服务器凭据，亦未改测试服务器。
- 改用本机私有临时目录的 Oracle MySQL8.4.11 arm64 原生包，核官方[下载清单](https://dev.mysql.com/downloads/mysql/?version=8.4.11)摘要及二进制 codesign；无 Docker、无系统安装。
- 数据目录与 socket 位于0700目录，仅当前用户；TCP/X禁用，`skip_networking=1`、无 mysqlx 插件。未改钥匙串或系统 CA。
- 第一次控制面本地运行用了不满足原安全命名合同的基础库，随后采用 CI 的确切 `aster_ci_test` 回归；不修改生产 DSN 白名单。一次手动中断停止了私有进程，重启原数据后重跑，不重新初始化掩盖问题。
- 六例实际 RED→GREEN 已完成；补充会话归属、锁等待到期、存储错误和严格证明后，最终身份/控制面实库 race 为669 PASS事件、0FAIL/0SKIP。独立证明单测、两包vet、Linux静态controller构建通过。新 SHA CI 尚待运行，不把本地 macOS 结果套成 Linux 验收。
- 当前本地 MySQL 是 macOS，不代替 Linux CI、Ubuntu22财务链、真 KVM 或正式下载验收。

## 清单继续保留

W07-A记为同SHA CI已证；W07仍进行中。B1不包含用户revision、显式全部会话撤销、撤销前在途登录代次、身份操作不可变回执/未知结果锁和新安全UI，详见[下一切片](IDENTITY_PERMISSION_PLAN.md)。
W08资源交付、W09节点目录、W10实例操作、W11存储迁移、W12网络安全、W13运维灾备、W14商业规则、W15完整UI及W16正式发行继续按依赖推进，不把本轮修复记成整个清单完成。
