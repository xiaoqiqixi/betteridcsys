# 验证记录

验证日期：2026-10-14 UTC。结果绑定实际执行时的提交与 GitHub run；后续源码或界面修改不沿用旧提交的通过结论。

已纠正的历史测试缺陷：旧 `test-backup-native.sh` 在 `if rg ...` 中把缺失工具的退出码 127 当成“无匹配”，因此此前该夹具输出的泄露扫描 PASS 不能作为扫描已执行的证据。此问题不替代或否定独立原生恢复中记录的表数据哈希，但相关泄露扫描必须在修复后重新执行并以新 run 为准。

## 选购流程与完整云端验收

已验证源码：`97a2f72b36f4aa4a0954a1406f36a65c64c21dc4`。[Run 38575990819](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38575990819) 的[应用与浏览器检查](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38575990819/job/115893100080)和[独立 Go 扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38575990819/job/115893100530)均成功。

| 验证项 | 实际结果 |
|---|---|
| Go 与数据库 | race 64 个顶层 + 75 个子测试，0 失败、0 跳过；真实 MySQL、vet 与 Linux amd64 编译通过 |
| 前端 | 97 项测试、类型、生产构建和格式检查通过；新增应用级延迟币种响应回归，修复前可复现组件卸载和选择丢失 |
| 独立回归 | Python CI 158 项、许可证清单 4、启动配置 9、演示 HTTP 13 项通过 |
| 备份测试扫描 | 无 ripgrep 时执行真实 grep 扫描；缺失 grep、错误退出码 2/127、实际注入标记均被对应回归正确拒绝；本次日志没有缺失命令错误 |
| 原生服务与恢复 | systemd、验证证书的 Nginx HTTPS、DML/迁移权限分离、API 重启与同 schema A→B→A 通过；原库和恢复库分别通过 21 项 HTTPS 测试，4 个已有订单保留 |
| 数据与 SMTP | 13 张表完整数据哈希一致；关闭状态的加密 SMTP 设置恢复后可解密且配置有效，未发送外部邮件 |
| 浏览器 | Google Chrome 155.0.8059.39；沙箱开启；1440×1100 桌面与 390×844 手机交互、地区筛选、币种切换保留选择、摘要金额/布局、下单与历史快照、管理员设置、SMTP 默认关闭检查通过 |
| 浏览器证据 | 12 个合成截图及各自 SHA-256 记录在该 run 的 `browser-acceptance-38575990819-1` artifact；未逐张人工视觉审阅 |
| 清理与扫描 | 原生和浏览器自有资源清理成功；npm 审计 0；Go 可达函数/导入包 0，模块级告警 19，范围见下文 |

Chrome 执行前校验了已安装包的 255 个文件，并收紧可写权限；这是同一 runner 内受保护的安装记录一致性检查，不是新增包来源认证。版本命令的标准输出与私有警告分离，未关闭沙箱或改变系统沙箱策略。浏览器连接独立回环内存 demo，不将其计入真实 MySQL 的 HTTPS 测试；该 run 没有向外部服务商发送邮件或发起真实付款。

## SMTP 首轮原生验收

已验证源码：`86288e3627bdc8f4cb937c1c235633e8c0db4af4`。[Run 38563825244](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38563825244) 的[应用检查](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38563825244/job/115851338909)和[独立 Go 漏洞扫描](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38563825244/job/115851339569)均成功。这是 SMTP 首轮验收的历史证据；新的选购界面与浏览器结果见上方记录。

| 验证项 | 实际结果 |
|---|---|
| 环境与数据库 | Ubuntu 24.04 / amd64；四个官方 MySQL 8.4.11 DEB 按固定大小、SHA-256 校验后提取，原生初始化与 Unix socket 连接通过 |
| Go | Go 1.27.2；race 64 个顶层 + 75 个子测试通过，0 失败、0 跳过，包含真实 MySQL 回归；vet 与 Linux amd64 编译通过 |
| 前端 | Node.js 24.19.0；84 项测试、类型检查、格式检查和生产构建通过 |
| 独立回归 | Python CI 112 项；许可证清单 4、启动配置 9、演示 HTTP 13 项通过 |
| 原生服务与业务 | systemd API、Nginx HTTPS、私有测试 CA 和权限检查通过；21 项 HTTPS 测试通过 |
| 重启与切换 | API 重启及同二进制/schema 的 A→B→A 目录切换通过，4 个已有订单保留 |
| SMTP 配置与恢复 | 保存关闭状态的加密凭据；恢复后管理清单 `configured=true`，证明匹配密钥下凭据可解密且配置有效，保持关闭且未发送外部邮件 |
| 备份与数据一致性 | 实际备份、checksum/gzip 校验、同一 MySQL 实例中新空库恢复通过；包括 SMTP 设置的 13 张表完整数据哈希一致 |
| 恢复后业务 | API 切换到恢复库，再通过 21 项 HTTPS 测试 |
| 清理 | 测试与清理退出码均为 0；自有测试资源已移除 |
| 审计与工作流 | npm 审计 0 项已知漏洞；工作流检查通过；独立 Go 扫描范围如下 |

