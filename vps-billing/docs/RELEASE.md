# 候选发布、复现与放行条件

本里程碑包含可配置站点品牌、简体中文/English、独立 CNY/USD 定价、实际地区筛选与实时订单摘要、默认关闭的官方 SMTP 管理配置与测试，以及安全和正确性修复。源码、文档、构建包和校验和交付到公开仓库 `xiaoqiqixi/betteridcsys`；秘密、实际服务器配置、客户数据和敏感日志必须排除。未部署外部主机或接通真实付款/邮件。功能与验证状态以 [验证记录](VALIDATION.md) 的提交与实际记录为准。

后续部署目标已调整为 **单服务器原生 Linux**，当前源码、部署工具和 CI 都只保留原生路径，高可用暂缓。现有 `0.3.0-rc.1` 保留为历史候选，不覆盖或重新命名；新候选须通过 Ubuntu 24.04 原生服务、权限、HTTPS、升级切换与备份恢复等工程验证；外部主机的开机恢复、真实域名和公共 CA 证书另行记录，不宣称已部署。

根 LICENSE、README 保留原文；项目 `vps-billing/README.md` 已更新为当前原生路径。**当前接口与能力以 [CONTRACT.md](CONTRACT.md)、[SITE_SETTINGS.md](SITE_SETTINGS.md) 和对应验证记录为准。** 旧提交中的 USD-only、迁移/数据库未验证等文字属于早期快照，不作为当前能力证明。

## 可审查的交付物

- 已审查的 `main` 提交、变更说明与实际测试证据；后续维护直接在 `main` 记录。
- `aster-VERSION-linux-amd64.tar.gz`：静态 API、编译网页、文档、依赖清单和许可证材料；修订后的运行包只带原生 systemd/Nginx 样例及 `backup-native.sh`。
- `aster-VERSION-source.tar.gz`：同一修订提交中的根 LICENSE/README 和项目源码，排除本地秘密、依赖目录、构建输出与旧测试日志；不重新加入已从当前源码删除的旧部署实现。
- `BUILD.json`：准确 Git 提交、提交时间作为 SOURCE_DATE_EPOCH、目标架构、构建参数、工具链及关键输入 SHA-256；修订包新增 `deployment_model`，明确单服务器原生模型和目标主机验证状态。
- `SHA256SUMS`：验证两个归档和 BUILD.json。
- 自动化额外生成 `PROVENANCE.json`，记录精确 run、提交和文件哈希；它不是签名证明。
- 仅 `v0.3.0-rc.3` 额外附带 `historical-v0.3.0-rc.1.zip` 与 `historical-v0.3.0-rc.2.zip`；保留旧候选原五文件及 `ARCHIVE.json`，不重建、不改原哈希，不作为当前安装包。

归档尚无签名或完整 SPDX/CycloneDX SBOM；依赖清单及收集的 license/notice 文件不等于法律合规结论。

归档不带部署秘密、真实数据、数据库备份或本机缓存。测试日志留在受限证据目录，不自动塞入发布包，避免暴露运行路径、账号与 DSN。

## 从同一提交复现

需 Git、GNU tar、gzip、sha256sum、Python 3、受支持 Go、Node.js 与 npm；使用 BUILD.json 中相同版本。依赖取自 go.sum 和 package-lock.json，构建时需要依赖下载或预先验证的本地缓存。包脚本不安装系统软件，也不创建远程资源。

```sh
# 在仓库根目录，使用已经提交、已经验证的 SHA。输出目录必须尚不存在且在仓库外。
PATH=/path/to/go/bin:$PATH \
  vps-billing/deploy/scripts/package-release.sh \
  --commit COMMIT_SHA --version VERSION --output /workspace/release-a
PATH=/path/to/go/bin:$PATH \
  vps-billing/deploy/scripts/package-release.sh \
  --commit COMMIT_SHA --version VERSION --output /workspace/release-b
diff -u /workspace/release-a/SHA256SUMS /workspace/release-b/SHA256SUMS
```

