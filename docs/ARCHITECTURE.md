# 架构设计

## 1. 架构摘要

插件在 DSH 的 `llm/stream` waterfall 上包裹适配器返回的 `AsyncIterable<StreamChunk>`。它不修改冻结请求，只验证输出。为了同时保留早期文本的实时性和工具调用的原始顺序，采用“首次工具相关 chunk 触发流尾隔离”的策略。

```text
GenerateOptions (read-only)
        |
        v
llm/stream waterfall listener
        |
        +--> no tools / excluded route --> exact passthrough
        |
        v
adapter normalized StreamChunk
        |
        v
prefix validator ---- safe non-tool prefix ----> Agent Loop live stream
        |
 first tool-related chunk
        v
tail quarantine (all following chunks, original order)
        |
        +--> valid terminal stream --> flush exact tail --> Agent Loop --> session --> tools
        |
        +--> violation/limit --> discard tail --> synthetic error finish --> no tool execution
```

## 2. 信任边界

### 2.1 插件信任

- DSH 在目标 commit 上公开的 `llm/stream`、`StreamChunk` 和 Agent Loop 契约；
- JavaScript 运行时对值类型、顺序和 iterator 协议的行为；
- 插件自己的纯验证状态机通过测试后满足规范。

### 2.2 插件不信任

- 供应商、网关或第三方适配器输出的 chunk 值；
- runtime TypeScript 类型已被远端数据遵守；
- call ID、name、index、JSON 参数、finish reason；
- 其他插件不会产生或改写异常流；
- profile 中实际监听器顺序与设计假设一致。

### 2.3 不可见边界

插件位于适配器之后，因此看不到供应商原始 SSE/HTTP 帧。如果适配器先把两个原始调用合并成一个内部自洽的 `StreamChunk` 序列，通用 sentinel 无证据恢复原始意图。这一限制不得通过营销语言弱化。

## 3. 组件

### 3.1 `plugin.ts`

- 解析并冻结配置；
- 注册 `llm/stream` listener；
- 决定调用是否在范围内；
- 保证 lifecycle 卸载时移除 effect。

### 3.2 `guard-stream.ts`

- 拥有上游 iterator；
- 驱动状态机；
- 管理 prefix passthrough、tail quarantine、flush、reject 和 cleanup；
- 捕获插件内部异常，转换为稳定失败；
- 在提前结束时 best-effort 调用 `iterator.return()`。

### 3.3 `validator.ts`

纯函数/纯状态对象，不依赖 Cordis。接收一个 chunk，返回：

- `continue`；
- `enter-quarantine`；
- `valid-terminal`；
- `violation`，包含规则 ID、index 和非敏感元数据。

### 3.4 `tool-block.ts`

按 index 维护工具块状态：开始类型、首个非空 ID/name、arguments 字符串/字节数、关闭状态和最终 block 摘要。

### 3.5 `diagnostics.ts`

产生稳定、脱敏、长度受限的日志和错误消息。它永远不接收或记录完整 messages、arguments、reasoning、text 或 replayState。

### 3.6 `config.ts`

定义 Cordis schema 和运行时归一化。未知字段失败；所有数值是整数且有上下界。

## 4. 状态机

| 状态 | 含义 | 允许转换 |
| --- | --- | --- |
| `PASSING` | 尚未出现工具相关 chunk；健康 chunk 实时放行 | `PASSING`、`QUARANTINED`、`DONE`、`REJECTED` |
| `QUARANTINED` | 已出现工具相关 chunk；整个后续流尾只缓存不下发 | `QUARANTINED`、`RELEASING`、`REJECTED` |
| `RELEASING` | 已在 finish 时完成所有验证，按原顺序 flush | `DONE` |
| `REJECTED` | 首次违规已锁存，丢弃尾部并发出一次错误 finish | `DONE` |
| `DONE` | 终态 | 无 |

“工具相关 chunk”包括 tool-call `block-start`、`tool-call-delta`，以及 `block-end.block.type === 'tool-call'`。delta-only 和 end-only 协议均会触发隔离。

## 5. 为什么隔离整个流尾

只缓存 tool-call chunk 会改变它与后续文本、reasoning、usage、block-end 的全局顺序；在关闭时提前放行又无法阻止后续 straggler 或重复 finish。完整缓存首次工具片段之后的所有 chunk，才能同时满足：

- 违规工具片段不进入下游的 durable stream；
- 健康流下发顺序完全一致；
- 终止时才能验证无 straggler、唯一 finish、JSON 完整性和 replayState 对齐条件；
- 早于首个工具片段的文本/推理仍实时展示。

