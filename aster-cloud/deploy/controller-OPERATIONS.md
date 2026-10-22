# 独立主控：首条安全垂直链（非完整云平台）

此程序与财务使用独立进程、独立数据库/账号、独立权限和审计。它只接收财务的不可变开通请求，不读取金额、不签收付款、不修改财务表，也不把 accepted 画成已开机。当前外部效果仅为显式主机操作员调用 `dispatch`；HTTP接单不会同步创建VM。节点必须另行root审批mTLS策略、image/storage/network和静态IP资源。

## 初始化与启动

程序目标为原生Linux，无Docker。需MySQL8兼容InnoDB及正确UTC时间、根控制的TLS和节点mTLS文件。默认服务监听127.0.0.1:9443并强制TLS，不能由HTTP明文降级或信任X-Forwarded-Proto绕过。外部TLS终结若不能把后端TLS保留则不受支持；不要以修改Handler代替正确配置。

```
aster-controller init -config /etc/aster-controller/config.json
# init仅生成0600 root配置和三个互不相同的随机token文件，不打印token。
# 操作员填写独立MySQL DSN文件、服务器证书/私钥、已批准node profiles和presets。
aster-controller migrate -config /etc/aster-controller/config.json
aster-controller check -config /etc/aster-controller/config.json
aster-controller register-nodes -config /etc/aster-controller/config.json
aster-controller heartbeat -config /etc/aster-controller/config.json -node approved-node
aster-controller maintenance -config /etc/aster-controller/config.json -node approved-node -on=false
aster-controller serve -config /etc/aster-controller/config.json
```

根配置和secret必须绝对、规范、root所有、单链接普通文件；拒绝软链接、共享可写祖先/文件和group/world可读secret。正式加载owner始终0。测试专用owner helper不由HTTP/CLI/配置暴露。`init`不覆盖任何已有文件，部分初始化失败须操作员核对，不自动覆盖/补偿。

DSN只允许独立`aster_controller`/`aster_cloud`及其`_`前缀子命名空间；MySQL仅Unix socket或明确loopback TCP，拒绝远端明文/skip-verify/preferred TLS及multiStatements/不安全LOCAL INFILE/旧密码选项。不是在现有财务库上增加几张表。迁移为显式命令，有内容SHA256；发现不一致拒绝。创建/升级数据库用户、TLS和备份仍是主机管理员操作，程序不自动创建生产数据库。

服务单元`controller-aster.service`提供sandbox和资源上限模板，**未自动安装/启用**。本期API进程为读取root-private策略而仍以root UID运行，但capabilities清空、只读系统、无VM命令执行；不能把它说成已经完成最小权限分离。发行前需在目标发行版实测systemd和TLS，进一步拆分非特权API身份/凭据交付。

## 根策略字段

配置包括schema=1、controller_id、listen、tls_cert_file、tls_key_file、dsn_file、billing_token_file、admin_read_token_file、admin_write_token_file、heartbeat_ttl_seconds(10–300)、nodes数组、presets数组。

node字段：id、datacenter_id、group_id、endpoint（纯HTTPS来源、不含路径/query/userinfo）、allowed_cidrs、ca_file、client_cert_file、client_key_file、server_certificate_sha256。连接同时验证CA/hostname与固定server叶证书DER SHA256；节点端另须校验controller客户端叶证书pin。DNS解析的全部地址须在允许CIDR内，单次请求固定一个地址、禁代理/重定向、禁自动重拨、POST无GetBody重放。轮换证书或endpoint改变profile SHA会阻止旧job派发/核对，须人工恢复原绑定，不能静默转送另一节点。

preset字段：id、node_id、resources（公开controllerapi.Resources全部字段）。preset以root策略固定整份资源，不随财务请求字段拼URL。custom本期要求显式具体compute_node/datacenter/group，与批准profile完全一致；不做模糊别名映射或隐含资源替换。

当前可执行资源形状：有实际capabilities的image/storage；normal + exact1IPv4/0IPv6，能力中必须明确`normal-static-ipv4-dedicated-bridge`；data_disk=0、data_storage空；bandwidth/inbound/transfer=0（root明确批准的节点默认），traffic_direction=all。isolated-no-nic不能冒充IPv4网络；VPC、额外磁盘、IPv6和非零带宽/流量不支持时明确拒绝，不忽略。节点还须有真实IP池、bridge、NoCloud/SSH和nwfilter策略；本期控制器不代替节点配置这些敏感资源。

## HTTP合同

所有响应no-store。服务直连TLS，Bearer认证；不接受浏览器Origin/CORS，不使用Cookie。三个token须不同：billing只可访问财务桥，admin-read/admin-write仅可只读管理投影。**本期没有网页管理写API、用户登录或多用户RBAC**；所有配置/心跳/维护/派发仍为root CLI。

