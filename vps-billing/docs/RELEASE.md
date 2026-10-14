# 候选发布、复现与放行条件

本次维护里程碑是可配置站点品牌、简体中文/English 和独立 CNY/USD 定价，以及已发现安全/正确性问题的修复。用户已授权将经审查的源码、文档、构建包和校验和交付到公开仓库 `xiaoqiqixi/betteridcsys`；秘密、实际服务器配置、客户数据和敏感日志必须排除。本轮仅推进开发分支与草稿 PR，不合并、不触发候选发布、不部署外部主机、不接真实付款或邮件。功能与验证是否完成，以 [VALIDATION.md](VALIDATION.md) 及 [原生检查点](NATIVE_CHECKPOINT.md) 的实际记录为准，不能把“文档已写”当作验收通过。

后续部署目标已调整为 **单服务器原生 Linux**，当前源码、部署工具和 CI 都只保留原生路径，高可用暂缓。现有 `0.3.0-rc.1` 保留为历史候选，不覆盖或重新命名；修订后的原生安装包、systemd/开机启动、升级及备份恢复方案仍须单独审查验证，完成前不触发新版本发布。

根 LICENSE、README 保留原文；项目 `vps-billing/README.md` 已更新为当前原生路径。**当前接口与能力以 [CONTRACT.md](CONTRACT.md)、[SITE_SETTINGS.md](SITE_SETTINGS.md) 和本轮验证记录为准。** 旧提交中的 USD-only、迁移/数据库未验证等文字属于早期快照，不作为当前能力证明。

## 可审查的交付物

- 干净已提交的开发分支、同一草稿 PR、变更记录与实际测试证据。
- `aster-VERSION-linux-amd64.tar.gz`：静态 API、编译网页、文档、依赖清单和许可证材料；修订后的运行包只带原生 systemd/Nginx 样例及 `backup-native.sh`。
- `aster-VERSION-source.tar.gz`：同一修订提交中的根 LICENSE/README 和项目源码，排除本地秘密、依赖目录、构建输出与旧测试日志；不重新加入已从当前源码删除的旧部署实现。
- `BUILD.json`：准确 Git 提交、提交时间作为 SOURCE_DATE_EPOCH、目标架构、构建参数、工具链及关键输入 SHA-256；修订包新增 `deployment_model`，明确单服务器原生模型和目标主机验证状态。
- `SHA256SUMS`：验证两个归档和 BUILD.json。尚无签名、来源证明或完整 SPDX/CycloneDX SBOM；依赖清单及收集的 license/notice 文件不等于法律合规结论。

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
2. 真实一次性 MySQL：迁移 1–5 与重复迁移、升级/已知中断恢复、完整 checksum、未知版本拒绝、16 并发幂等、冲突/回滚、CNY/USD 分组汇总与不可变身份；数据库拒绝小写/带重音币种近似值。
3. 管理员设置权限/CSRF/revision/审计，危险链接/文本拒绝，客户无法写，公开设置不泄露私有字段。两语言/两币种分别切换与错误回退。
4. 两个客户隔离、直接账单详情、迟到请求处理、错误/超时后的订单安全重试；禁用支付不改变已付状态。
5. 新目标环境的原生安装、systemd/开机启动、runtime 最小权限、升级及真实备份与隔离恢复，以及受支持浏览器的明确范围验收。旧拓扑的合成数据验证是历史范围，不能替代原生部署验收；CI 也改为原生 MySQL 8.4 临时进程和独立数据目录。无法完成的项必须列出具体阻塞，不能把模拟替代为真实通过。
6. Go/npm 依赖扫描、原生系统软件及来源检查；扫描端点受阻时记录“不确定/未扫描”，不写“0 漏洞”。每种扫描的覆盖范围分别记录。
7. 打包两次校验和相同、归档内容/权限检查、不含秘密、静态二进制实际启动、源码根 LICENSE/README 哈希不变。

当前 npm 审计或单元测试结果不能替代浏览器、TLS 边界、压力或恢复验收。最终验证应在最后代码变更后运行；只改文档需核对链接和打包内容，无需伪造应用回归时间。

## 发布与安装

计划中的只读 CI、标签候选构建与默认分支受信草稿发布流程，见 [CI 与草稿 Release 自动化](CI_RELEASE_AUTOMATION.md)。自动化尚未安装或运行；提交工作流代码不能替代修订后原生安装包的审查。首次合并、标签推送和触发需按该文档的审查边界分别处理，现有 rc.1 文件保持原样。

当前原生 MySQL 8.4.11 分发请求返回 HTTP 403，分发清单为 `awaiting_verification`、SHA-256 为空，夹具在下载/执行前明确失败。真实初始化、运行库兼容性和完整原生 CI 未验证；不能因为已获公开交付授权就绕过此发布门禁。Go 漏洞数据库访问阻塞也仍需单独解决。

先将源码提交/草稿 PR、生成的包和证据相互对应，再上传到明确标记的草稿 Release。没有可用 Release API 或授权凭据时，保留本地完整发布目录并报告出版阻塞；不要把上传失败说成发布成功，也不要为此创建长期凭据。

本地文件齐全、草稿 Release 创建和实际部署是三个独立动作。安装见 [INSTALL.md](INSTALL.md)，升级/回滚见 [UPGRADE.md](UPGRADE.md)，恢复见 [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)。不把草稿提交自动打为正式生产版本。

## 商业运营仍需单独补齐

真实支付/签名回调/持久化结算去重/账务分录/退款对账、控制器消费者、邮件验证与找回、MFA/完整账号生命周期、分页导出、税务政策、异地加密备份/PITR、容量和滥用防护、监控告警、部署 TLS/秘密轮换和事件响应均不因本轮里程碑而自动完成。运营负责人需按实际业务放行；不能宣称安全认证、支付合规或 SLA。
