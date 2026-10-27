# 星屿云 Aster Cloud

面向云服务运营的财务系统、独立主控与 KVM 计算节点。财务管理销售和账务，主控管理资源任务，被控在计算宿主机上管理虚拟机。

**[文档中心](docs/README.md) · [财务安装](vps-billing/docs/INSTALL.md) · [首次使用](vps-billing/docs/GETTING_STARTED.md) · [主控与被控](aster-cloud/README.md) · [更新记录](vps-billing/docs/CHANGELOG.md)**

## 项目组成

| 系统 | 用途 | 版本与交付范围 |
| --- | --- | --- |
| [财务 Core](vps-billing/README.md) | 商品、客户、订单、账单、运营设置与审计 | Core `0.5.10`：[正式 Release](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/v0.5.10)，[公开资产验收](docs/CORE_PUBLIC_PREPARE_ACCEPTANCE.md) |
| [云主控与 KVM 被控](aster-cloud/README.md) | 实例、节点、资源任务、网络与公网 IP | [0.1.0-rc.1 预发布](https://github.com/xiaoqiqixi/betteridcsys/releases/tag/cloud-v0.1.0-rc.1)，[公开下载验收](docs/CLOUD_PUBLIC_ACCEPTANCE.md)；不是稳定版，真实 KVM、物理网络和生产部署尚未验收 |

Go + Vue 3 / TypeScript + MySQL，原生 Linux 部署，不使用 Docker。当前部署目标为 **Ubuntu 22.04 / 24.04 amd64**，暂不支持 Ubuntu 26.04 或其他发行版。全新财务站点默认中文、人民币 CNY；语言与币种独立设置，不自动换汇，不改写历史金额。

## 可以做什么

### 财务与客户门户

- **商品管理**：按“类型 → 地区 → 节点 → 套餐”组织目录；后台新增、复制、编辑规格、独立定价与上下架。目录节点是销售分类，不是实际计算节点。
- **购买与订单**：默认展示首个套餐报价，客户核对配置后创建待付款订单；查询订单详情、账单与已有服务，安全取消符合条件的未付订单。
- **客户与管理**：客户/管理员账户、停用、改密和撤销会话；管理员查看全站业务，维护站点品牌、运营币种与审计记录。
- **独立扩展**：SMTP 测试邮件、支付运行时插槽与主控资源协议；插件分别审核、安装和授权，不随文件出现自动执行。

支付默认关闭，不内置真实收款渠道；没有退款、对账、完整会计账本、业务邮件通知或自动开通 worker。**创建订单不等于付款，付款成功不等于虚拟机已开通。** 详见[财务使用指南](vps-billing/docs/GETTING_STARTED.md)与[能力边界](vps-billing/docs/ADMIN_MANAGEMENT.md)。

### 云主控与计算节点

独立管理台已接入实例动作、节点维护、任务与审计、成员权限、受限快照/备份与冷迁移，以及 VPC、路由、OVS、NAT、公网地址池、直绑和浮动 IPv4 管理。不同网络合同的支持范围不同；热迁移、HA、完整安全组、IPv6、受控 VNC 等尚未完成，不能据此承诺真实客户资源可用。查看[功能矩阵](aster-cloud/docs/ARCHITECTURE.md)及[主控入门](aster-cloud/docs/GETTING_STARTED.md)。

## 开始使用

| 你要做的事 | 从这里开始 |
| --- | --- |
| 安装新的财务站点 | [原生安装](vps-billing/docs/INSTALL.md)：准备域名、TLS、本机 MySQL，核验完整发行包后审查计划并安装；运行服务器不需要 Go / Node.js |
| 使用宝塔已有环境 | [宝塔部署](vps-billing/docs/BAOTA.md)：复用既有服务，不覆盖其他网站 |
| 登录后台并上架商品 | [首次使用](vps-billing/docs/GETTING_STARTED.md)：管理员登录、站点配置、CNY 报价、商品发布与客户购买 |
| 准备主控或 KVM 被控 | [主控与被控安装入口](aster-cloud/README.md)：每个角色一条交互命令，以经过核验的独立 Cloud Release 正文为准；计算节点必须是专用宿主机 |
| 更新、备份或处理故障 | [版本更新](vps-billing/docs/UPDATES.md) · [升级与回退](vps-billing/docs/UPGRADE.md) · [备份恢复](vps-billing/docs/BACKUP_RECOVERY.md) · [日常运维](vps-billing/docs/OPERATIONS.md) |

没有通用默认管理员密码。财务首位管理员使用安装时指定的邮箱和私密密码文件；主控在独立安装向导中设置，两个系统不共享账户或数据库。

**旧版升级提醒**：历史归属调整后，Core v0.5.6–v0.5.9 的新 `prepare` / `stage` 存在来源限制；已有实例不要删除或重装绕过，先读[历史影响与升级条件](docs/HISTORY_REWRITE.md)。旧标签和资产保持不变。

## 开发与维护

- **财务开发**：[源码与本地运行](vps-billing/README.md) · [API 契约](vps-billing/docs/CONTRACT.md) · [财务模型](vps-billing/docs/FINANCIAL_MODEL.md) · [界面规范](vps-billing/docs/UI_GUIDELINES.md)
- **插件开发**：[支付接入](vps-billing/docs/PAYMENT_PLUGINS.md) · [运行时协议](vps-billing/docs/PLUGIN_PROTOCOL.md) · [资源插件](vps-billing/docs/RESOURCE_PLUGINS.md) · [产品配置](vps-billing/docs/PRODUCT_CONFIGURATION.md)
- **主控开发**：[源码与检查入口](aster-cloud/README.md) · [管理台 API](aster-cloud/docs/CONSOLE_API.md) · [网络 API](aster-cloud/docs/NETWORK_API.md) · [术语](aster-cloud/GLOSSARY.md)
- **验收与计划**：[财务验证](vps-billing/docs/VALIDATION.md) · [主控验证](aster-cloud/docs/VALIDATION.md) · [实施计划](docs/EXECUTION_PLAN.md) · [逐项台账](docs/execution-tracker.json)

代码只在 `main` 维护；源码进度、正式发行和目标主机验收分别记录。文档中的功能目标不等于已经交付，测试结论对应具体提交；包内文档是构建时快照，实时版本状态以固定 Release 与对应验证记录为准。

项目采用 [Apache License 2.0](LICENSE)，依赖许可证随发行包交付。
