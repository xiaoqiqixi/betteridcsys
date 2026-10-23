# 网络资源与 IPAM API（开发实现）

2026-10-23。本文只描述持久网络意图、地址池和地址预留；它们不是 OVS 已接线、VLAN 已隔离或客户公网已可访问的证明。原生 KVM/OVS 实机验收仍未进行。

## 安全边界

- `internal/networking` 使用独立 `Store{DB *sql.DB}`，与主控其他写操作共同锁定 `controller_lock.id=1`。只写三张网络表及同事务 `controller_audit`；不修改实例 resources、金额/支付/订单快照、容量预留或节点信任根。
- `NewHandler(store, approvedNodeIDs)` 必须放在 `identity.Require` 的 HTTPS/origin/实时会话/CSRF 保护后。主控 Console 路由基础要求 `nodes.read`，处理器自行再次要求 GET `nodes.read`、POST `nodes.manage`，因此正式 Console 的 POST 必须同时拥有 **`nodes.read` + `nodes.manage`**；custom 角色须显式授予两项，operator 没有 manage 不能写。独立可复用处理器的测试会分别验证其逐方法权限，不表示放宽正式 Console 的组合要求。不是隐藏按钮授权。所有写入均检查构造时复制的批准节点列表，Store 再检查节点确实存在于主控 registry。
- 节点 endpoint、证书、root 路径、宿主命令及 OpenFlow 字符串不是这些接口的输入。处理器从不运行宿主网络命令。
- VPC 状态固定为 **`planned`**，租约固定为 **`reserved`**。地址池 `enabled=true` 只允许预留，不表示数据面已应用。
- 没有 DELETE、free、自动超时回收或释放接口。未知操作/未确认宿主解绑不能据此释放地址，迁移或删除实例也不会自动释放。

## 路由与返回

基础路径：`/console/v1/networks/`。

| 方法/路径 | 输入 | 成功返回 |
| --- | --- | --- |
| GET `vpcs` | 可选单个 `cursor=<32hex-id>` | `{items: VPC[], next_cursor: null|string}` |
| GET `pools` | 同上 | `{items: IPPool[], next_cursor: null|string}` |
| GET `leases` | 同上 | `{items: Lease[], next_cursor: null|string}` |
| GET `vpcs/:id` | 无 query | `{vpc: VPC}` |
| GET `pools/:id` | 无 query | `{pool: IPPool}` |
| GET `leases/:id` | 无 query | `{lease: Lease}` |
| POST `vpcs` | CreateVPCInput | `{vpc: VPC, replay: boolean}` |
| POST `pools` | CreatePoolInput | `{pool: IPPool, replay: boolean}` |
| POST `leases` | ReserveInput | `{lease: Lease, replay: boolean}` |

列表按 ID 的 ASCII 顺序升序，最多 100 条，使用最后实际返回 ID 作游标；不接受用户自定 limit/order。池列表仍返回完整 addresses，但额外受约 512 KiB JSON 总预算限制，可能不足 100 条就返回 next_cursor。客户端应依 next_cursor 连续读取，不能把不足 100 条直接当最后一页。详情返回完整单个对象。

POST 使用 `Content-Type: application/json`、现有 CSRF 及唯一 `Idempotency-Key: <32 lowercase hex>`。该 key 即资源 ID。首建 HTTP **201**，同 actor、同资源类别、同强类型意图重放 HTTP **200**；不再插入记录/审计。换参数、换 actor 或跨类别复用同 key 为 HTTP **409**。

JSON 严格拒绝未知/大小写别名/重复键（含转义重复）、null、缺字段、错误类型、尾随值及深度超过 8 的结构。所有下列字段均显式提交，经典池 `vpc_id=""`、自动分配 `address=""`。最大 body 为 128 KiB，支持完整 4096 地址池，不误用 64 KiB 上限。

### VPC

```json
{
  "id": "0123456789abcdef0123456789abcdef",
  "owner_ref": "11111111111111111111111111111111",
  "node_id": "node-a",
  "name": "香港私网",
  "cidr": "10.10.0.0/24",
  "vlan_id": 42,
  "state": "planned",
  "created_at": "2026-10-23T01:02:03.123456Z"
}
```

CreateVPCInput 仅包括 `owner_ref,node_id,name,cidr,vlan_id`。

- RFC1918 IPv4，规范网络前缀 `/16` 至 `/30`，拒绝 host bits/前导零/IPv4-mapped IPv6。
- VLAN 1–4094，同节点唯一；首版同节点 VPC 的 CIDR 一律不重叠，即使 owner 不同。此约束比后续允许不同 VLAN 重叠私网更保守。
- 这是单节点管理对象，不代表跨节点 fabric。后续跨节点 VLAN 必须新增 fabric 作用域，不把当前 node 级唯一键伪称全 fabric 唯一。

### 地址池

```json
{
  "id": "22222222222222222222222222222222",
  "node_id": "node-a",
  "vpc_id": "",
  "name": "香港地址池",
  "cidr": "192.0.2.0/24",
  "gateway": "192.0.2.1",
  "addresses": ["192.0.2.2", "192.0.2.10"],
  "enabled": true
}
```

