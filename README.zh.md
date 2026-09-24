# dsh-soul-md

**GitHub**: [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · **npm**: [dsh-soul-md](https://www.npmjs.com/package/dsh-soul-md) · [English](README.md)

[![Enhancement Suite](https://img.shields.io/badge/part%20of-Enhancement%20Suite-3964fe)](https://github.com/Scorp1o117/dsh-enhancement-suite) [![npm](https://img.shields.io/npm/v/dsh-enhancement-suite)](https://www.npmjs.com/package/dsh-enhancement-suite)

属于 [DeepSeek Harness Enhancement Suite](https://github.com/Scorp1o117/dsh-enhancement-suite) —— Vision · Soul/Persona · 长期记忆 · 插件市场。

DeepSeek Harness 的人设 + 长期记忆插件——**完全不用管文件**：

> 在 设置 → 人设卡 里输入人设卡的**名称**和**内容**，点保存，剩下的插件全包了。

## 功能

- **人设卡**：卡片内容渲染成系统提示词段落（`soul:persona`）。支持多张卡：设置一张默认卡，聊天框标题栏的「人设」下拉可以给每个会话单独选卡
- **长期记忆**：Agent 自带五个工具——
  - `memory_append` / `memory_read` / `memory_rewrite`：持久记忆文件（Agent.md / memory.md 风格）。当前人设卡有自己的记忆，没选卡时用全局记忆；分层模式下可用可选的 `topic` 参数按主题读写
  - `soul_read` / `soul_update`：AI 自己读、自己**演化人设卡**——发现自己的稳定特质就折叠进卡片，跨会话**持续成长**而不是每次重置
  - 记忆会以 `soul:memory` 段落注入提示词（有上限），AI 随时看得见自己的记忆
- **解析规则**：`会话选择（聊天框切换）> 工作区人设 > 默认卡 > 无`，切换下一轮对话即生效，无需重启
- **工作区人设（v0.5.2）**：设置 → 人设卡 里会列出所有工作区，每个工作区可以指定一张人设卡——该工作区的会话默认用它（会话级切换仍然优先）。工作区列表来自 dsh 的工作区注册表，不用输任何路径

## 安装

在 profile 的 `cordis.patch.yml`（如 `$DSH_HOME/profiles/web/cordis.patch.yml`）里 insert：

```yaml
- insert:
    - id: soul-md
      name: 'dsh-soul-md'          # 之前先 pnpm add dsh-soul-md
```

重启 `dsh web`，打开 **设置 → 人设卡**：输入名称 + 内容，保存，完事。

## 文件在哪（你不用管，仅供参考）

- 人设卡：存在当前 Profile patch 的 `soul-md` 配置里，即 `cards: { 名称 -> 内容 }` + `active` 默认卡 + 会话级 `sessions`
- 记忆文件：插件托管在 `$DSH_HOME/soul-md/memory/`（`global.md` + 每张卡一个文件），按需自动创建
- 可选分层记忆（默认关闭）：`memory/<卡名>/core.md` 在注入上限内参与注入，`memory/<卡名>/topics/*.md` 只把标题和首个正文行注入为索引；`memory_read({ topic: "..." })` 按需取回主题全文。开启后若尚未建立目录结构，会继续读取旧的 `<卡名>.md`，首次追加 core 时也会保留旧内容
- 从 ≤ v0.4 的文件版升级？插件首次运行会**自动导入**旧 `path` 卡片（名为「默认」）和旧记忆文件

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `cards` | `{}` | 人设卡：名称 → Markdown 内容（界面管理） |
| `active` | `''` | 默认卡名称；空 = 默认不启用 |
| `sessions` | `{}` | 会话级选择（sessionId → 卡名 / `none` / `''`），聊天框切换器写入 |
| `workspaces` | `{}` | 工作区级选择（工作区路径 → 卡名 / `none` / `''`），设置页写入 |
| `workspaceList` | `[]` | 工作区列表（路径 + 标题），由服务端从 dsh 工作区注册表维护 |
| `memory.maxBytes` | `1048576` | `memory_append` / `memory_rewrite` 超过此大小会拒绝 |
| `memory.inject` | `true` | 把记忆渲染为 `soul:memory` 提示词段落 |
| `memory.layered` | `false` | 启用渐进式分层记忆：core + topics 索引 |
| `memory.injectMaxChars` | `8000` | 注入记忆内容的字符上限；分层模式先保留主题索引，再保留 core 首尾 |
| `memory.order` | `0.5` | 注入的记忆段落顺序 |
| `skipSubagents` | `false` | 子代理会话（DSH 标记为 `origin: "subagent"`）不注入 `soul:persona` / `soul:memory` 两段提示词；工具作用域不变 |
| legacy 字段 | — | `path`、`fallback`、`order`、`complete`、`watch`、`debounceMs`、`soulMaxBytes`、`personas`、`roster`、`memory.path`… 保留以兼容旧配置，仅用于一次性导入 |

`skipSubagents` 默认关闭，保持 v0.7.0 的现有行为。开启后，DSH 以 `origin: "subagent"` 创建的委派子会话不再收到人设卡与记忆段落——
子代理通常只做一件小事，不必每轮都背着主会话的完整人设与长期记忆。

它**只作用于提示词注入**：`cardNameOf`、`memoryTarget` 与三个 `memory_*` 工具的作用域完全不变，子代理的读写目标与未开启时一致，
不会因为跳过注入而落到 `global.md`。

兼容性：适配 `@deepseek-ai/dsh@0.1.7-rc.1`（npm `next`）；npm `latest` 是 `0.1.5-rc.3`。新版使用 Profile patch 与客户端 `configForms`。旧宿主请使用插件旧版；alpha 构建仍标记 `unknown`。

## v0.8.1：人设切换与分层记忆截断修复

- 会话人设写入被拒时显示错误并回滚到宿主快照；写入期间锁定下拉，避免重叠修改。
- 分层记忆超限时优先保留主题索引，core 保留首尾，并在提示词中写明省略内容。
- 已通过 DSH `0.1.5-rc.3` 一次性 Profile 的安装、Web 启动、首页与客户端 Bundle HTTP 检查，以及卸载验证。

## v0.8.0：子代理提示词控制与 DSH next 兼容

- 新增默认关闭的 `skipSubagents`：开启后，DSH 标记为 `origin: "subagent"` 的委派子会话不再注入 `soul:persona` / `soul:memory` 两段提示词。
- 只作用于渲染路径；`cardNameOf`、`memoryTarget` 与 `memory_*` 工具的作用域不变。
- 设置页「长期记忆」分组提供开关，与 `memory.inject` / `memory.layered` 共用保存按钮。
- 记录 DSH `0.1.5-rc.3`（`next`）兼容性；未验证的 alpha 版本继续标记 `unknown`。

## v0.7.0：分层记忆

- 新增默认关闭的 `memory.layered`，保持旧用户的单文件行为不变。
- 开启后，`core.md` 作为常驻记忆，`topics/*.md` 只向提示词提供标题和一行摘要。
- 三个 `memory_*` 工具均支持可选 `topic` 参数，按需读取、追加或重写主题全文。
- 旧 `<卡名>.md` 会继续作为 core 回退来源，首次分层追加时自动带入，不会因切换模式丢失可见记忆。
- 已完成 DSH `0.1.5-rc.2` 一次性 Profile 的安装、Web 启动、客户端 Bundle 和卸载冒烟。

## v0.6.2：写入改为原子提交并校验

此前所有保存都以单独一次 `scope.set()/unset()` 提交，写完只管弹「已保存」，从不确认是否真的生效。
问题在于 scope 的契约是「完成写入与恢复读取后结算」，**不是**「被拒就抛错」——被宿主以
`settings/conflict` 拒绝的写入同样会 resolve，于是界面显示成功而值静默回退。

具体修掉三处：

- **同一个命名空间被绑了两个 scope**（设置栏一个、聊天框标题栏的人设切换器一个）。每个 scope 各自维护
  `pendingRevision` 与写入队列，于是两边可能各自按一个已被对方超越的 revision 去写入 —— 宿主要么拒绝，
  要么接受后立刻被后来者覆盖。现在合并为**一个共享 scope**（scope 本就是设计成跨挂载点共享的）。
- **删除人设卡时并行写入**：`Promise.all([set("cards"), unset("active")])`。两处修改现在放进**同一次
  `mutate()`**，共用一个 revision 栅栏。
- **写完不校验**：现在写入结算后回读命名空间 section，只有确认生效才报「已保存」，否则提示
  「写入未生效」并重新载入表单。「不启用」选项也从直接 `scope.unset` 改走同一条校验路径。

另外删掉了 6 处 `if (typeof scope.load === "function") scope.load()`。`SettingsScope` 接口从来没有
`load()`（读走的是共享的 describe 镜像，由宿主 `settings/document-updated` 驱动刷新），这些守卫是照
臆测 API 写的死代码，只会让人误以为"已经刷新过了"。

## 注意事项

- **不要在人设文本里写 `{{` / `}}`**：它们是提示词变量语法，未知变量会在渲染时报错（目前没有转义语法）。
- 人设/记忆段落按组装解析：稳定卡片字节不变（KV Cache 友好），编辑即时生效。
- DSH 会直接公开插件注册的 `soul-md` settings 命名空间；插件不会修改宿主安装目录中的文件。
- 建议在人设卡里写清工作准则（如"任务质量优先"），避免角色扮演影响干活质量。
- 从 `0.5.8` 起最低支持 DSH `0.1.0-rc.7`，已针对 `0.1.0-rc.7`、
  `0.1.0-rc.8` 和 `0.1.1-rc.1` 测试。仍使用 DSH `0.1.0-rc.6` 的用户请锁定
  `dsh-soul-md@0.5.6`；这是最后一个包含旧 settings 白名单兼容补丁的版本。

## License

MIT

