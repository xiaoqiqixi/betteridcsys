# 星屿云主控与 KVM 计算节点

独立于 `vps-billing/` 的云资源系统，当前为开发版，不是已验收的完整云平台。财务销售商品和确认付款，主控接纳任务并管理资源，被控安装在宿主机上，通过 libvirt / QEMU / KVM 实际运行客户虚拟机。客户虚拟机不需要安装本系统的被控服务。

不对接或复制 IDCsmart API；参考其产品与资源分层、区域/节点、实例生命周期和运维思路。使用 Go、MySQL、原生 systemd，禁止由安装器自动修改宿主机桥接、防火墙或存储。

## 当前工作边界

- 财务与主控使用公开的 `aster.controller/1` 合同，主控与计算节点使用 `aster.node/1`；协议兼容测试不等于虚拟机已创建。
- 财务、主控使用独立数据库和权限。主控没有支付、改价、改账单状态的接口，也不能读取财务数据库。
- 主控持久接纳、资源预留和节点派发分离。超时、进程崩溃和丢失响应保留结果不明状态，不通过重发开通制造第二台虚拟机。
- 节点不运行外部传入 shell；仅允许预定义动作、审批镜像、存储和网络。客户端提供路径、XML、SSH 命令或下载 URL 均不是合法资源参数。
- 被控面向 Ubuntu 22.04 及以上的 amd64 宿主机。每个发行版必须单独经过 doctor、真 KVM 和重启恢复验收；不能把交叉编译称为全版本兼容。

本轮包含独立管理台、staff RBAC、实例动作、停止态快照/备份与四阶段冷迁移实现；热迁移、租户SSO、VPC和生产宿主验收不在已完成范围。具体实现、支持范围、命令和测试结果见下列记录；当前禁止直接用于真实客户销售。没有用假按钮、内存数据或模拟执行器冒充已完成的主控功能。

- [功能与验收矩阵](docs/ARCHITECTURE.md)
- [本轮开发验证](docs/VALIDATION.md) · [管理台与资源 API](docs/CONSOLE_API.md) · [日志与审计](docs/LOGGING.md)
- [主控运维](deploy/controller-OPERATIONS.md) · [KVM 被控运维](NODE_README.md)
- [术语](GLOSSARY.md)
- 财务产品配置合同：[PRODUCT_CONFIGURATION.md](../vps-billing/docs/PRODUCT_CONFIGURATION.md)

开发环境使用相邻财务源码的公开 `controllerapi` 类型（`go.mod` 的本地 replace），不是复制或导入其内部数据库。正式主控发行时须把公共合同与对应来源、依赖锁定到可复现安装包；当前开发目录不附加到财务 Release 中。

```sh
cd aster-cloud
# 在安装 Go 的开发机运行；不修改宿主机或创建虚拟机
GOCACHE=/tmp/aster-cloud-go-cache go test ./...
GOCACHE=/tmp/aster-cloud-go-cache go vet ./...
```

独立开发 CI 包括 Ubuntu22/24 单测与构建、Ubuntu24 隔离真实 MySQL（禁止 skip）、独立 Vue 管理台检查和 Go 扫描。Ubuntu22 单测没有数据库时明确跳过实库测试，不能当作 Ubuntu22 完整部署或真 KVM 验收；真实 Ubuntu22 MySQL 由独立测试机另外记录。