Go 扫描报告 **0 项可达函数、0 项导入包、19 项模块级告警**；余下告警来自应用未导入的 `x/crypto` SSH/OpenPGP 包，不能概括为“依赖无已知漏洞”。结果仅覆盖对应源码、构建配置和当次漏洞库快照，详细工具版本与输出见扫描 job。

SMTP 回归使用回环 SMTP/TLS 夹具，覆盖管理员 HTTP、加密保存、本机可信测试 CA 下的传输与接受，以及失败边界；没有向外部服务商或真实收件人发送邮件。SMTP 的 `accepted` 仅表示服务器接受，不能证明收件箱投递、SPF/DKIM/DMARC 或实际服务商配置有效。

## 验证范围

原生验收使用一次性 GitHub-hosted runner 和合成数据，没有连接外部业务主机、真实支付或 VPS 服务。HTTPS 使用 localhost 与临时私有 CA，没有测试真实域名、公共 CA 签发或续期。API 重启和 A→B→A 使用相同二进制及 schema，不证明不同应用版本间的迁移回滚。

备份恢复目标是同一实例的另一新空库；没有重启 MySQL 进程或整机，也没有验证独立实例、异地加密副本、断电恢复、PITR、容量或生产 RPO/RTO。当前浏览器结论是自动化交互和布局断言，不代表所有设备、完整无障碍或人工视觉验收。宝塔适配操作见 [BAOTA.md](BAOTA.md)，尚无实际面板运行结论。

具体发布与双构建结果以对应 Release 中的 `PROVENANCE.json` 和构建运行链接为准；只读 CI 不创建 Release，也不部署主机。新源码按 [发布要求](RELEASE.md) 重新生成并核对归档，历史候选的原文件和哈希保持不变。

## 应用与原生验收基线

以下为 SMTP 实现之前的历史基线，源码 `00654f431b070c44b8442fff71a18cdd65b29999`：[Push run 38557196471](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557196471)与[PR run 38557186363](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557186363)均通过应用检查和 Go 扫描。[Push 检查日志](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557196471/job/115829150826)保存原生验收摘要及脱敏 JSON；PR 使用合并测试引用，不与分支 checkout 混为同一源码。

该基线通过 Go race 38 个顶层和 50 个子测试（0 失败、0 跳过）、前端 62 项、Python CI 93 项、许可证清单 4 项、配置 8 项、演示 HTTP 13 项。原生与恢复库各通过 20 项 HTTPS 测试，12 张表完整数据哈希一致；API 重启及同 schema A→B→A 保留 4 个订单，最小权限负向检查通过，自有测试资源清理退出码为 0。这些数量不计入新的 SMTP 验收，也不证明 SMTP 行为。

此后历史候选归档处理新增 19 项离线回归，与原发布守卫 59 项一同通过；旧结果不替代新源码的完整 CI 或实际 Release 上传证据。

## 浏览器与历史候选

历史候选 `0.3.0-rc.1` 的云端 Chromium E2E 通过，浏览器沙箱保持开启。测试经回环 demo API 覆盖中文/English、CNY/USD 独立偏好、下单及历史快照、禁用支付、手机导航与管理员设置保存；检查了 1440×1100 和 390×844 截图，未出现页面错误或手机横向溢出。这不代表所有设备、完整无障碍、当前界面、宝塔环境或真实业务主机已验收。证据为 `/workspace/aster-validation-20261014/browser-final.log` 与同目录 `browser/`。

旧版本的构建、失败排查和阶段交付详情保存在 Git 历史与对应 Actions 记录中，不作为当前安装步骤。历史候选不覆盖、不改名；新源码重新构建并记录来源及哈希。
