# betteridcsys · 星屿云 Aster Cloud

星屿云是一套 Go、Vue 3 / TypeScript 与 MySQL 构建的云业务财务控制台，提供客户和管理员入口、独立币种报价、订单、账单、站点设置与审计。全新安装默认使用人民币 CNY；运营者可以配置币种名称、金额前后缀、0–6 位小数及独立价格。语言与币种分别选择，不自动换汇，也不改写历史金额。升级会保留已有 USD 报价和业务记录。

支付渠道由运营者与开发者按[支付插件接入指南](vps-billing/docs/PAYMENT_PLUGINS.md)接入第三方服务，完成适配、构建和验收。官方发行默认关闭支付；创建订单会生成待付款账单，创建订单或打开结账页面本身不会将账单记为已付。VPS 主控/被控和自动开通仍需另行实现。

官方 SMTP 是独立安装的运行时插件，目前用于管理员配置和固定测试邮件。业务通知、邮箱验证、密码找回和 MFA 尚未提供。正式 Release 表示版本已交付，实际运营仍需完成目标环境和业务验收。

本版目标为 Core `0.5.9`，以正式 `0.5.8` 为对照；当前处于发布准备，最终 CI、Runtime build、发布器和公共附件核验尚待实际运行。新增独立产品配置、订单私密配置快照与已付款订单的手动任务，013 将数据库提升到 schema 13 / 23 表。采用自有 `aster.controller/1` 和稳定公开 Go 合同，不是 IDCsmart API 对接；默认没有 worker，不附带完整主控或真实 VM 开通。独立主控/KVM 另行开发，不混入本财务发行。金额、币种、支付幂等、原财务快照与旧合法订单重放不改；既有 v0.5.8 标签和资产不覆盖。准确状态见[验证记录](vps-billing/docs/VALIDATION.md)。

已发布的 0.5.4 维护内容包括登录错误提示随界面语言更新、客户概览只读取最近五条订单，以及减少订单列表中重复的币种快照解析。历史金额、币种和套餐快照保持原记录。

## 安装与目录

