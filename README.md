# DSH Soul / Persona

简体中文 | [English](README.en.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 添加可切换的人设卡和文件式长期记忆。你可以为不同工作区或会话选择人设，让 Agent 按需读取、写入记忆，并在使用工具时更新人设。

## 功能

- **人设卡**：在插件页创建、编辑并设置默认卡片；聊天中的人设切换器可为单个会话选择卡片，也可以在插件页将其隐藏。
- **工作区人设**：为工作区指定默认卡片。解析顺序为：会话选择 → 工作区人设 → 默认卡 → 不启用。
- **文件记忆**：Agent 可使用 `memory_read`、`memory_append`、`memory_rewrite` 读取和维护记忆；`soul_read`、`soul_update` 用于读取和更新人设卡。
- **可选分层记忆**：将常驻 `core.md` 与按主题读取的 `topics/*.md` 分开，支持 `memory_search` 关键词检索，以及可选的关键词召回和压缩后补偿。
- **子代理控制**：可选择不向子代理注入人设和记忆段落；这不会改变记忆工具的读写作用域。

Soul 的记忆以文件和人设为中心；需要对话捕获、模型提取和向量召回时，可另看 [DSH TDAI Memory](https://github.com/Scorp1o117/dsh-tdai-memory)。两个插件可独立使用。

## 兼容性与安装

支持 DSH Web / Desktop；仓库声明兼容 `0.2.0-rc.2`、`0.2.1-rc.1` / `rc.2` / `rc.3` / `rc.4` / `rc.5` 和符合 `>=0.2.0-rc.2 <0.3.0` 的版本，预发布版本范围见 [package.json](package.json)。要求 Node.js `>=20.18`。

Desktop 先在 **应用 → 管理 dsh 命令** 安装桌面版 `dsh`：

```sh
dsh plugin --profile desktop add dsh-soul-md
```

Web 将 `desktop` 改为 `web`。安装后重启 DSH，打开 **插件 → 已安装 → dsh-soul-md**。也可通过 [Enhancement Suite](https://github.com/Scorp1o117/dsh-enhancement-suite) 安装。

## 快速使用

1. 在插件页创建人设卡，填写名称和 Markdown 内容并保存。
2. 设为默认卡，或为指定工作区配置卡片；也可在聊天标题栏单独切换会话人设。
3. 与 Agent 对话，让它按需使用记忆或人设工具。人设变化和记忆写入取决于模型的实际工具调用，不保证自动发生。
4. 需要主题式管理时，在设置中启用分层记忆；关键词自动召回与压缩后补偿需分别开启。

## 记忆与设置

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `showPersonaSwitcher` | `true` | 显示会话标题栏的人设选择器；隐藏不会更改已有的会话选择 |
| `memory.inject` | `true` | 将记忆段落注入提示词 |
| `memory.layered` | `false` | 启用 core + topics 分层 |
| `memory.recall` | `off` | 可设为 `keyword`，从插件运行期间的第二条用户消息起提示相关主题 |
| `memory.indexMode` | `all` | 在关键词召回开启时可设为 `recall`，避免每轮注入完整主题索引 |
| `memory.compactionRecall` | `false` | 成功压缩或裁剪后，在下一用户回合提示近期使用过的主题摘要 |
| `memory.injectMaxChars` | `8000` | 记忆注入的字符预算 |
| `allowTemplates` | `false` | 是否解析人设与记忆中的提示词变量；默认保留花括号原文 |
| `skipSubagents` | `false` | 是否跳过对子代理的人设和记忆注入 |

关键词检索是字面匹配，并非语义向量搜索；召回提示只包含主题 key 与摘要，全文仍需通过工具读取，且受注入预算限制。`topic: "core"` 或 `"core.md"` 指向常驻 core；已有 `topics/core.md` 不会自动迁移，请先备份并核对后再手动整理。

人设配置保存在当前 Profile；记忆默认位于 `$DSH_HOME/soul-md/memory/`。请按个人需要备份和管理这些文件。界面语言跟随 DSH。

## 开发与反馈

- `npm test` 运行项目测试。[历史详细文档](https://github.com/Scorp1o117/dsh-soul-md/blob/c248af33a8b3215b771ed52c1e2395a56a717908/README.zh.md)保留旧版配置和迁移说明，其中安装命令与兼容性信息可能已过时。
- [npm](https://www.npmjs.com/package/dsh-soul-md) · [问题反馈](https://github.com/Scorp1o117/dsh-soul-md/issues) · [MIT License](LICENSE)
