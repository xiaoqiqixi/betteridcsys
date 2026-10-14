# Security and production-readiness review

## 维护轮次补充审查（2026-10-14 UTC）

本节记录本轮独立源码审查及已核对的测试日志。下方保留此前的历史记录；其中“MySQL 尚未运行”、旧测试数量及“审计仅覆盖订单”的表述不再代表当前状态。后续浏览器、Compose、恢复与发布包验证结果以 [验证记录](../docs/VALIDATION.md) 为准。本记录不是渗透测试认证、生产上线许可或真实收款验收。

### 审查范围与修复

独立审查覆盖管理员权限、会话与 CSRF、客户资源所有权、公开设置字段、设置渲染及外链、按币种定价与汇总、幂等请求、订单/账单身份快照、MySQL 事务和迁移恢复，以及禁用支付/邮件适配器边界。审查者没有部署、发布或调用真实支付/邮件服务。

本轮发现并由实现代理修复的问题包括：

1. **安全整数金额仍可能少显示一分。** `9007199254740991 / 100` 经 JavaScript 浮点格式化会显示末尾 `.90`，实际应为 `.91`；审查者使用 Node 复现。前端现以 BigInt 整数部分和余数格式化，测试覆盖金额上界。后端金额与汇总也受精确整数上界限制。
2. **下单结果不确定时可能丢失原幂等键。** 超时后的 401/403/限流等响应不能证明原订单未创建。前端现保留原请求内容和幂等键，按账户隔离；重试前刷新会话，账户变化时不重发。另修复 `VALIDATION_ERROR` 映射，允许首次确定的输入错误被纠正。测试覆盖超时、403、切换币种、再次打开弹窗和账户变化。
3. **数据库币种约束不够精确。** 默认 MySQL 排序规则可能把大小写及重音不同的字符串视为相等。迁移 005 对订单、账单和服务增加按字节匹配的币种约束，真实 MySQL 测试拒绝 `EUR`、`usd`、`cny` 及带重音变体。
4. **历史身份快照存在遗漏和引用共享。** 订单现在与账单一起保存开具方身份；修正前后端身份字段不一致，内存存储返回快照副本，避免调用者修改返回值后改变历史记录。更换设置、默认币种或价格后，重放仍返回原金额、币种和身份；缺少历史身份时不补用当前公司信息。
5. **迁移可能误删运营方约束。** 现仅识别原始迁移生成的特定 USD 检查约束；执行业务 DDL 前验证完整连续的迁移历史。中断恢复核对已存在列及约束的实际定义，不仅检查名称。测试覆盖冲突定义、未启用约束、未知版本、checksum 变更、版本缺口及保留自定义约束。
6. **展示设置的前后端校验和恢复提示不一致。** 现将展示文本与可点击链接的安全校验区分处理，并同步表单规则；标志与主题仍为固定选项，没有任意 HTML/CSS/脚本、远程素材抓取或 DNS/TLS 配置入口。管理员会话失效、版本冲突和保存结果不确定均有对应处理。
7. **非规范 APP_ORIGIN 被接受后会使合法写入失败。** 启动校验现拒绝空查询标记和空片段标记等含糊来源，配置回归已覆盖。

同时复核了上一检查点的 MySQL TLS 明文回退拒绝、IPv6 限速地址归一化、JSON 媒体类型校验、管理员账单详情权限与迟到响应隔离。源码复核未发现这些路径被本轮改动撤销。

### 已核对的实际证据

以下日志由主任务及实现代理在云端执行后生成，独立审查者读取并核对结果；并非审查者另行重跑全部测试。证据目录：`/workspace/aster-validation-20261014/`。

