# 备份与隔离恢复

本项目提供逻辑备份脚本和操作指引，没有自动计划任务、加密、异地复制、binlog/PITR、保留清理或灾备切换服务。RPO ≤ 24 小时、RTO ≤ 4 小时只能作为待演练的测试目标，不能据此承诺 SLA。

## 备份范围

业务数据库需要覆盖客户、会话、套餐与币种价格、订单、账单、设置、幂等请求、审计、outbox 和迁移记录。发布包、配置版本、秘密引用、TLS/数据库证书和必要秘密的独立加密备份也要可恢复。不要把秘密和业务备份混入源码、GitHub Release、网页目录或普通日志。

`deploy/scripts/backup.sh` 适用于现有 Compose 项目。它用 `--single-transaction --quick` 导出当前 InnoDB 数据，带触发器/例程/事件选项；备份期间禁止迁移/DDL。它没有锁住外部系统，也不保证跨数据库一致性。默认使用仅运维可用的 root 秘密；长期运营应设计并验收专用备份账号权限，不能把备份凭据挂入 API。

```sh
cd /path/to/source/vps-billing/deploy
./scripts/backup.sh
```

归档以时间加随机后缀命名，同秒并行执行不会覆盖；失败的 dump 或 gzip 校验不会发布成正式归档。目录 0700、归档/校验和 0600。`*.sha256` 使用 basename，复制到离机目录后仍可验证：

```sh
cd /private/path/to/copied-backups
sha256sum -c aster-TIMESTAMP-RANDOM.sql.gz.sha256
gzip -t aster-TIMESTAMP-RANDOM.sql.gz
```

文件仍是**未加密的敏感数据**。按组织政策立即加密、异地复制并验证，保存必要的密钥恢复方法。SHA-256 与 gzip 检查不能证明备份来自可信方或 SQL 内容无恶意修改；必须控制备份来源与访问权限。仅复制到同一主机或同一磁盘不能满足灾备需求。

原生 MySQL 部署可使用经过审查的 `mysqldump --defaults-extra-file=/private/client.cnf ...` 管道；凭据文件需 0600，密码不出现在命令行。务必使用 `set -o pipefail`，检查导出和压缩两段状态，用独占临时文件、完成后再原子改名，并生成 basename 校验和。此处不提供可直接覆盖数据库的自动恢复脚本。

## 恢复前核对

每次迁移前和定期演练时，准备隔离的 MySQL 实例或独立库。确认恢复目标的主机、端口、库名、Compose project、数据卷与运行实例完全不同；当前插件继续设为 `payment.disabled` / `email.disabled`，不接真实控制器。

记录：备份生成时间与大小、SHA-256、来源提交和 schema 版本、MySQL 版本、演练开始时间、目标实例身份、操作人。只恢复可信 SQL；恢复会创建或覆盖对象，必须确认目标没有待保留数据。

同主机仅恢复数据库时可用单独 Compose project：

```sh
cd /path/to/source/vps-billing/deploy
docker compose --env-file .env -f compose.yml -p aster-restore up -d db
docker compose --env-file .env -f compose.yml -p aster-restore ps
```

等待独立库健康后导入已经核验的文件（路径由操作者替换）：

```sh
set -o pipefail
gzip -dc /private/path/aster-TIMESTAMP-RANDOM.sql.gz | \
  docker compose --env-file .env -f compose.yml -p aster-restore exec -T db sh -c \
  'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysql --user=root aster'
```

以上只启动 `db`，不创建固定 proxy/edge 子网。若完整启动第二套 API/nginx，必须另外配置端口、子网、可信代理和独立 HTTPS 域名；优先在另一台隔离测试主机进行。不能直接复用原 Compose 固定网段，也不能把恢复库 API 指回运行库 DSN。

## 业务完整性与证据

先用与备份匹配的二进制读取，不要一开始就执行新版本迁移。至少核对：

1. `schema_migrations` 编号/checksum 与该源码匹配；表数量及各表计数与备份时记录一致。
2. 客户与订单/账单外键关系、金额和币种一致；CNY 与 USD 分组汇总分别一致，不求混合总和。历史 issuer 快照没有被当前设置覆盖。
3. 幂等记录能返回原订单；对相同键的冲突载荷仍拒绝，不多出订单、账单、审计或 outbox。
4. 两客户隔离、管理员只读详情和设置权限、过期/无效会话处理、CSRF 和禁用支付均符合预期。
5. 每个迁移后的新功能在隔离库上可用，运行数据库身份不能执行 CREATE、DROP、ALTER、GRANT。

恢复出的会话也是备份中的敏感凭据状态。不要公开恢复站点；按事件情景审查是否需要使全部会话失效，不要把旧 cookie 能登录当作业务完整性证明。正式切换要明确停写窗口、最后备份时点、差异处理和批准人。

记录恢复结束时间、恢复耗时、校验结果和失败点。文件校验成功、mock Docker 脚本测试、空数据库启动分别是不同证据；只有真实导入且业务检查通过才能记为该范围的恢复演练完成。最终状态见 [VALIDATION.md](VALIDATION.md)。

## 保留与清理

依据运营要求制定保留期限和访问审计，例如从 7 份日备份、4 份周备份开始评估；这不是法定期限建议。删除前确认至少一个近期恢复点已实际演练并有异地副本。脚本不自动删除备份或卷，避免尚未验证的备份替换唯一可恢复副本。