Core `0.5.9` 的交付格式为 Linux amd64 的 API、插件宿主和资源包。本轮开发对照基线为正式 `0.5.8`；本页链接的安装、升级示例已按 `0.5.9` 准备，须待该版本正式发布并核验后使用。从 [GitHub Releases](https://github.com/xiaoqiqixi/betteridcsys/releases)取得同一版本的六项资产，核对 `SHA256SUMS`、`BUILD.json` 和 `PROVENANCE.json`，再用主机准备器组装完整版本目录。服务器运行应用无需 Go 或 Node.js，单个可执行文件还不足以完成安装。

部署基线为 Ubuntu 24.04 / amd64、Python 3、systemd、Nginx、本机 MySQL 8.4 LTS，以及已准备的域名和 TLS 证书。管理员审查私密实例规格和只读计划后，以实际计划 SHA-256 确认操作。执行器负责受支持实例的数据库账号、配置、数据库更新、首位管理员、服务、版本切换与 HTTPS 检查。宝塔环境复用已有服务，单独审查本站配置。

- [原生安装](vps-billing/docs/INSTALL.md) · [宝塔部署](vps-billing/docs/BAOTA.md)
- [后台版本更新](vps-billing/docs/UPDATES.md) · [升级与回退](vps-billing/docs/UPGRADE.md) · [备份恢复](vps-billing/docs/BACKUP_RECOVERY.md)
- [安全边界](vps-billing/docs/SECURITY.md) · [验证记录](vps-billing/docs/VALIDATION.md)

```text
/opt/aster/releases/<core-version>/  # root 管理的程序与网页
/opt/aster/current                  # 当前 Core 版本链接
/opt/aster/plugins/<id>/<version>/  # 独立插件版本，不使用链接选择
/etc/aster/api.env                  # 非秘密配置与受限文件引用
/etc/aster/plugins.json             # root 明确批准的插件、身份与目的地
/etc/aster/secrets/                 # 数据库、会话及 SMTP 加密秘密
```

API 只监听回环地址，网页和接口由 Nginx 在同一 HTTPS 来源提供。API 数据库账号仅持有本库 DML 权限，数据库更新使用独立身份。秘密、备份和完整程序目录应放在网页根目录之外。

全新安装要求数据库、账号、配置和实例均未存在。已有实例按升级流程处理：安排维护窗口，保留旧版本和匹配备份，验证隔离恢复，再审查并执行升级。结果不明时先核对实际检查点，不自动导入备份或降级数据库。

## 独立插件与版本

目标 Core `0.5.9` 与 SMTP `1.1.0` 分开构建、安装和发布；本次不准备新的 SMTP 版本。SMTP 使用 `aster.smtp/1`，兼容 Core `>=0.4.0,<0.6.0`；旧 SMTP `1.0.0` 的兼容上界是 `<0.5.0`，升级 Core 前须更新到兼容版本或明确停用。

支付运行时插槽 `aster.payment/1` 自 Core 0.5.3 起提供，与 SMTP 一样通过独立进程接入，安装兼容插件无需重新编译 Core。Core 被动读取 manifest，主机管理员核验并批准具体身份和哈希后才可调用。支付尝试、回调去重和账务状态由 Core 持久化管理；具体第三方渠道仍由开发者编写。默认不附带真实支付渠道。

SMTP 插件会接触本次发信凭据和内容，需审查来源及出口策略；它没有数据库接口、会话秘密或主机服务管理权限。进程隔离不等于任意恶意代码沙箱。安装、启停、目的地授权及故障处理见[插件指南](vps-billing/docs/PLUGINS.md)，通信约定见 [PLUGIN_PROTOCOL.md](vps-billing/docs/PLUGIN_PROTOCOL.md)。

## 后台版本更新

管理员可在后台查看固定官方仓库的正常 Release、版本说明和兼容条件，并创建带审计的运维交接。获准主机管理员独立核验资产、确认精确计划后执行安装或升级；网页不执行程序或控制主机服务。

网页可以读取单独导出的脱敏执行回执，显示实际进度和结果，不读取私密 journal。创建交接、准备目录和最终应用是不同阶段。首次使用 `0.5.4` 时要求核验并引导新资源中的工具；这一边界继续适用于 `0.5.9`，须核验本次目标版本的工具，旧工具不会自动认识后续的完整策略清单。详见[更新流程](vps-billing/docs/UPDATES.md)。

## 开发与维护

本页对应 Core `0.5.9` 源码；交付和门禁结果不由源码版本号推定，正式资产以 [Release 清单](https://github.com/xiaoqiqixi/betteridcsys/releases)为准，旧安装包不会随源码自动更新。源码和开发说明位于 [`vps-billing/`](vps-billing/README.md)，在 `main` 维护。可从[接口契约](vps-billing/docs/CONTRACT.md)、[财务模型](vps-billing/docs/FINANCIAL_MODEL.md)、[站点设置](vps-billing/docs/SITE_SETTINGS.md)、[日常运维](vps-billing/docs/OPERATIONS.md)及[v0.5.9 发布说明](vps-billing/docs/RELEASE-v0.5.9.md)继续阅读。Git 保留源码，GitHub 提供自动生成的源码下载；程序 Release 不额外手动附加源码归档。Git 标签与源码历史保留，正式资产不原地覆盖；旧 Release 清理按明确授权单独执行。

已使用的币种代码和精度保持锁定，未完成付款或服务义务会阻止停用。订单、账单与服务保留各自的金额和币种格式，新订单另存套餐快照。符合条件且没有在途支付尝试的未付订单可取消，同步作废原账单并保留历史记录。升级前应验证备份和隔离恢复，程序回退须满足数据库兼容条件。

验证记录使用云端隔离环境和合成数据，结论对应具体提交和运行。目标环境仍需检查容量、公共证书续期、整机恢复、异地灾备，以及所接支付渠道和资源控制器。项目许可证见 [LICENSE](LICENSE)，依赖许可证随程序包交付。
