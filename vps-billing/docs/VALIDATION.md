# 验证记录

验证日期：2026-10-14 UTC。以下结果绑定实际执行时的提交与 GitHub run，不将历史测试转记为其他提交的通过结果。

## 应用与原生验收基线

已验证源码：`00654f431b070c44b8442fff71a18cdd65b29999`。

- [Push run 38557196471](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557196471)：应用检查与独立 Go 漏洞扫描均成功。
- [PR run 38557186363](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557186363)：应用检查与独立 Go 漏洞扫描均成功。
原生验收摘要及脱敏 JSON 见 [push checks job 115829150826](https://github.com/xiaoqiqixi/betteridcsys/actions/runs/38557196471/job/115829150826)。PR 运行使用 GitHub 的合并测试引用，不能与分支提交混为同一个 checkout。

| 验证项 | 实际结果 |
|---|---|
| 环境与数据库来源 | Ubuntu 24.04 / amd64；四个官方 MySQL 8.4.11 DEB 按固定大小、SHA-256 校验后提取，真实数据库初始化、socket 就绪与回归通过 |
| Go | Go 1.27.2；race 38 个顶层 + 50 个子测试，0 失败、0 跳过；vet 与 Linux amd64 编译通过 |
| 前端 | Node.js 24.19.0；62 项测试、类型检查、格式检查和生产构建通过 |
| 独立回归 | Python CI 93 项（发布守卫 59、数据库夹具 22、检查编排 4、验收守卫 8）；许可证清单 4、配置 8、演示 HTTP 13 项通过 |
| 原生服务 | 加固 systemd API、Nginx HTTPS、只读版本目录及私有测试 CA 的完整证书校验通过 |
| 业务与代理 | 20 项 HTTPS 测试通过，包含生产 Cookie、CSRF、客户隔离、Host/来源、HTTP 跳转、伪造代理头与两个来源的限速隔离 |
| 数据库与文件权限 | API 仅本库 DML；迁移使用 SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER/INDEX/REFERENCES；运行身份 DDL、授权、跨库访问及修改版本/秘密的负向测试通过 |
| 重启与切换 | API 重启、同二进制/schema 的 A→B→A 发布目录切换通过，4 个既有订单保留 |
| 原生备份与恢复 | 实际备份、checksum/gzip 校验、同一 MySQL 实例中新空库恢复成功；12 张表的完整数据哈希一致 |
| 恢复后业务 | API 切换至恢复库，另外 20 项 HTTPS 测试通过 |
| 清理 | 清理退出码 0，自有测试服务、账号、数据库和路径均已移除 |
| 审计与工作流 | npm 审计 0 项已知漏洞；actionlint 1.7.7 通过；独立 Go 扫描成功，范围如下 |

Go 扫描使用 `govulncheck v1.9.0`；报告 **0 项可达函数、0 项导入包、19 项模块级告警**。余下告警来自当前应用未导入的 `x/crypto` SSH/OpenPGP 包，不能概括为“依赖无已知漏洞”。最近核对的漏洞库更新时间为 2026-10-08 22:31:09 UTC；结果仅覆盖对应源码、构建配置和数据库快照。

## 验证范围

本次使用一次性 GitHub-hosted runner 和合成数据，没有连接外部业务服务器或调用真实支付、邮件、VPS 服务。HTTPS 使用 localhost 与临时私有 CA，没有测试真实域名、公共 CA 签发或续期。A→B→A 使用相同二进制和 schema，不证明不同应用版本间的迁移回滚。

备份恢复目标是同一实例的另一新空库；没有重启 MySQL 进程或整机，也没有验证独立实例、异地加密副本、断电恢复、PITR、容量或生产 RPO/RTO。浏览器视觉验收见下节历史范围，不混计到上述原生 HTTP 测试。宝塔适配操作见 [BAOTA.md](BAOTA.md)，尚无实际面板运行结论。

具体发布与双构建结果以对应 Release 中的 `PROVENANCE.json` 和构建运行链接为准；只读 CI 不创建 Release，也不部署主机。新源码按 [发布要求](RELEASE.md) 重新生成并核对归档，历史候选的原文件和哈希保持不变。

## 历史归档回归

历史候选归档处理新增 19 项离线回归，与原发布守卫 59 项一同通过。该本地验证不计入 `00654f4` 的 93 项 CI，也不替代新源码的完整 CI 或实际 Release 上传结果。

## 浏览器与历史候选

历史候选 `0.3.0-rc.1` 的云端 Chromium E2E 通过，浏览器沙箱保持开启。测试经回环 demo API 覆盖中文/English、CNY/USD 独立偏好、下单及历史快照、禁用支付、手机导航与管理员设置保存；检查了 1440×1100 和 390×844 截图，未出现页面错误或手机横向溢出。这不代表所有设备、完整无障碍、当前宝塔环境或真实业务主机已验收。证据为 `/workspace/aster-validation-20261014/browser-final.log` 与同目录 `browser/`。

旧版本的构建、失败排查和阶段交付详情保存在 Git 历史与对应 Actions 记录中，不作为当前安装步骤。历史候选不覆盖、不改名；新源码重新构建并记录来源及哈希。
