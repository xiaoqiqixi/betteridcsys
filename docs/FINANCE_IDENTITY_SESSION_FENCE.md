# W07-B2：财务账户写入的原会话事务边界

2026-10-26；独立安全切片，不是财务员工权限组/MFA已实现。Core0.5.10的schema13、旧001–013、金额/支付/历史快照不变。

## 静态发现与最小复现

账户HTTP先`current()`读取session和user，再进入`WriteCustomerAccount`。
该方法在`email_settings`单行锁后只复核active admin，没有复核原session。
因此需要实际验证：认证完成的账户写排队期间，管理员注销/原会话到期或轮换；放行锁后旧请求能否仍写账户。
不能以另一个仍有效会话、同一user ID或当前角色仍为admin代替原请求凭据。

## 合同

- HTTP从已通过验证的服务端Cookie派生完整hash及actor绑定，仅通过私有context传给账户store；不是JSON/header新字段。
- 缺context、坏hash、actor不匹配直接拒绝；没有optional legacy bypass或伪造默认会话。
- SQL顺序保留已有全局账户串行边界：email_settings X → 原session X且owner/expiry准确 → actor SHARE → target/revision/最后admin → 修改/删session/审计 → commit。
  原session一开始取X，避免本人改密/撤销需要删该行时，在排队logout的X请求后再做S→X升级。
- 取得session X后，用下一条语句的数据库UTC时间检查expiry；不得将UTC_TIMESTAMP放在可能长时间等锁的读取语句里。
  MySQL在语句开始固定当前时间，已实际复现：语句开始有效、等锁期间已过期，旧predicate仍返回该行。
  使用数据库时间而非客户端时钟，不延长已过期会话，也不因为同owner有新会话就给旧请求续命。
- Memory在同一业务互斥锁内做等价复核。已签发会话不按用户普通改名revision全部失效；revision仍只承担既有登录发行竞态与表单并发语义。
- 原session在锁前已撤销/到期则完整401，不改目标、不删除目标会话、不落成功审计；网络/数据库异常不能当401成功。
- 原session检查通过后与logout并发，行锁使事务与logout有明确先后；不倒置现有用户/财务审计FK锁序。
- 创建、更新、改密、显式撤销四动作都必须覆盖。已经签发给同owner的新会话不授权旧请求。

## 验证

1. 真实HTTPS HTTP四动作先复现旧会话注销后仍提交，再修复。密码只用测试夹具值，不导出Cookie/hash/CSRF。
2. 真实MySQL持有账户串行锁，通过performance_schema确认旧请求真的等待，再注销/到期/轮换，要求完整401。
3. 目标账户/目标会话/成功审计及其他全部业务表保持不变；正常新登录、新会话及普通改名后原已发会话仍可用。
4. 保留原最后admin、并发互相降权、审核失败回滚、密码登录竞态、CSRF、分页、精确字段和财务回归。

2026-10-27实施记录：完整Go测试包已交叉编译为Linux/amd64，Linux目标go vet通过；本机Darwin受Linux runtimeplugins构建约束，
没有将无法执行的测试算通过，也没有把未执行的旧HTTP测试写成RED。等锁时间primitive另在本机实际MySQL8.4.11独立临时库复现，
并验证取得锁后新语句拒绝过期行，原库/业务表未动，临时库已删除。
新增严格TLS四动作、原会话10类拒绝、实际SQL锁等待下logout/expiry/同owner轮换、锁内过期、本人删session与并发logout负例；
完整Linux HTTP/MySQL/race结果仍须由新提交的22/24 CI实际运行。

依据：[MySQL当前时间函数在语句开始求值](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html)。

本包只加账户身份写fence，不宣称所有其他财务写、MFA、staff授权或数据库强制append-only已完成。