| 证据 | 实际结果与范围 |
| --- | --- |
| `backend-race-mysql.log` | Go race 测试：38 项顶层测试、50 项子测试通过，0 失败、0 跳过。包含真实一次性 MySQL 的迁移 1–5、重复迁移、历史 USD 升级、中断恢复、16 请求并发幂等、跨币种冲突、金额/身份快照及按币种汇总。 |
| 同一后端日志的事务测试 | 在 outbox 写入处注入失败，检查订单、账单、审计及幂等预留回滚；在设置审计写入处注入失败，检查设置内容与 revision 回滚。合成已付数据仅用于汇总测试，没有真实结算操作。 |
| `frontend-final.log` | 62 项前端测试通过，类型检查和生产构建通过。格式检查首次发现一项测试文件格式问题，修正后再次检查通过。 |
| `http-final.log` | 13/13 HTTP 安全回归通过；使用回环地址上的演示内存服务，不能替代 MySQL 测试。 |
| `config-final.log` | 8/8 启动配置回归通过，包括含糊来源及未知支付/邮件提供商拒绝。 |
| `npm-audit.json` | 本次 npm 审计报告已知漏洞总数为 0；不代表依赖或业务逻辑无漏洞。 |
| `govulncheck-baseline-binary.txt` | Go 漏洞数据库请求返回 `Forbidden`，扫描未完成。此前 `govulncheck.txt` 还记录了不在模块目录执行的失败；两者均不能记为扫描通过。 |

本节写入时，主任务的浏览器、Compose 和发布包验证仍在进行，未在此提前记为通过。恢复演练、容器运行范围及可复现打包证据由最终 [验证记录](../docs/VALIDATION.md) 记录。

### 保留的边界

当前没有真实支付、邮件发送、webhook 落账、退款、完整账本/对账或控制器开通；已编译服务仍使用禁用适配器。接口和测试用替身不等于这些能力已实现。设置写入具备管理员权限、CSRF、版本冲突控制和事务审计，但不代表已有完整账号安全审计或不可篡改审计账本。

公开商业运营前仍需完成账号恢复/改密、管理员 MFA、会话管理、分页与完整导出、分布式滥用控制及具体运营环境的安全和恢复验收。本轮真实 MySQL 证据也不能扩大为所有断网时序、每条 SQL 的故障注入、负载或长期稳定性均已验证。浏览器刷新后不确定订单请求的客户端状态不持久化，必须核对历史订单，不能假设请求未执行。

## 此前基线记录（保留历史证据）

Reviewed 2026-10-14. Scope: the Go API, MySQL schema/store, startup configuration, and local HTTP behavior. This is an engineering review, not a penetration-test certification or an authorization to deploy.

## Verdict

**Not ready to accept real money or host production customer operations.** The implemented order/invoice foundation passes the local security regressions below. Live payment confirmation, a financial ledger/reconciliation workflow, a provisioning consumer, recovery drills, and actual MySQL integration evidence are still absent. The demonstration must remain local and clearly labeled.

## Executed evidence

- `tests/security_smoke.py`: **10 tests passed** against a freshly built Go binary in explicit demo mode on loopback. Results: `tests/http-smoke-results.txt`.
- `tests/config_smoke.py`: **5 tests passed** against that binary. Results: `tests/config-smoke-results.txt`.
- `go test -buildvcs=false -race ./...`: passed independently, including backend package tests (16.112s). No race was reported in the tested paths.
- No MySQL server, container runtime, external deployment, real payment, or actual resource provisioning was exercised by this reviewer. HTTP tests use the in-memory store. In particular, concurrent HTTP idempotency passing does **not** establish MySQL locking behavior.

HTTP tests check unauthenticated data/admin denial; customer/admin separation; positive admin read access without password hashes; login and mutation CSRF; foreign Origin rejection; hostile Host rejection; HttpOnly/SameSite cookies; login token rotation; logout invalidation including replay of the old cookie; server-authoritative pricing and unexpected amount fields; identical idempotency replay; different-body conflict; six simultaneous duplicate submissions yielding one order ID; fail-closed checkout preserving unpaid state; and another customer's denial on invoice detail and checkout.

Configuration tests check that default startup is not demo, example secrets fail, production HTTP origin fails, missing MySQL configuration fails, and an unknown mode fails.

## Findings fixed during review

1. **Invoice detail silently lost records after the newest 1,000.** Replaced capped-list scanning with direct owner-scoped lookup in `backend/internal/billing/http.go` and `mysql.go`.
2. **Financial/admin summary counts could truncate at 1,000.** `Summary` now uses full SQL aggregates in a repeatable-read read-only transaction; list caps no longer define the totals.
3. **Proxy clients shared one login IP budget.** Explicit trusted proxy CIDRs and validated `X-Real-IP` handling added in `http.go`. Deployment must supply the correct narrow trust boundary; arbitrary forwarded headers from untrusted peers are ignored.
4. **Host was not validated.** Production uses the canonical origin host; demo now permits the canonical host or localhost/loopback. Hostile-host HTTP regression passes.
5. **Order transactions lacked transient lock retries.** MySQL deadlock/lock-timeout errors now trigger at most three attempts with rollback and context-aware waits. Actual lock contention remains untested.
6. **Schema migrations had no version/checksum record.** Initial schema now records its checksum under a migration lock and readiness checks the expected record. This is an initial migration foundation, not proof of future upgrade/rollback safety.

