# 网络/IPAM、OVS 与财务适配开发验证

2026-10-23。以 `e47c79d387651bc07da70731bafddabcd4fbd0fe` 为基线，仅更新 main。没有创建标签、发布主控正式 Release、升级现有财务站或安装 OVS/libvirt。本记录是开发检查，不是完整 KVM 加强版验收。

## 已实现与未接通的边界

- 主控新增 migration 005、VPC/IPv4 地址池/地址预留及真实会话管理 API、分页管理页、权限和事务审计。完整意图/actor/kind 幂等，节点与地址双重唯一；并发最后一个地址只分配一次。`planned/reserved` 不冒充已联网，未确认解绑不会自动回收。
- 被控新增独立 `aster-network plan/apply/status/verify`：root 审批专用整桥、静态单节点 VPC metadata 隔离、精确 IP/MAC/ARP、双向按 IP drop meter、写前 journal、未知结果保留、flow/meter/身份读回。`verify` 只读实时核对，历史 applied 回执不能替代它。此模块没有接入现有 VM 创建/开机链，也不提供路由/NAT/DHCP/跨节点。
- `aster-billing-plugin` 是显式宿主资源适配器，复用原 `aster.controller/1` 商品快照摘要、operation/order 及六字段结果；不是支付渠道或 runtime-plugin manager 插件，不替代财务已有持久开通任务。财务只有新增公开 transport 包装及测试，金额、币种、支付、幂等和历史快照逻辑未改。
- 实例只读 metrics 链及页面已补齐。所有计数为 uint64 十进制字符串或 null；不伪造内存使用率、周期流量或财务扣费。

详细功能差距见 [KVM 加强版矩阵](KVM_ENHANCED_PARITY.md)、[网络 API](NETWORK_API.md)、[OVS 执行器](../internal/fabric/README.md) 和 [财务适配说明](../plugins/billingconnector/README.md)。

## 冻结源码的检查

| 检查 | 实际结果与限制 |
| --- | --- |
| Go1.27.3 / Darwin arm64 全 scope race | **902 PASS 测试事件、0 FAIL/race**；22 个测试事件明确 SKIP：21 个缺 DSN 的入口/子项及 1 个要求真实 root policy 的 TLS 入口。没有将这些跳过算作本机实库成功。 |
| Go 静态检查/构建 | vet、固定 actionlint1.7.7、shell 语法及 diff-check 通过；CGO=0/Linux amd64 的 controller、node、network、billing-plugin 四程序构建通过。 |
| 财务旧合同/传输回归 | Go1.27.3 race：49 PASS 事件、0 SKIP/FAIL；覆盖原请求、结果和固定目的地传输。与全 scope 合同覆盖可能重叠，不合并数量。 |
| 管理台 | 540 Vitest 用例 /15 文件，0 SKIP/FAIL；typecheck、Prettier check、production build 通过。**不是本轮浏览器或手机视觉验收。** |
| 依赖扫描 | npm 全依赖扫描 0 漏洞；Go1.27.3 + govulncheck1.9.0 报未发现漏洞。先前本机 Go1.26.4 命中 17 个可达标准库漏洞，失败日志保留；改用与 CI 相同的独立工具链重新测试/构建/扫描，没有忽略告警或删除门禁。 |

Go 源文件/SQL/合同 manifest 在最终全量前后逐文件 SHA 验证一致，manifest SHA256 为 `3d603300d8f0e448cf599767ab9ff3a88d99eabee7a1d402cb17da5fb62d518e`。前端 58 个 src/tests 文件 manifest SHA 为 `b8f65d1d83fd8cbcc4af1ec57bade6a28cf5fd4fb88a8f5249e8f7c6ee2ebcde`。

最终前端构建为 `index-mP3EBj64.js` / `index-BEpCc0Of.css`，HTML SHA256 `26c862e9409b639ab6899e056bcbb08bcbd218b6c5092778702526a5d9767cda`。这些是本轮开发构建，不作为财务 Release 资产上传。

## Ubuntu22 真实隔离 MySQL / TLS

