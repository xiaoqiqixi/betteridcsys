# 运行时插件协议与信任边界

实现目标为 Linux amd64 的 Core `0.4.0` 与独立 SMTP `1.0.0`。安装/操作见 [PLUGINS.md](PLUGINS.md)，实际执行结果见 [VALIDATION.md](VALIDATION.md) 和对应 Release 来源。本文件说明协议与边界，不能替代原生进程/版本替换的实际验收。

## 被动发现与明确批准

Core 读取 `PLUGIN_DIRECTORY` 下的 `<id>/<version>/manifest.json`，最多 32 个 ID、每 ID 16 个版本。发现只读 manifest，不执行二进制、启动进程或连接 socket。当前类型只接受 SMTP 插槽，不自动扩展支付、主控/被控、通用文件或命令能力。

只有 root 管理的 `PLUGIN_POLICY_FILE` 明确启用的版本能接收调用。路径检查逐层以目录文件描述符和 `O_NOFOLLOW` 验证，不允许 symlink、共享可写目录、额外硬链接或非普通程序文件；manifest 与二进制摘要固定。安装/选择/批准工具只由主机管理员使用，API 无写权限、sudo 或服务控制权限。

每个版本安装新目录，禁止原地覆盖。策略按 revision 检查并原子替换，不以 symlink 选择插件；旧版本保留。Core 下次请求重新核验策略和文件，不需重编/重启。root、系统内核、安装渠道及已审查程序属于信任基础。

## Manifest、策略与版本

Manifest schema 1 包含：

```json
{
  "schema": 1,
  "id": "email.smtp",
  "version": "1.0.0",
  "protocol": "aster.smtp/1",
  "core_min": "0.4.0",
  "core_max_exclusive": "0.5.0",
  "capabilities": ["smtp.send"],
  "executable": "plugin",
  "sha256": "<真实程序的64位小写SHA-256>"
}
```

上例摘要是说明占位符，不能安装。兼容区间包含下界、不含上界，版本是无前导零的 `major.minor.patch`；当前协议不接受任意 prerelease 标识。Core 与 SMTP 版本独立，协议不兼容需新协议/兼容声明并重新验收，不能改包名制造兼容。

策略 schema 1、正整数 revision，选择记录包含 enabled、id/version、manifest_sha256、非零且不同的 worker_uid/client_uid、绝对 socket 路径及最多八个精确 host/port 目标。策略不含任何凭据。关闭状态不允许发送；第一次选择使用缺失策略的 revision 0，写入后必须取新 revision。

主机/端口匹配按配置字符串精确比较，不是域名后缀、URL 或 IP 范围规则；DNS 解析结果与网络出口仍由主机策略审查。不要声称 manifest 白名单等于操作系统出站隔离。

## Unix HTTP/JSON

只使用 Unix socket，HTTP 固定 Host `plugin.local`，POST、`application/json`，不支持查询参数、重定向或任意路由。双方检查 `SO_PEERCRED` 的 UID，socket/父目录权限限制连接。接入最多八个并发连接；每连接只允许一次握手和一次发送。

| 路径 | 请求 | 响应与限制 |
|---|---|---|
| `/v1/handshake` | protocol、core_version、随机 32 字节 nonce 的 64 位 hex | protocol、id、version、sha256、capabilities 与原 nonce；核对批准 manifest |
| `/v1/smtp/send` | protocol、version、同 nonce 的 request_id、timeout_ms、本次 config/message | accepted 或 failed、固定 code、delivery_uncertain；一次连接最多一次 |

**握手与秘密发送使用同一连接。** 如果握手后断线，不重连复用许可，不向另一进程发送凭据。插件身份是已批准程序 hash 自报告和 peer UID 的组合，结合宿主执行已验证 inode，防止误版本/意外替换；它不是受侵害 worker UID 的密码学远程证明。

JSON 限制：manifest 8 KiB、策略 16 KiB、RPC 请求 512 KiB、响应 8 KiB，嵌套最多八层，每对象键/数组元素最多 64。请求额度包含 JSON 转义开销，正文自身仍最多 64 KiB。拒绝重复/大小写别名键、未知字段、null、无效 UTF-8、尾随 JSON、非法版本/状态/摘要；发送响应的五个字段必须完整存在。关键字段使用类型化验证，不用 `Execute(map)`。

Core 连接最多一秒，握手最多两秒，发送调用最多十二秒；较短调用方 deadline 优先。这些期限约束 RPC，不保证本地文件系统读取/哈希或整个管理员 HTTP 请求的总耗时。响应失败、异常分类、panic、发送后连接丢失均按无法确定是否接受处理。Core 不重试 RPC；三次连接/协议失败后短暂熔断五秒，新批准版本重新开始判定。

## 秘密、隔离与日志

Core 负责授权、CSRF、设置 revision、AES-256-GCM 解密、限速与审计。插件只得到当前 SMTP 连接参数/认证凭据、单个收件人与固定测试内容；没有数据库/Store、会话秘密、SMTP 加密密钥或迁移/备份秘密接口。不能把同机不同 UID 理解为主机管理员也无法读秘密。

`aster-plugin-host` 以插件 UID 运行，root/同 UID 调用方拒绝。它以已核对 SHA 的文件描述符执行精确 ELF inode，清除应用环境、用 Linux `close_range(CLOEXEC)` 防止继承额外描述符，关闭 core dump、限制文件数、设置 no-new-privs。需要 Linux >=5.11 支持该调用；不支持时拒绝启动，不降低保护。基线 Ubuntu 24.04 满足要求。

systemd unit 使用独立 UID、只读文件系统/秘密不可达、设备/内核/能力/写入限制与 CPU/内存/进程边界；插件崩溃按启动频率限制恢复，不影响 Core 地址空间。插件 stdout/stderr 关闭，HTTP 原始错误日志丢弃，只保留 service 生命周期与固定 RPC 错误分类；不在日志输出凭据、正文、收件人、原始 SMTP 回复或主机秘密路径。

这是受信插件的进程与权限隔离，**不是恶意代码完整沙箱**。已获发信能力的插件必然接触本次秘密并可使用网络；还需代码/渠道审查、主机出口控制及独立凭据撤销。崩溃后停止服务能阻止新调用，不能撤回已接受邮件，也不能证明未知在途结果未发送。

## 当前能力与支持边界

只有 `smtp.send` 运行时能力，Core 的业务入口进一步限制为管理员固定测试。没有任意文件、shell、数据库、主控/被控或账务修改能力。兼容性承诺仅限明确区间、当前协议和实际验证组合；尚无 LTS/SLA、自动插件升级、自动回退或跨版本数据迁移保证。

插件升级/回退只切换 SMTP 程序及策略；Core 文件/进程保持不变的结论必须由原生验收中的哈希/PID/业务检查证实，单元测试、manifest 或本文不能作为替代证明。