## Remaining release blockers and bounded limitations

### Must close before real financial operation

- **No live payment/provider webhook state machine.** Checkout deliberately returns 503. Do not replace this with a client-controlled paid flag. Before release, implement verified signed webhooks, provider-event deduplication, exact amount/currency matching, atomic paid transitions, refund/chargeback handling and reconciliation against immutable journal entries. Current invoice/order fields are not a full accounting ledger.
- **MySQL runtime evidence is missing.** Run migration against the supported MySQL version, test real transaction rollback at each insert, same-key concurrency, conflicting replay, plan availability changes, 1,000+ record summaries and old-invoice lookup, connection interruption/ambiguous commit replay, session revocation after restart, and backup restore. Schema correctness cannot be inferred from demo-memory tests.
- **Outbox is durable storage only.** `CreateOrder` transaction writes `order.created`, but no consumer/claim lease/retry/dead-letter/delivery deduplication implementation exists. This event is pending payment and must never be treated as authorization to provision. Add a separately authorized, idempotent paid-order workflow before any controller integration.
- **Operational security and recovery remain unvalidated.** No deployed TLS/edge verification, backup restoration, alerting, secrets rotation, external dependency-vulnerability assessment, or load/abuse test has been performed.

### Must define before exposing real customer/admin accounts

- Authentication is password/session login only. There is no implemented password recovery/change workflow, administrator MFA, or user-facing revoke-all-sessions/security response flow. Logout correctly revokes the current session; passwords/roles are looked up server-side each request. Add an explicit incident/recovery procedure and tests before exposure.
- Audit events currently cover order creation, not a complete durable authentication/admin change trail. Implement reviewed successful/failed authentication, account-security and administrative events without logging passwords/tokens.
- Login rate counters are in-memory and per-process. A restart resets them and multiple replicas do not share a budget. Configure and validate edge/distributed abuse controls, especially proxy topology and shared-IP users, before public operation.
- List endpoints still return a maximum of 1,000 without a cursor/has-more contract. Full aggregates and direct invoice access are fixed, but large-account browsing/export is incomplete. Add explicit pagination and archival/export policy.
- Expired database sessions and idempotency/outbox/audit retention need bounded, documented operational maintenance. Do not delete financial audit history merely to reduce storage.

## Reproduce local tests

From the repository root, build the backend, start a fresh loopback demo instance, then run:

```sh
cd backend
go build -buildvcs=false -o /tmp/aster-security-server ./cmd/server
cd ..
APP_MODE=demo APP_ORIGIN=http://127.0.0.1:18080 LISTEN_ADDR=127.0.0.1:18080 /tmp/aster-security-server &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1
TEST_CUSTOMER_PASSWORD='DemoCustomer!2026' \
TEST_ADMIN_PASSWORD='DemoAdmin!2026' \
TEST_SECOND_EMAIL=other@aster.local \
TEST_SECOND_PASSWORD='DemoOther!2026' \
python3 tests/security_smoke.py --base http://127.0.0.1:18080
python3 tests/config_smoke.py --binary /tmp/aster-security-server
```

These are published local-demo credentials only. Never use them for a production account. Run the suite against a fresh demo process to avoid consuming the login limiter budget across repeated test runs. For a distinct frontend origin pass `--origin` or `TEST_ORIGIN`; no CORS relaxation is required for the same-origin proxy architecture.

## Provider adapter addendum (2026-10-14 03:51 UTC)

Independent final-current checks: Go race/vet/build pass, HTTP 11/11 and production config 5/5 pass, frontend build and 21 component/unit tests pass. New HTTP test verifies integration manifest is administrator-only, read-only, disabled by default, and contains no config values. Payment checkout remains fail-closed with no real providers. The registry introduces trusted compiled adapter boundaries, not isolation of malicious third-party code. No runtime plugin upload, outgoing payment/email execution, real webhook settlement or database evidence was added. Existing production blockers remain.
