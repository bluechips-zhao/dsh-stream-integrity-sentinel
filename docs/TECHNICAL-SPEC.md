# 技术规范

## 1. 规范状态

- 版本：Design v0.1
- 实现状态：D4 隔离宿主夹具验收中；源码、L1/L2/L3、Agent Loop、bundle、隔离 Web/headless 证据已部分完成，真实供应商与完整宿主业务流仍待验证
- 上游锚点：`fb2c4b9e698e30edb738bca4cf0618587db7d203`（`dsh-v0.1.5-rc.2`）
- 规范关键词：`必须`、`不得`、`应该`、`可以` 按强制程度解释。

## 2. 外部契约

目标监听器签名：

```ts
'llm/stream'(
  this: LlmRuntime,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk>
```

实现必须把 `options` 当只读值。`next()` 不接受替换参数，并且每次调用只能执行一次。

## 3. 配置契约

计划配置：

```ts
interface SentinelConfig {
  mode?: 'enforce' | 'observe'            // default: enforce
  scope?: 'tool-capable-calls'             // v1 only value
  includeProviders?: string[]
  excludeProviders?: string[]
  includeModels?: string[]
  excludeModels?: string[]
  maxQuarantineBytes?: number              // default: 4 MiB; range: 64 KiB..64 MiB
  maxChunksPerCall?: number                // default: 50_000; range: 100..1_000_000
  maxBlocksPerCall?: number                // default: 256; range: 1..4096
  maxArgumentsBytesPerTool?: number        // default: 1 MiB; range: 1 KiB..16 MiB
  diagnostics?: 'errors' | 'all' | 'off'  // default: errors
}
```

规则：

- 未知字段必须导致配置加载失败。
- include 先筛选，exclude 后否决；同一值同时出现时 exclude 优先。
- provider/model 使用完全字符串匹配，不使用正则或 glob。
- 数值必须为安全整数并在范围内。
- v1 不支持运行中热改；每次 plugin mount 固定一份冻结配置。

## 4. 功能需求

| ID | 需求 |
| --- | --- |
| FR-001 | 默认仅保护 `options.tools?.length > 0` 且通过 include/exclude 的调用。 |
| FR-002 | 对受保护调用，`next()` 必须调用且只能调用一次；非受保护调用返回原 iterable。 |
| FR-003 | 首个工具相关 chunk 之前的健康非工具前缀应实时、原值、原序放行。 |
| FR-004 | 从首个工具相关 chunk 起，所有后续 chunk 必须进入有界流尾隔离，直到上游 iterator 返回 `done`。 |
| FR-005 | 健康成功流必须在验证结束后按原值、原序放行完整隔离流尾。 |
| FR-006 | 所有 chunk 必须通过运行时结构校验，不能只依赖 TypeScript 类型。 |
| FR-007 | 必须校验 index、块类型一致性、开始/关闭和 straggler 生命周期。 |
| FR-008 | 每个工具调用 ID 必须非空、稳定，并在一次响应内唯一。 |
| FR-009 | 工具名称在成功关闭时必须非空；多个非空名称必须相同。 |
| FR-010 | 完整工具参数必须可被 `JSON.parse`；插件不执行 schema 语义校验。 |
| FR-011 | `block-end` 的工具块必须与 delta 累积的 ID、name、arguments 完全一致。 |
| FR-012 | 流必须恰有一个 finish，usage 先于 finish，finish 后不得有 chunk，之后 iterator 必须结束。 |
| FR-013 | enforce 违规时不得放行隔离尾，必须输出一个脱敏 `STREAM_INTEGRITY_VIOLATION` error finish。 |
| FR-014 | observe 模式必须原值原序放行，只产生脱敏诊断，不得声称阻断。 |
| FR-015 | abort 必须优先于完整性错误；提前停止必须 best-effort 调用 iterator cleanup。 |
| FR-016 | 诊断不得含 messages、text、reasoning、arguments、replayState 或凭据。 |
| FR-017 | chunk、block、单工具参数和隔离字节达到上限时，enforce 必须失败关闭。 |
| FR-018 | replayState 只能出现在成功 finish；若 `blocks` 存在，其长度必须与首见 block 顺序一致。 |
| FR-019 | 未知非工具 block 类型可作为不透明块验证生命周期；未知 chunk 类型在 enforce 下拒绝。 |
| FR-020 | v1 不得修复、补全、重编号、删除单个字段后继续执行或改写工具调用。 |

## 5. 非功能需求

| ID | 需求 |
| --- | --- |
| NFR-001 | 首个工具 chunk 前，额外路径不得进行异步 I/O。 |
| NFR-002 | 每调用状态是 O(blocks + quarantined bytes)，并受显式上限约束。 |
| NFR-003 | 兼容性按 DSH commit/tag 声明，不使用宽泛“支持最新版”。 |
| NFR-004 | 无网络遥测；日志隐私必须由测试验证。 |
| NFR-005 | 作为独立 bundle 安装，不替换官方同 ID 配置行。 |
| NFR-006 | 核心验证器可脱离 DSH 做确定性、属性和模糊测试。 |
| NFR-007 | 健康路径 chunk 对象引用可原样传递；不得 clone 内容。 |
| NFR-008 | 插件卸载后不留下 listener、timer、iterator 或全局状态。 |

## 6. 运行时 chunk 校验

### 6.1 通用字段

- chunk 必须是非 null object；
- `type` 必须是非空 string 且属于已知 chunk type；
- 带 index 的 chunk，其 index 必须是 `Number.isSafeInteger(index) && index >= 0`；
- text/reasoning/argumentsDelta 必须是 string；允许空 delta，但仍计入 chunk 上限；
- usage 数值必须是非负有限安全整数；可选字段同样校验。

