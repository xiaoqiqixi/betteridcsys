# 版本、构建与发布

Core 与运行时插件分别采用语义化版本、构建包和 Release。当前核心为 `0.4.0`，官方 SMTP 为 `1.0.0`；SMTP 的 `aster.smtp/1` 兼容 Core `>=0.4.0,<0.5.0`。发布前必须通过与源码对应的检查；实际执行结论见 [VALIDATION.md](VALIDATION.md) 和各 Release 的来源文件，不从历史绿灯推导新版本通过。

本项目在 `main` 维护。正常发布采用公开、非草稿、非预发布的 Release；这是版本交付状态，不宣称支付、主控/被控、商业运营或安全认证已完成。发布流程不部署服务器、不操作真实付款、不发送外部邮件。root `LICENSE` 和第三方版权材料保留；根 README 可随产品变化更新。

## 交付物与独立版本

| 项目 | 标签 | 运行包 | 附加文件 |
|---|---|---|---|
| Core | `v0.4.0` | `aster-0.4.0-linux-amd64.tar.gz` | `BUILD.json`、`PROVENANCE.json`、`SHA256SUMS` |
| SMTP | `smtp-v1.0.0` | `aster-smtp-1.0.0-linux-amd64.tar.gz` | `BUILD.json`、`PROVENANCE.json`、`SHA256SUMS` |

Core 包含静态 API、`aster-plugin-host`、编译网页、安装文档、systemd/Nginx 样例、备份与插件安装管理工具、依赖清单及许可证。SMTP 包只含独立 `plugin` 程序、`manifest.json`、说明、许可证/notice 和包内校验清单；不捆绑 Core、网页、数据库或任何凭据。两者分别生成来源记录，不能用 Core 的校验和证明另一个插件包。

新程序 Release **不手动上传源码 tar/zip**。源码从 Git 对应标签取得；GitHub 自带的源码下载由平台生成。历史候选及其原资产保留，不覆盖、重命名或重新构建历史文件。SMTP 发布不替代 Core 的 latest 标记。

`BUILD.json` 记录包种类、版本、精确源码提交、提交时间、目标、工具链、构建参数和关键输入哈希。`PROVENANCE.json` 绑定仓库、标签、源码、Actions run/attempt、受信发布控制文件及各资产的大小/哈希。`SHA256SUMS` 校验同 Release 的程序包、BUILD 和来源文件。校验和及未签名的来源记录证明一致性，不能替代下载来源认证、签名、完整 SBOM 或法律审查。

程序包不含真实配置、密钥、客户数据、数据库转储、测试日志或缓存。测试证据保持脱敏，不能为方便排障把完整环境变量或服务商回复附进 Release。

## 从精确提交复现

需要 Git、GNU tar、gzip、sha256sum、Python 3，以及 BUILD 中相同的 Go/Node.js/npm。Core 构建使用前端锁文件；SMTP 只构建独立 Go 程序。依赖由 `go.sum` / `package-lock.json` 固定，下载渠道与缓存仍须可信。以下命令在仓库根目录运行，SHA 与版本必须来自同一已审查提交，输出目录尚不存在且位于仓库之外：

```sh
vps-billing/deploy/scripts/package-release.sh \
  --commit COMMIT_SHA --kind core --version 0.4.0 --output /workspace/core-a
vps-billing/deploy/scripts/package-release.sh \
  --commit COMMIT_SHA --kind core --version 0.4.0 --output /workspace/core-b
diff -r /workspace/core-a /workspace/core-b

vps-billing/deploy/scripts/package-release.sh \
  --commit COMMIT_SHA --kind smtp --version 1.0.0 --output /workspace/smtp-a
vps-billing/deploy/scripts/package-release.sh \
  --commit COMMIT_SHA --kind smtp --version 1.0.0 --output /workspace/smtp-b
diff -r /workspace/smtp-a /workspace/smtp-b
```

脚本从 Git archive 建立快照，不打包未提交产品改动；执行的配方和辅助程序必须等于所选提交。Go 使用静态 Linux amd64 构建、`-trimpath` 和固定参数；归档排序、时间和 owner 固定，gzip 不写入随机时间。两次一致仅证明指定环境下的复现范围，不是跨工具链或跨平台的普遍保证。

版本必须与源码中 Core/SMTP 的版本声明一致。不能给旧程序随意改包名制造新版本。构建后检查程序 `--version`、ELF 目标、完整文件清单与许可证；新的插件 manifest 还要检查协议、核心兼容区间和程序 SHA-256。

## 发布门禁

1. Go race/vet、前端单元与组件/类型/格式/生产构建、独立 HTTP/config 及发布负向测试通过。真实 MySQL 测试不得跳过。
2. MySQL 迁移 1–6、重复/已知中断恢复、checksum、并发幂等、权限、币种与历史快照回归通过；API 运行身份不能 DDL 或 GRANT。
3. 真实原生 systemd/Nginx HTTPS、API 重启、同 schema 目录切换、备份/空库恢复与业务检查有脱敏结果；浏览器保留沙箱并覆盖桌面/手机交互。
4. 插件专项验证：未知文件不会执行，审批/哈希/路径/UID/协议拒绝边界正确；真实独立 SMTP 安装、版本切换、回退和崩溃恢复期间，既有 Core 程序哈希与存活进程不变，核心业务继续响应。测试只用回环合成 SMTP/TLS。
5. Core、SMTP 各自双构建一致，完整包清单、权限、来源、版本和校验和通过。发布资产来自已验证提交，不能以工作区文件或历史候选冒充。
6. npm/Go 扫描及系统依赖检查分别报告范围。扫描网络或工具失败即为未完成；模块级告警不能被“可达函数 0”掩盖。

真正的公共 CA/域名/续期、数据库进程与整机重启、跨 schema 降级、独立实例/异地恢复、负载、真实服务商邮件和支付不在上述自动化结论内。单次 CI 通过也不替代这些项目。本文是放行要求；完成情况必须查实际运行记录。

## 发布流程与失败处理

受信默认分支控制程序验证标签、源码和成功构建 run，下载对应 artifact 作为数据核验，先创建暂存草稿、上传并复核全部资产，再变为正常公开 Release。只有最终 API 确认 `draft=false`、`prerelease=false`、标签/源码/附件一致后才能报告发布成功。具体信任边界见 [CI_RELEASE_AUTOMATION.md](CI_RELEASE_AUTOMATION.md)。

发布失败时保留实际状态、已上传资产清单与失败原因，检查是否已经执行后再处理。不要因标题可见就声称文件完整，也不覆盖已有同名 Release 或移动标签。缺少连接、权限或 API 支持时，交付完整本地程序包并明确记录发布阻塞，不制造长期凭据或绕过拒绝。

安装见 [INSTALL.md](INSTALL.md)，宝塔见 [BAOTA.md](BAOTA.md)，Core 升级见 [UPGRADE.md](UPGRADE.md)，插件单独替换见 [PLUGINS.md](PLUGINS.md)，恢复见 [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)。正式版本仍存在业务边界：支付结算/对账/退款、VPS 控制器、财务账本、邮箱验证/找回、MFA、完整分页、监控值守及灾备能力尚需完成。