代价是工具调用开始后的可见延迟与有界内存开销，这是明确产品取舍。

## 6. 正常路径

1. listener 读取 `options`，不做任何修改。
2. 若不在范围，直接返回 `next()`。
3. 若在范围，获取一次且仅一次 `next()` 返回的 iterable。
4. 在 `PASSING` 中验证并立即 yield 非工具 chunk。
5. 首个工具相关 chunk 使状态进入 `QUARANTINED`；从该 chunk 起全部复制到有界队列。
6. 每个 chunk 同时进入验证器。
7. 收到唯一健康 finish 后完成全流校验。
8. 按原顺序 yield 缓冲队列，包括原 finish；随后结束。
9. 正常迭代完成后释放所有状态引用。

## 7. 违规路径

1. 首次违规被锁存；后续违规只计数，不覆盖根因。
2. 不 yield 隔离队列中的任何 chunk。
3. best-effort 关闭上游 iterator；cleanup 失败只作为受限 cause 计入诊断，不替换首个规则。
4. yield 恰好一个合成 chunk：

```ts
{
  type: 'finish',
  reason: {
    kind: 'error',
    failure: {
      code: 'STREAM_INTEGRITY_VIOLATION',
      message: 'normalized model stream rejected (rule=SIS_..., index=...)'
    }
  }
}
```

5. 不带 `replayState`、provider retry-after 或原始内容。
6. Agent Loop 应把它保存为 `assistant/attempt` 并走 `agent/request-error`；默认 normal retry 列表不包含该错误码，因此默认不重试。

## 8. 取消路径

- 在 `PASSING` 期间，保持 DSH 原取消语义。
- 在 `QUARANTINED` 期间收到 `options.signal.aborted`，不 flush 缓冲尾部；调用 iterator cleanup，并让宿主的 aborted 流/取消信号成为权威。
- 插件不得把用户取消伪装为完整性违规。
- 取消竞态（finish 与 abort 同一 tick）必须用确定性测试固定：在观察到 finish 并完成验证前，abort 优先。

### 8.1 隔离期间的非成功终止

如果隔离尾本身尚未触发完整性违规，但收到 `max-tokens`、`error` 或 `aborted` finish：

- 不 flush 隔离尾中的任何 chunk，避免不完整工具调用进入下游；
- 在确认 iterator 随后 `done` 后，只 yield 一个终止 chunk；
- `error`/`aborted` 原样保留其 `reason.failure`，但移除任何不应存在的 `replayState`；
- `max-tokens` 保留 `{ kind: 'max-tokens' }`，移除 `replayState`；
- 这属于“非成功工具尾抑制”，不是自动修复，也不改写为成功或完整性违规；
- 首次工具片段之前已放行的安全文本/推理前缀仍保留。

如果在非成功 finish 之前已经锁存完整性违规，则用户取消仍最高优先；否则首次完整性违规保持权威并输出 sentinel error finish。

## 9. 监听器顺序

安全承诺要求 sentinel 看到最终进入 Agent Loop 的流。如果另一个外层 listener 在 sentinel 放行后再改写 chunk，保护可以被绕过。D1 必须用官方源码和真实 profile 证明实际顺序，并用“内层故障注入器”与“外层故障注入器”测试边界。若普通 bundle 无法稳定取得所需顺序，项目停止，不以文档假设替代证据。

## 10. 故障隔离

- 上游适配器 throw：`LlmRuntime` 应先规范化为 error/aborted finish，sentinel 验证并传递；
- sentinel 逻辑异常：在未取消时转换为 `STREAM_INTEGRITY_INTERNAL` error finish，不能作为普通 middleware throw 逃逸；
- 资源超限：按完整性拒绝处理，规则为 `SIS_LIMIT_EXCEEDED`；
- 日志失败：不得改变放行/阻断结论；
- cleanup 失败：不得导致工具尾被放行。

## 11. 计划目录

```text
dsh-stream-integrity-sentinel/
├── package.json
├── cordis.patch.yml
├── src/
│   ├── index.ts
│   ├── plugin.ts
│   ├── config.ts
│   ├── guard-stream.ts
│   ├── validator.ts
│   ├── tool-block.ts
│   └── diagnostics.ts
├── test/
│   ├── fixtures/
│   ├── validator.test.ts
│   ├── guard-stream.test.ts
│   ├── runtime.integration.test.ts
│   └── agent-loop.integration.test.ts
└── docs/
```

该目录是实现蓝图，不表示文件已经存在。