在现有 Ubuntu22 测试机另启原生 MySQL8.4.13，仅私有 Unix socket、禁止网络监听、MemoryMax=256MiB；各测试创建并删除自己随机命名的 `_test` 数据库，没有连接财务库。

| 测试 binary | 结果 | SHA256 |
| --- | --- | --- |
| 控制器（含 schema 5、metrics、网络 Console wiring） | 320 PASS 事件，0 SKIP/FAIL | `5ecb65d80eefdea57bc1de36c82c7809acce496cc8fe5cdd828701fb29dfcd2c` |
| 身份/会话/RBAC（最终 schema 5） | 27 PASS 事件，0 SKIP/FAIL | `768a3291f7c5bc6cd104cb10455769c26d631969ec9c8d1ab991b22e676e5cd8` |
| 网络/IPAM | 73 PASS 事件，0 SKIP/FAIL | `b9a79a8d14b54f7d26a3ce6691b506099e63a5efc13b4bc1b25f2731d7069321` |
| root 保护策略 + 实际 HTTPS 适配器 | 16 PASS 事件，0 SKIP/FAIL | `756f72f1ff3ea0dd1de6671b97e061601855cdb584cd7d4091c2d36762a763e3` |

这些远端测试 binary 由 Go1.26.4 交叉编译，**不是 race binary 或安装产物**。源码在后续 Go1.27.3 上完成全量 race/构建/扫描；最终 GitHub CI 另在 Go1.27.3 上运行实库 race，不套用旧提交的 Actions 成功。

实库覆盖持久化/完整意图重放/跨 actor 冲突、最后地址并发、跨池重复地址、禁用池/错误实例归属/已删除实例、schema 形状冲突、真实 TLS Cookie/CSRF/逐方法权限和原 ID 查询。TLS 适配器测试覆盖原始绑定、409、错误 order/digest、重复/额外字段、重定向、断线、超大回包与不受信 CA；控制器响应为合同替身，不是实际 VM。

一次 SSH 网络波动截断上传，未执行残缺 binary；重新传输并核对 SHA 后执行。测试已完成但 SSH 丢失响应的 networking 日志从专用目录取回核对，不把网络故障算作产品失败或跳过成功。

## 本轮修复的实际问题

- libvirt8 `domstats --raw` 字符串实际可不带引号，修正 parser/夹具；guest balloon-unused 没有新鲜 last-update 则返回 null。
- 网络创建的部分意图不再误清 pending；池地址次序变化不会产生第二次 POST；过时页面/会话/权限回包和异步 hash 间隙不能确认旧请求；非 201、重放标记或无效 cursor 不冒充首次成功。
- 新导航入口对应的旧测试夹具补齐第 6 路由；没有删测试、放宽权限或改变生产协议来通过。
- OVS `verify` 拒绝历史未决记录、缺失/被替换 desired 文件、丢失/漂移 flow、meter、端口身份；只读命令另有白名单。独立代码复核和 150 个 fabric/CLI race 事件通过，包含在上述全量，不重复累加。

## 清理与明确未验证项

已停止本轮独立 MySQL，删除专用目录、临时数据库、随机 DSN/配置和上传程序，关闭 SSH master；财务 API、edge、原 MySQL 三服务仍 active。本轮没有创建 CA、改钥匙串、改宿主网络或重启财务服务。

**没有完成**：真实 OVS 包隔离/吞吐/重启故障、KVM guest 启动与 SSH、DB→fabric→VM 网络门禁、路由 VPC/网关/NAT/DHCP/IPv6/跨节点私网/浮动 IP、实际磁盘恢复与双宿主迁移、主控原生安装/备份恢复/回滚、这一批新页面的真实手机/桌面浏览器截图。旧截图不充当新页面证据。新增 schema 5 不能仅替换旧 binary 回滚，见 [运维说明](../deploy/controller-OPERATIONS.md)。

原始结果、初次失败、源码冻结清单、构建 SHA 及清理回执保存在 ignored `aster-cloud/artifacts/kvm-enhanced-20261023/`。main 推送及 CI 只证明相应开发检查，**不代表完整加强版已交付或可以上架出售**。