### 6.2 隐式与显式打开

为了兼容 DSH 明示支持的 delta-only 协议：

- 某 index 首次出现 delta 时可以隐式打开对应类型；
- 某 index 首次出现 `block-end` 时可以作为 end-only 块；
- 后续显式 `block-start` 不能为已隐式打开的 index 补开，视为重复开始；
- 同一 index 任何不同类型使用都拒绝。

### 6.3 工具身份

- 每个 `tool-call-delta.id` 必须是 trim 后非空 string；
- 同一 index 上所有 ID 必须完全相等；
- 不同 index 不得使用相同 ID；此唯一性只覆盖一次模型响应，不覆盖跨 turn 复用；
- `name` 缺失或空字符串表示本 delta 未提供身份更新；
- 非空 name 一旦建立，后续非空 name 必须完全相等；
- 成功关闭/终止前必须已经建立非空 name。

### 6.4 工具参数

- `argumentsDelta` 按到达顺序拼接；
- 字节上限按 UTF-8 字节数计，不按 UTF-16 code unit；
- 成功 finish 前对完整字符串调用一次 `JSON.parse`；
- 只验证 JSON 语法，不要求根节点是 object，不执行工具 schema；
- 解析结果不得被保存或记录。

### 6.5 `block-end`

- `block-end.block` 必须为带非空 `type` 的 object；
- block.type 必须匹配该 index 的既有类型；
- 重复 `block-end` 一律拒绝；
- 关闭后任何 delta 一律拒绝；
- 对 tool-call，end-only 情况直接验证最终 id/name/arguments；有 delta 时三字段必须与累积值严格相等。

### 6.6 终止

- `usage` 至多出现一次，且必须在 finish 前；
- `finish` 必须恰好一次；
- 收到 finish 后 sentinel 继续请求一次 iterator：只有 `done: true` 才算健康；任何后续 chunk 都拒绝；
- iterator 无 finish 结束，规则为 `SIS_FINISH_MISSING`；
- 存在工具块时，成功 finish 必须为 `tool-calls`；`tool-calls` finish 必须至少有一个完整工具块；
- 工具隔离期间遇到 `max-tokens`、`error` 或 `aborted` 不构成可执行健康工具流，不得 flush 工具尾；确认 iterator done 后只放行一个不带 replayState 的对应终止 chunk，其中 error/aborted 的 failure 原样保留，max-tokens 的 kind 原样保留。
- 若在非成功 finish 前已锁存完整性违规，除用户取消外首次违规保持权威并输出 sentinel error finish。

## 7. 规则目录

| 规则 ID | 含义 |
| --- | --- |
| `SIS_CHUNK_SHAPE` | chunk 或字段运行时形状非法 |
| `SIS_INDEX_INVALID` | index 非法 |
| `SIS_BLOCK_TYPE_CONFLICT` | 同一 index 类型冲突 |
| `SIS_BLOCK_START_DUPLICATE` | 重复开始 |
| `SIS_BLOCK_END_DUPLICATE` | 重复关闭 |
| `SIS_BLOCK_END_MISMATCH` | 权威 block-end 与累积值不一致 |
| `SIS_STRAGGLER` | 关闭后仍有 delta |
| `SIS_TOOL_ID_EMPTY` | 工具 delta/final ID 为空 |
| `SIS_TOOL_ID_CHANGED` | 同 index ID 改变 |
| `SIS_TOOL_ID_DUPLICATE` | 不同 index 复用同 ID |
| `SIS_TOOL_NAME_MISSING` | 完成时仍无名称 |
| `SIS_TOOL_NAME_CHANGED` | 非空名称发生变化 |
| `SIS_ARGUMENTS_INVALID_JSON` | 最终参数不是合法 JSON |
| `SIS_USAGE_DUPLICATE` | 多个 usage |
| `SIS_FINISH_DUPLICATE` | 多个 finish |
| `SIS_AFTER_FINISH` | finish 后仍有 chunk |
| `SIS_FINISH_MISSING` | iterator 完成但无 finish |
| `SIS_FINISH_TOOL_MISMATCH` | 工具块与 finish kind 不匹配 |
| `SIS_REPLAY_STATE_INVALID` | replayState 与成功块不对齐 |
| `SIS_LIMIT_EXCEEDED` | 任一资源上限超出 |
| `SIS_UNKNOWN_CHUNK` | 未知 chunk type |

## 8. 错误与重试

公开错误码：

- `STREAM_INTEGRITY_VIOLATION`：输入流违反规则；默认 DSH normal retry 不包含该码。
- `STREAM_INTEGRITY_INTERNAL`：sentinel 自身失败；同样不得默认自动重试。

错误消息模板长度最多 256 字符，只含 code、rule、provider、model、index、计数值。provider/model 也应限制长度并清理控制字符。

若 provider 的 retry policy 是 `always`，Agent Loop 可能仍无限重试所有失败。实现必须在启动诊断和文档中警告；插件不得擅自修改 provider retry policy。

## 9. `observe` 语义

observe 必须维护同样的状态和规则，但：

- 不进入隔离导致的延迟；所有 chunk 立即原样 yield；
- 违规只记录首次根因与汇总计数；多个违规时，汇总使用受限诊断字段 `rule`、`index`、`count`，并以 `detail=observed-count` 标识，不记录正文；
- 不能保证违规 chunk 未被持久化或执行；
- 资源上限后停止深入分析但继续 passthrough，并记录 `analysis-truncated`。

## 10. 版本与兼容

初始实现只可声明对 DSH `0.1.5-rc.2`、锚点 commit 的验证。若在其他 commit 运行，只能给出“未验证”诊断，除非兼容矩阵有对应真实宿主证据。
