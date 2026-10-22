# Aster 云管理

## 方向与取舍

这是一套管理服务器、节点与操作任务的工作界面，不是销售首页。参考 Apple HIG 的内容优先、分层、明确反馈、可及性原则，不复制财务界面、已有截图或第三方产品。

放弃常见“统计卡仪表盘”：首屏直接是可搜索的实例清单。桌面以稳定窄侧栏和宽工作区呈现，移动端转为有焦点约束的导航抽屉；实例名称与当前状态优先，CPU/内存/磁盘作为同一行的规格。实例详情在完整页面呈现，危险操作只在确认对话框中完成。迁移使用四阶段向导，分别说明准备、安全传输、导入、激活，绝不因上一请求已受理而自动执行下一阶段。

## 视觉契约

- 瓷白画布 `#f5f6f8`，白色内容面 `#ffffff`，石墨文字 `#1d2533`，次级文字 `#536174`，分隔线 `#dce1e8`，蓝色操作 `#175cd3`。深色使用独立语义色，不反转整页。
- 系统字体栈，中文 PingFang SC / Microsoft YaHei；正文15px、辅助13px、页标题28px。正常字重400/500/600，不用细灰字制造高级感。
- 4/8/12/16/24/32间距；内容最大1440px。44px最小交互高度。控件10px、内容组16px、浮层20px，不让所有内容都变成等尺寸卡片。
- 边界用于表达分组；阴影只用于浮层。不做炫光、营销渐变、装饰数字或无意义统计。
- 动效只回应交互：120–180ms透明度与小幅位移；尊重reduced-motion。骨架只在加载阶段，失败绝不显示空列表。

## 组件与状态所有权

- `api/client.ts`：同源真实HTTP、cookie、CSRF、严格JSON、安全错误分类，无演示回退、无自动重试。
- `useSession`：身份与epoch、权限、登出后清空资源；迟到响应不得恢复旧会话。
- `useMutation`：稳定32位小写hex意图key；发送后结果未知锁定，保留key，不能通过关闭重开自动重发。只把202叫“已受理”，不叫“已完成”。
- `UiOverlay`：独立浮层生命周期、焦点锁定/恢复、Escape/背景/浏览器返回；忙碌时不关闭。
- `UiSelect`：自定义listbox，方向键/Home/End/Enter/Escape和类型搜索，无原生select。
- `UiButton / StateBlock / StatusBadge / ToastStack`：统一忙碌、空、错、状态反馈，不依赖颜色传达意义。
- 页面只消费明确DTO，测试fixtures仅在tests下，生产入口绝不导入。

## 安全与验收边界

真实接口默认 `/console/v1`；不提供用户可切换的数据来源。权限以服务端返回为准，未知权限禁止危险动作。危险操作必须逐字输入实例ID，最终由后端确认。网络未知时保留意图并引导查看任务，不能假成功/自动再次派发。CSRF和会话只留内存，密码不持久化。

本地执行typecheck、Vitest、format、build；实际320/375/768/1440浏览器与真实后端由root另行验收，不能以单元测试替代视觉验收。

## 实际读取的技能

本轮已读取 ui-skills-root、frontend-design、apple-design 及其accessibility/color/layout/typography/entering-data/dark-mode参考，vue-best-practices及reactivity/sfc/component-data-flow/composables核心参考。ui-skills CLI本地离线缓存不可用（ENOTCACHED），没有宣称新安装。