- POST `/v1/provisioning`：公开controllerapi.Request，带`Idempotency-Key`=operation_id与`X-Aster-Request-SHA256`=canonical JSON digest。新成功接纳202；完全相同重放409，返回已持久状态；不相同operation/order绑定409 `IDEMPOTENCY_CONFLICT`。全部成功/已绑定业务拒绝均直接controllerapi.Result精确6键，**无data信封**。
- GET `/v1/provisioning/{operation_id}`：相同billing token、Idempotency-Key与digest header，200当前绑定Result；未知404，不同digest409。
- 不支持配置可以持久为rejected Result（409）；无健康容量503 `NO_HEALTHY_CAPACITY`，未创建job，不假称已接单。格式错误400、缺认证401、越权403、方法405。错误仅`{error:{code}}`，不回传路径、密钥、节点诊断或SQL。
- 管理GET `/v1/health`：真实DB ping与controller/protocol；GET `/v1/nodes`、`/v1/instances`、`/v1/tasks`、`/v1/audit`：`{items,limit:100,truncated_possible:true}`。这是最多100条的只读投影，**不是完整分页、全库搜索或导出**。不泄露node endpoint、证书路径、原始request或token。
- nodes.online仅由实际已认证心跳、TTL、配置存在、非维护模式计算，不把注册或配置存在当在线。周期心跳应由操作员安装的timer执行真实GET；不自动启用监控。

## 持久性、容量和派发

独立controller_jobs/instances/reservations/nodes/audit由InnoDB事务更新。首期用singleton行锁保守串行化接纳和状态修改（吞吐有明确上限，不冒充完整调度器）；operation、order分别唯一。容量预留/instance/job/audit同事务；重放不再预留。未知/维护/过期心跳/无足够CPU内存磁盘不接纳。register-nodes默认维护且清除旧心跳，必须实际heartbeat并显式解除维护。

**容量刻意保守双扣：**心跳用总量减节点已分配与实际available的较小值，再扣全部未释放控制器预留。成功VM的预留不会因success直接释放，避免旧心跳窗口超卖；新心跳可能再次算到现有VM，从而少卖。没有实例归属证明/代际屏障前不优化掉这层扣减。只在节点明确rejected时释放；uncertain保留。现阶段不是完整库存/调度/账单配额系统。

```
aster-controller dispatch -config /etc/aster-controller/config.json -operation 32位小写hex
# 断线/超时/进程中断/写结果失败之后，只允许：
aster-controller reconcile -config /etc/aster-controller/config.json -operation 同一ID
```

`dispatch`先事务写sending和审计，再对固定节点POST已保存原始NodeTask字节+`X-Request-SHA256`。并发/重复dispatch只有一个可claim；同node有sending/dispatched/uncertain或任何未识别状态时，其他accepted订单留在主控队列，不写sending、不增加派发审计、不POST。只有前一操作明确succeeded/rejected才释放node派发槽位，不能把failed/unknown当空闲。节点先持久接单返回202 accepted，再独立bounded worker创建，不绑定HTTP取消。accepted→dispatched；节点succeeded→主控succeeded与instance.created（**不是guest SSH、业务就绪或付款证据**）。断线→uncertain，完成状态写失败则保留sending，两者都只GET核对，不POST重试；节点404也不是自动重发许可。节点rejected必须是已绑定的无效果拒绝，否则只能uncertain。已终态不允许被反向覆盖。

后台只读job为accepted/sending/dispatched/uncertain/succeeded/rejected；财务Result为accepted/succeeded/rejected，内部sending/dispatched/uncertain对财务保持accepted，不制造失败重试。精确ResourceID是控制器instance UUID，不是IP或可任意执行路径。

## 验证与未完成项

本机单元和真实TLS/mTLS测试可用`go test -race ./internal/control`。真实MySQL测试优先`ASTER_CLOUD_TEST_DSN`且库名须含`_test`；缺env明确skip。CI仅在`ASTER_MYSQL_TEST_DSN`严格指向隔离`aster_ci_test`时创建随机独立`aster_cloud_test_<hex>`并最终drop；不改生产OpenDSN限制，不读取财务表。日志不可打印DSN/token内容。

必须分别报告真实MySQL/目标Linux测试、真实KVM/静态IP/SSH、systemd安装/证书/备份恢复。模拟node RPC、contract-shaped TLS server和SQL状态测试不等于真实VM创建。本期没有管理UI、多用户RBAC/MFA、客户操作权限、VPC、配额/告警、跨节点迁移、快照/备份、失败补偿自动重派、完整审计留存/不可篡改日志、持续健康监控或完整集群调度。