CreatePoolInput 是上述对象去掉 `id`。文档 IP 为示例，不能自动部署为客户公网。

- 明确 IPv4 地址数组 1–4096 条；必须在规范 `/8` 至 `/30` 池内，排除网络地址、广播、网关、重复、IPv6、非规范表示及不支持的地址类型。不以地址范围隐式扩展百万条记录。
- 网关自身须为该前缀内的可用主机地址。`vpc_id` 非空时池必须与目标 VPC **节点和 CIDR 完全一致**。
- 返回/存储前复制并按 IPv4 数值排序。仅地址数组顺序、JSON 空白/键顺序差异视为同一意图；地址成员、网关、enabled 等变化不是重放。
- `vpc_id=""` 代表 classic 池；注册某个池不证明运营者实际持有这些地址或上游路由已配置。

### 租约

```json
{
  "id": "33333333333333333333333333333333",
  "pool_id": "22222222222222222222222222222222",
  "vpc_id": "",
  "node_id": "node-a",
  "instance_id": "44444444444444444444444444444444",
  "owner_ref": "11111111111111111111111111111111",
  "address": "192.0.2.2",
  "state": "reserved",
  "created_at": "2026-10-23T01:02:03.123456Z"
}
```

ReserveInput：`pool_id,instance_id,owner_ref,address`。空 address 按数值选择第一个可用地址，非空只选择指定池内地址。

事务校验实例存在、未删除、owner 和节点一致；VPC 池额外要求 VPC owner 一致。禁用池不能新增预留。数据库唯一键同时约束 `(pool_id,address)` 与 `(node_id,address)`，防止两个重叠 classic 池把同一物理地址分配两次。并发争抢最后一个地址只能一个成功。

## 丢响应后的前端规则

写前在本地持久记录原资源类别、ID、actor 和冻结参数；失败不得换 key 重发。当 POST 响应丢失，只用原 ID 的单项 GET 核对。详情必须验证完整原绑定：不能仅凭对象形状或同地址就清掉待确认记录。GET 未找到、网络错误或服务不可用都不等于“创建失败可以换 ID”。原 key 的明确同意图重放存在于后端契约中，但浏览器不应对未知写结果自动重试。

错误结构统一为 `{error:{code:string}}`：

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 非法参数、query/body/key |
| 401 | `AUTH_REQUIRED` | 无有效 Actor；外层会话/认证仍使用其既有 code |
| 403 | `FORBIDDEN` | 缺 grant、未审批节点或 owner/节点关系不匹配 |
| 404 | `NOT_FOUND` | 原 ID、实例、节点或池不存在 |
| 409 | `REQUEST_CONFLICT` | key 的意图/actor/类别改变；VPC VLAN/CIDR 冲突 |
| 409 | `IP_POOL_EXHAUSTED` | 指定/自动可用地址已用尽 |
| 409 | `NETWORK_STATE_CONFLICT` | 池禁用、实例删除等状态冲突 |
| 415 | `JSON_REQUIRED` | 非 JSON |
| 503 | `NETWORK_UNAVAILABLE` | 持久状态无法确证；不回显 DSN/SQL/请求正文 |

## 迁移与测试

迁移 **005** 只新增三张网络表。`CheckMigration(ctx, reader, true)` 供未记录版本的 DDL 前只读预检：缺表允许重入，已存在表的列类型、长度、字符序/NULL/时间精度和保留索引必须准确。完整 `Store.Check` 不允许缺表；错误保留索引不得静默重建/接受。额外运营者索引不被删除。

旧主控二进制不认识 schema 5，不能仅替换旧 binary 回滚；须停写、备份、使用兼容应用或按已演练的完整数据库恢复方案回滚。没有提供网络对象自动降级/删除迁移。节点执行器的新网络协议/journal 升级为另一个独立验收边界，不能混为本次 MySQL 迁移。

测试入口：

```sh
GOCACHE=/private/tmp/aster-cloud-go-cache go test -race -count=1 ./internal/networking
```

真实 MySQL 使用 `ASTER_NETWORK_TEST_DSN` 或 `ASTER_CLOUD_TEST_DSN`（必须含 `_test`）；CI fallback `ASTER_MYSQL_TEST_DSN` 仅接受 `aster_ci_test`。只接受 private Unix socket 或 literal loopback TCP，不接受跳过 TLS 验证/多语句/危险文件选项。测试使用借用的服务器权限创建并清理自己随机独立的 `aster_cloud_test_network_*` 数据库，不 truncate 原测试库或财务库；不回显凭据。没有 DSN 则明确 SKIP，不能算实库通过。

覆盖输入/4096 上限、canonical replay、越权、池禁用、地址耗尽、并发唯一、重启查询、固定/字节预算分页、GET 不改状态、schema 冲突/部分 DDL 及真实 HTTPS Cookie/CSRF/RBAC。所有数据均为合成记录；不运行 KVM、OVS、公网路由或实际地址绑定。
