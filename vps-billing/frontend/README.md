# 星屿云财务控制台

Vue 3、TypeScript 与 Vite。客户侧提供套餐报价、订单确认、订单/账单与服务记录；管理员维护站点品牌、币种及独立价格、SMTP 设置、插件状态和版本交接。支付渠道由运营者与开发者按 [支付插件接入说明](../docs/PAYMENT_PLUGINS.md)扩展，默认适配器保持关闭；界面按实际结账结果展示，不伪造已付或资源开通。中文排版、主题 token、键盘、字段错误与视觉验收规则见 [界面维护规范](../docs/UI_GUIDELINES.md)。

## 运行与构建

锁文件固定依赖，当前发布工具链记录在 BUILD.json（基线 Node.js 24.19.0）。在本目录执行：

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

开发 API 默认代理到 `http://127.0.0.1:8080`，可用 `API_PROXY_TARGET` 覆盖。后端 `APP_ORIGIN` 必须与浏览器来源完全一致；localhost 与 127.0.0.1 不等价。显式 demo 的公开体验账号只能用于隔离演示；只读预览不写交易，不证明数据库或真实服务可用。

```sh
npm run typecheck
npm run test
npm run format:check
npm run build
npm audit --audit-level=high
```

`dist/` 由同源 HTTPS Nginx 提供，API 代理不能 fallback 为 HTML。Core 0.5.0 起的发行资源包包含编译网页；服务器无需运行 Vite、Go 或 Node.js。前后端及插件宿主必须来自同一 Core Release，见 [安装说明](../docs/INSTALL.md)。v0.5.2 发布后的 UI 源码迭代尚未包含在其固定发行资产中。

## 财务与权限

- 全新安装仅 CNY；`GET /currencies` 提供登记元数据，选择器仅显示 enabled 项，语言 zh-CN/en 与币种独立。
- 管理员“财务设置”维护名称、前后缀、0–6 位精度、默认/启用和独立报价；使用后精度锁定，未完成义务阻止停用。价格以精确十进制字符串提交，不使用浮点换汇。
- 订单/账单/服务按各自 currency_format 显示历史金额，新订单保存套餐快照；更改当前币种格式不改历史。完整规则见 [财务模型](../docs/FINANCIAL_MODEL.md)。
- 新订单确认始终提交当前展示的 quote；PRICE_CHANGED 后重新展示并要求确认。超时保留原幂等键和 quote，账户变化不跨账户重发；浏览器刷新仍需先核对历史。
- Cookie 会话、CSRF、角色和所有权由服务端决定；不在 localStorage 存认证材料。列表/本地筛选和可见记录导出不等于完整财务导出。

## 插件与更新

扩展中心读取真实清单，管理员可保存只写 SMTP 凭据、主动握手与固定测试；不会回显用户名/密码或执行网页上传插件。仅 root 批准的独立进程能收到本次凭据，配置/审批/连接/SMTP 接受是不同状态，`accepted` 不保证到达收件箱。

版本更新只查询固定官方正常 Release 并形成明确审计交接，不安装或重启主机。Core 0.5.0 识别原始程序/资源分发和旧归档；已发布 0.4.0 网页不自动获得新格式支持。主机暂存检查点可能要求备份或已装插件兼容审查，不能显示为安装成功。见 [更新说明](../docs/UPDATES.md)。

## 浏览器与回归

组件测试覆盖明确的模拟 API，不能替代浏览器与真实后端。启动隔离 demo API/前端后执行 `npm run test:e2e`；所需 Playwright 浏览器应事先按项目锁定版本准备，或用 `CHROMIUM_PATH` 指定已验证安装的浏览器。保持 Chromium 沙箱，不能通过禁用安全机制取得通过结果。脚本创建合成订单并覆盖桌面/手机交互，不得指向业务主机。

截图和日志保留在 Actions artifact 或临时目录，不提交生成输出；历史浏览器问题及后续成功记录见 [VALIDATION.md](../docs/VALIDATION.md)。新界面/财务规则的结论只采用该提交的真实测试，不能沿用旧版本计数。完整无障碍、全部浏览器、真实域名及生产规模未由这些检查覆盖。

主要实现为 `App.vue`、`FinancialSettingsPage.vue`、`SettingsPage.vue`、`IntegrationsPage.vue`，请求/DTO 在 `lib/`，回归在 `tests/`。接口约定见 [CONTRACT.md](../docs/CONTRACT.md)。
