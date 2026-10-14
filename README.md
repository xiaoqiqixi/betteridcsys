# betteridcsys · 星屿云 Aster Cloud

Go、Vue 3 / TypeScript 与 MySQL 的 VPS 计费项目，提供客户与管理控制台、套餐选购、待付款订单/账单、站点设置、审计，以及独立的中文/English、CNY/USD 选择。两种币种分别定价，没有自动汇率换算。

**当前没有真实支付、VPS 主控/被控或自动开通。** 官方 SMTP 是另行安装的运行时插件，仅支持管理员配置和固定测试邮件；尚无业务通知、邮箱验证、密码找回或 MFA。创建订单不会产生 VPS，也不会伪造付款成功。正式 Release 表示交付版本，不等于已满足商业运营条件。

## 安装与目录

从 [GitHub Releases](https://github.com/xiaoqiqixi/betteridcsys/releases) 获取 Core 的 Linux amd64 包及同一 Release 的 `SHA256SUMS`、`BUILD.json`、`PROVENANCE.json`，核对来源和校验和后安装。运行包已含 API、编译网页、插件宿主、配置样例、文档及许可证，无需在服务器编译。目标基线为 Ubuntu 24.04、systemd、Nginx HTTPS 与本机 MySQL 8.4 LTS；宝塔环境复用已有服务。

- [原生安装](vps-billing/docs/INSTALL.md) · [宝塔部署](vps-billing/docs/BAOTA.md)
- [升级与回退](vps-billing/docs/UPGRADE.md) · [备份恢复](vps-billing/docs/BACKUP_RECOVERY.md)
- [安全边界](vps-billing/docs/SECURITY.md) · [验证记录](vps-billing/docs/VALIDATION.md)

```text
/opt/aster/releases/<core-version>/  # root 管理的程序与网页
/opt/aster/current                  # 当前 Core 版本链接
/opt/aster/plugins/<id>/<version>/  # 独立插件版本，不使用链接选择
/etc/aster/api.env                  # 非秘密配置与受限文件引用
/etc/aster/plugins.json             # root 明确批准的插件、身份与目的地
/etc/aster/secrets/                 # 数据库、会话及 SMTP 加密秘密
```

API 只监听回环地址，网页与接口由 Nginx 在同一 HTTPS 来源提供。数据库迁移独立执行，API 仅持有本库 DML 权限。秘密、备份和完整程序目录不能放入网页根目录。

## 独立插件与版本

Core `0.4.0` 与 SMTP `1.0.0` 分开构建、安装和发布，SMTP 使用 `aster.smtp/1`，兼容 Core `>=0.4.0,<0.5.0`。Core 只读取 manifest，不因发现文件自动执行；主机管理员校验独立包并批准具体版本后，独立 systemd 身份通过 Unix socket 提供能力。替换插件无需重编 Core，旧插件保留用于回退。

插件不是任意恶意代码沙箱：需审查来源，SMTP 插件能接触本次发信凭据与内容。插件没有数据库接口、会话秘密或主机服务管理权限。安装、启停、目的地授权与故障处理见 [插件指南](vps-billing/docs/PLUGINS.md)，协议见 [PLUGIN_PROTOCOL.md](vps-billing/docs/PLUGIN_PROTOCOL.md)。

## 开发与维护

源码位于 [`vps-billing/`](vps-billing/README.md)，在 `main` 维护。工程文档包含 [接口契约](vps-billing/docs/CONTRACT.md)、[站点与计价](vps-billing/docs/SITE_SETTINGS.md)、[运维](vps-billing/docs/OPERATIONS.md)及[构建发布](vps-billing/docs/RELEASE.md)。程序 Release 不手动附加源码归档；Git 中保留源码，GitHub 自动生成的源码下载由平台提供，历史附件保持原样。

验收使用云端隔离环境与合成数据，具体结论绑定提交和运行记录；没有部署用户服务器或发送外部真实邮件。容量、公共证书续期、整机恢复、异地灾备、支付结算与控制器仍需分别完成。项目许可证见 [LICENSE](LICENSE)，依赖许可证随各程序包交付。
