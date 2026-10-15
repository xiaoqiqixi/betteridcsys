# betteridcsys · 星屿云 Aster Cloud

Go、Vue 3 / TypeScript 与 MySQL 的财务核心，提供客户与管理控制台、套餐独立报价、待付款订单/账单、站点设置和审计。全新安装仅启用人民币 CNY；运营者可配置币种名称、前后缀、0–6 位小数、默认项与独立价格。语言和币种分别选择，没有汇率、自动换汇或历史金额转换。升级保留原有 USD 价格与历史记录。

**当前没有真实支付、VPS 主控/被控或自动开通。** 官方 SMTP 是另行安装的运行时插件，仅支持管理员配置和固定测试邮件；尚无业务通知、邮箱验证、密码找回或 MFA。创建订单不会产生 VPS，也不会伪造付款成功。正式 Release 表示交付版本，不等于已满足商业运营条件。

## 安装与目录

Core `0.5.2` 按 Linux amd64 原始可执行文件与资源包分开发行。从 [GitHub Releases](https://github.com/xiaoqiqixi/betteridcsys/releases) 获取同版本 API、插件宿主、资源包及 `SHA256SUMS`、`BUILD.json`、`PROVENANCE.json`，核对来源后使用主机准备器组装完整版本目录，再由获准管理员启动原生安装/升级执行器。管理员先审查私密实例规格和只读计划，再以计划 SHA-256 明确确认；执行器负责受支持实例的数据库账号、配置、迁移、首位管理员、服务、版本切换与 HTTPS 检查。单个可执行文件不是完整安装，服务器无需 Go/Node.js。Ubuntu 24.04 / amd64、Python 3、systemd、Nginx、本机 MySQL 8.4 LTS 及域名/TLS 须先准备；宝塔复用现有服务并单独审查本站配置。

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

API 只监听回环地址，网页与接口由 Nginx 在同一 HTTPS 来源提供。迁移身份与仅持有本库 DML 的 API 身份分离。秘密、备份和完整程序目录不能放入网页根目录。全新安装拒绝已有数据库、账号、配置或实例；升级在维护窗口内留存备份与持久操作记录，恢复前核对实际检查点，不自动导入备份或降级数据库。

## 独立插件与版本

Core `0.5.2` 与 SMTP `1.1.0` 分开构建、安装和发布。SMTP 仍使用 `aster.smtp/1`，兼容 Core `>=0.4.0,<0.6.0`；旧 SMTP `1.0.0` 的兼容上界是 `<0.5.0`，不能直接沿用到新 Core。Core 只读取 manifest，不因发现文件自动执行；主机管理员校验独立包并批准具体版本后，独立 systemd 身份通过 Unix socket 提供能力。替换插件无需重编 Core，旧插件保留用于回退。

插件不是任意恶意代码沙箱：需审查来源，SMTP 插件能接触本次发信凭据与内容。插件没有数据库接口、会话秘密或主机服务管理权限。安装、启停、目的地授权与故障处理见 [插件指南](vps-billing/docs/PLUGINS.md)，协议见 [PLUGIN_PROTOCOL.md](vps-billing/docs/PLUGIN_PROTOCOL.md)。

## 后台版本更新

管理员可查看固定官方仓库的正常 Release、版本、说明与兼容条件，并明确创建带审计的运维交接。网页保持非 root，不执行程序或控制服务；获准主机管理员独立核验资产，确认精确计划后执行安装/升级。网页可读取单独导出的脱敏实际状态回执，不读取私密 journal，也不把交接或暂存成功显示为已应用。旧版工具不认识后续新增的完整策略清单，首次使用 0.5.2 须核验并引导新资源中的工具。详见 [更新流程](vps-billing/docs/UPDATES.md)。

## 开发与维护

源码位于 [`vps-billing/`](vps-billing/README.md)，在 `main` 维护。工程文档包含 [接口契约](vps-billing/docs/CONTRACT.md)、[财务配置与历史约束](vps-billing/docs/FINANCIAL_MODEL.md)、[站点设置](vps-billing/docs/SITE_SETTINGS.md)、[运维](vps-billing/docs/OPERATIONS.md)及[构建发布](vps-billing/docs/RELEASE.md)。程序 Release 不手动附加源码归档；Git 中保留源码，GitHub 自动生成的源码下载由平台提供，历史附件保持原样。

Core 0.5.2 在主机准备、只读预检与备份元数据基础上提供管理员确认的原生安装/升级执行器及只读状态回执；未付订单可在付款禁用及严格状态检查下取消，并同步作废原账单，历史金额和快照保留。实施依据与未纳入功能见 [官方参考与范围](vps-billing/docs/REFERENCE_SCOPE.md)。

已使用的币种代码与精度锁定；未完成付款或服务义务会阻止停用。订单、账单与服务保留金额和币种格式快照，新订单另存套餐快照。迁移 007 升级到 14 张基础表，不支持破坏性降级；升级前必须验证备份和隔离恢复。

验收使用云端隔离环境与合成数据，具体结论绑定提交和运行记录；没有部署用户服务器或发送外部真实邮件。容量、公共证书续期、整机恢复、异地灾备、支付结算与控制器仍需分别完成。项目许可证见 [LICENSE](LICENSE)，依赖许可证随各程序包交付。