脚本从 Git archive 建立临时快照，不读取工作树中的未提交产品改动；同时要求运行的打包脚本与辅助脚本等于所选提交，防止未记录的配方混入。Go 使用 CGO_ENABLED=0、GOOS=linux、GOARCH=amd64、-trimpath、-buildvcs=false、-s -w；前端执行 npm ci 后构建。归档按文件名排序、固定提交时间/数字 owner 0、gzip -n，移除临时构建路径。

“两次相同”只证明指定工具链/锁文件/环境下的复现范围，不是跨平台完全可复现或供应链安全证明。改变工具链、锁文件或版本标签会产生新的 BUILD.json/哈希，必须重新记录。没有完成实测前不得填写“两次一致”。

## 候选版本必须完成的验证

1. Go race、vet、静态 Linux amd64 编译；前端单元/组件、类型、构建、格式检查；独立 HTTP 与配置负向回归。
2. 真实一次性 MySQL：迁移 1–6 与重复迁移、升级/已知中断恢复、完整 checksum、未知版本拒绝、16 并发幂等、冲突/回滚、CNY/USD 分组汇总与不可变身份；数据库拒绝小写/带重音币种近似值。
3. 管理员设置权限/CSRF/revision/审计，危险链接/文本拒绝，客户无法写，公开设置不泄露私有字段。两语言/两币种分别切换与错误回退。
4. 两个客户隔离、直接账单详情、迟到请求处理、错误/超时后的订单安全重试；禁用支付不改变已付状态。
5. Ubuntu 24.04 上的真实原生 MySQL、加固 systemd API、Nginx 与验证证书的 HTTPS、runtime 最小权限、API 重启、同 schema A → B → A 切换，以及原生备份/同实例新空库恢复后的业务验证。明确记录实际浏览器覆盖范围。数据库进程重启、整机开机恢复、跨应用/schema 版本回滚、独立实例灾备、公共 CA/真实 DNS/续期不在该自动化结论内；不能用模拟或相邻测试宣称通过。
6. Go/npm 依赖扫描、原生系统软件及来源检查；扫描端点受阻时记录“不确定/未扫描”，不写“0 漏洞”。每种扫描的覆盖范围分别记录。
7. 打包两次校验和相同、归档内容/权限检查、不含秘密、静态二进制实际启动、源码根 LICENSE/README 哈希不变。

当前 npm 审计或单元测试结果不能替代浏览器、TLS 边界、压力或恢复验收。最终验证应在最后代码变更后运行；只改文档需核对链接和打包内容，无需伪造应用回归时间。

## 发布与安装

只读 CI、标签候选构建与默认分支受信草稿发布流程，见 [CI 与草稿 Release 自动化](CI_RELEASE_AUTOMATION.md)。`86288e3` 的完整 CI 已通过，包括真实原生数据库、SMTP 设置加密与恢复、systemd/HTTPS、权限、API 重启、同 schema 切换及备份恢复；具体结果见 [原生验证记录](VALIDATION.md)。后续源码必须重新验证；源码集成、候选构建和 Release 创建分别记录，不互相替代。

先将 `main` 上的源码提交、生成的包和证据相互对应，再上传到明确标记的草稿 Release。没有可用 Release API 或授权凭据时，保留本地完整发布目录并报告出版阻塞；不要把上传失败说成发布成功，也不要为此创建长期凭据。

本地文件齐全、草稿 Release 创建和实际部署是三个独立动作。普通原生安装见 [INSTALL.md](INSTALL.md)，宝塔部署见 [BAOTA.md](BAOTA.md)，升级/回滚见 [UPGRADE.md](UPGRADE.md)，恢复见 [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)。不把草稿提交自动打为正式生产版本。

## 商业运营仍需单独补齐

真实支付/签名回调/持久化结算去重/账务分录/退款对账、控制器消费者、邮件验证与找回、MFA/完整账号生命周期、分页导出、税务政策、异地加密备份/PITR、容量和滥用防护、监控告警、部署 TLS/秘密轮换和事件响应均不因本里程碑而自动完成。运营负责人需按实际业务放行；不能宣称安全认证、支付合规或 SLA。
