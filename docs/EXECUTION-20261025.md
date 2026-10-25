# 首批执行记录 · 2026-10-25

起始 main：`9858f1ce4be21c23741f747bc445468413a6951a`。
这是本批提交前的源码/本地验证记录，**不宣称整个功能表完成，也不以本地检查替代GitHub、真实MySQL、浏览器或真机验收**。

## 计划与范围

- [执行计划](EXECUTION_PLAN.md)：18个按依赖排列的工作包，每个先定状态/接口、写负例，再实现和验收。
- [逐项台账](execution-tracker.json)：269个唯一审查条目、562条验收要求，保留原代码观察/证据、下一步及所属工作包。
- 1625个完整功能树末级条目还包括字段/文案/安全约束，不当作已完成数。原规划图片与用户 `.DS_Store` 未纳入业务提交。

## 已实际修改

| 工作包 | 本批实现 | 验收尚欠 |
| --- | --- | --- |
| W01 | Cloud安装/依赖准备/TCG白名单/CI收敛Ubuntu22/24，26拒绝；不放松升级systemd等安全条件 | 新SHA22/24原生CI与正式制品安装；财务22完整原生链另列W04 |
| W02 | Core0.5.10候选；资源0.1.1/minCore0.5.10；严格来源和PREPARED收据升级回归；旧版本可信清单不变，新版绑定真实MySQL浏览器门禁源码 | Linux完整prepare/升级fixture、新Release、公开六资产核验与实际prepare；旧分叉资产仍不能新prepare |
| W05 | 通用账本完整原子恢复，移除64条截断/新增限制，用1MiB预算防资源滥用；其余网络账本空串/预算/写前payload与key校验，存储失败不发写请求 | 新SHA真实浏览器；不声称取消其他网络账本128条结构边界或提供无限容量 |
| W06 | 报表与购买币种说明分开、读取失败与写入未知分开、30种审计标题自然化并保留原code、11处关闭ARIA跟随语言 | 新SHA实际中英桌面/手机截图和人工复核 |
| W16切片 | 财务新真实MySQL浏览器runner，接独立只读CI和正式构建；Cloud发行强制新job通过，旧demo门禁不删除 | 首次Linux真实执行、20项UI断言/12截图、数据库历史核对、实际TLS负正证明 |

W16入口只接受owned原生MySQL Unix socket和真实datadir，新建随机独占测试库；Go overlay使用真实生产Handler、Secure Cookie和CSRF。
浏览器只登录/登出、读页面与设置本地偏好；合成待付款订单由隔离fixture准备，不付款/不开通。
所有非session表前后摘要一致才通过。Firefox私有profile先证明未知CA被拒绝，再导入限localhost测试CA；不改用户钥匙串、系统信任或绕过TLS。
仅固定schema报告和12张合成PNG可导出；凭据/原始日志/私钥/profile留在私有scratch并清理。

## 本地实测

| 范围 | 结果 | 限制 |
| --- | --- | --- |
| Cloud前端 | format/typecheck/build；39文件958 tests PASS | mock HTTP + jsdom，不是真实MySQL/浏览器 |
| 财务前端0.5.10 | format/typecheck/build；23文件1034 Vitest +35 Node PASS | 新浏览器脚本语法/import检查不是实际浏览器运行 |
| Cloud安装/打包/发行合同 | 19+111+25+28+19+43 = **245 tests PASS** | 离线模型；输出中的虚构release-id和下载状态不是真实发行 |
| 财务发行控制器/runtime | **93 tests PASS** | 网络/资产为合成fixture |
| 财务update-manager | **46 tests PASS**，实际回环HTTP部分已执行 | 默认macOS `/var`链接被保护路径检查拒绝，使用canonical `/private/tmp`重跑；沙箱阻止loopback后经许可执行，不放宽生产规则 |
| 真实MySQL浏览器runner边界 | **36 tests PASS**；显式Linux overlay交叉编译、bash/Node语法通过 | 实际MySQL、Firefox、Linux race尚未运行；Darwin入口明确拒绝并不创建产物 |
| 财务受跟踪Go | 20包Linux build/cross-vet、API/host静态ELF与LinuxRPC测试编译通过；11 portable包181 PASS事件 | Darwin全race未通过：3包Linux依赖setup失败，另6包平台排除；不是全量Linux/DB通过 |
| Workflow/来源 | actionlint1.7.7、diff检查；当前15项精确job合同 | CI未运行前不能写15/15通过 |

RED→GREEN证据：第96条未知意图恢复原失败；5个显式非法key原失败；overlay写前校验/坏存储和三种公网账本预算负例原失败，修复后通过。
完整并行测试暴露迁移测试未等WebCrypto完成，改为等待一次写边界，未增加点击、业务重试或放宽生产校验。

## 资金和历史保护

- 13个受跟踪SQL文件与起始源码逐字节一致；没有新增财务迁移。
- 未修改财务金额、支付与历史快照业务代码。版本与资源兼容声明不改变付款事实。
- 最初支付checkout/verify四种重放测试保持原内容、固定Unix连接与完整409要求；本机只编译，真正执行留Linux门禁。
- 旧标签/Release/附件和用户修改不覆盖。Core0.5.10、资源0.1.1均仍候选，不预填发行成功。

## 下一批与明确未验项

后续按依赖推进身份/权限 → 财务资源任务与服务投影 → 节点/镜像/目录 → 实例日常管理 → OVS感知备份迁移 → 网络/公网隔离 → 运维灾备 → 完整UI与最终发行。
Ubuntu22财务全原生链、正式Cloud下载、真实KVM/双宿主物理网络、容量/异机灾备等没有在本批解决，台账继续保留，不能用首批测试数量掩盖。
