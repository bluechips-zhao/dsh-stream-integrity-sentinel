# 测试计划

## 1. 原则

- 测试健康放行与违规阻断，两者缺一不可。
- 每条失败测试必须证明“工具未执行”，不能只断言出现错误文本。
- mock 只证明局部逻辑；真实 DSH runtime、fresh profile、Web/headless 是独立门禁。
- 所有语料默认使用合成内容，不提交真实提示词、凭据或工具参数。

## 2. 测试层级

| 层级 | 目标 | 所需环境 |
| --- | --- | --- |
| L1 纯单元 | validator、buffer、诊断、配置 | Node test runner |
| L2 属性/模糊 | 顺序、状态机、上限、任意分片 | fast-check 或等价工具 |
| L3 Runtime 集成 | 真实 `LlmRuntime` waterfall、adapter normalization | 目标 DSH 源码/包 |
| L4 Agent Loop 集成 | attempt 持久化、request-error、零工具执行 | 真实 Agent Loop + 合成 adapter/tool |
| L5 Bundle | manifest、patch、包内容、安装/卸载 | 打包产物 + fresh profile |
| L6 宿主 E2E | Web/headless、取消、正常和故障网关 | 隔离 DSH home |

## 3. 核心测试目录

### 3.1 健康与范围

| 测试 ID | 场景 | 预期 |
| --- | --- | --- |
| TP-001 | 无 tools 调用 | 返回原 iterable；无分析状态 |
| TP-002 | provider/model 被 exclude | 原样 passthrough |
| TP-003 | 纯文本 + stop | chunk 引用、值、顺序完全相同 |
| TP-004 | reasoning/text 交错后 stop | 实时前缀无额外异步等待 |
| TP-005 | 单个健康工具块 + tool-calls finish | 首工具前实时；尾部在 iterator done 后原序 flush |
| TP-006 | 多个交错工具块、唯一 ID | 完整放行，顺序不变 |
| TP-007 | delta-only 工具协议 | 隐式打开并健康放行 |
| TP-008 | end-only 工具协议 | 验证 final block 后健康放行 |
| TP-009 | name 只在首个 delta，后续省略/空 | name 不被视为改变，最终块一致则通过 |
| TP-010 | 合法 JSON 标量/数组/object | 均通过语法验证 |

### 3.2 结构与生命周期违规

| 测试 ID | 场景 | 规则 |
| --- | --- | --- |
| TP-011 | null/array chunk | `SIS_CHUNK_SHAPE` |
| TP-012 | 负数、NaN、小数、超安全整数 index | `SIS_INDEX_INVALID` |
| TP-013 | 同 index text 后 tool | `SIS_BLOCK_TYPE_CONFLICT` |
| TP-014 | 重复 block-start | `SIS_BLOCK_START_DUPLICATE` |
| TP-015 | 重复 block-end | `SIS_BLOCK_END_DUPLICATE` |
| TP-016 | 关闭后 delta | `SIS_STRAGGLER` |
| TP-017 | finish 后 chunk | `SIS_AFTER_FINISH`，尾部不放行 |
| TP-018 | iterator done 无 finish | `SIS_FINISH_MISSING` |
| TP-019 | 两个 finish | `SIS_FINISH_DUPLICATE` |
| TP-020 | usage 在 finish 后/重复 usage | 相应终止或 usage 规则 |

### 3.3 工具身份与参数违规

| 测试 ID | 场景 | 规则 |
| --- | --- | --- |
| TP-021 | 首/续 delta 空或空白 ID | `SIS_TOOL_ID_EMPTY` |
| TP-022 | 同 index ID 从 A 变 B | `SIS_TOOL_ID_CHANGED` |
| TP-023 | 两个 index 共用 ID | `SIS_TOOL_ID_DUPLICATE` |
| TP-024 | 完成时没有非空 name | `SIS_TOOL_NAME_MISSING` |
| TP-025 | name 从 toolA 变 toolB | `SIS_TOOL_NAME_CHANGED` |
| TP-026 | arguments 是截断 JSON | `SIS_ARGUMENTS_INVALID_JSON` |
| TP-027 | block-end ID/name/args 任一不一致 | `SIS_BLOCK_END_MISMATCH` |
| TP-028 | tool block + stop finish | `SIS_FINISH_TOOL_MISMATCH` |
| TP-029 | tool-calls finish 无工具块 | `SIS_FINISH_TOOL_MISMATCH` |
| TP-030 | end-only final tool block 字段非法 | 对应身份/JSON规则 |

### 3.4 replay、资源、取消与异常

| 测试 ID | 场景 | 预期 |
| --- | --- | --- |
| TP-031 | 隔离尾以 max-tokens/error/aborted 结束，含/不含 replayState | 尾部不放行；仅保留不带 replayState 的同类终止；工具执行 0 |
| TP-032 | replayState.blocks 数量不对齐 | `SIS_REPLAY_STATE_INVALID` |
| TP-033 | maxQuarantineBytes + 1 | `SIS_LIMIT_EXCEEDED`，不 flush |
| TP-034 | maxChunksPerCall + 1 | enforce fail-closed |
| TP-035 | maxBlocksPerCall + 1 | enforce fail-closed |
| TP-036 | maxArgumentsBytesPerTool + 1 | enforce fail-closed |
| TP-037 | quarantine 中 abort | 不 flush；调用 iterator.return；保留取消语义 |
| TP-038 | finish/abort 同 tick，或 `iterator.next()` 挂起期间 cancel | abort 优先，工具调用为 0，并执行 best-effort cleanup |
| TP-039 | iterator.return throw | 不放行工具尾；根因规则不被覆盖 |
| TP-040 | validator 内部异常注入 | 单一 `STREAM_INTEGRITY_INTERNAL` finish |

其中 TP-031 还必须覆盖无其他违规的非成功工具尾：隔离尾全部不放行，仅保留不带 replayState 的原 error/aborted 终止；另用 max-tokens fixture 证明 kind 保留且工具执行为 0。若终止前已有违规，除 abort 外首个违规保持权威。

### 3.5 模式、隐私与重试

| 测试 ID | 场景 | 预期 |
| --- | --- | --- |
| TP-041 | observe 下每类违规 | 原值原序 passthrough；只有脱敏诊断 |
| TP-042 | observe 达分析上限 | 停止分析、继续放行、记录 truncated |
| TP-043 | arguments/text/reasoning 中放 canary secret | 所有 plugin 日志和 error 中不存在 canary |
| TP-044 | normal retry 默认策略 | sentinel 错误不重试 |
| TP-045 | provider always retry | 明确复现重复行为并验证启动警告，不声称已阻止 |
| TP-046 | 多并发模型流 | 状态不串线，无共享 call ID 冲突 |

### 3.6 DSH 集成与安装

| 测试 ID | 场景 | 预期 |
| --- | --- | --- |
| TP-047 | 真实 `LlmRuntime` + 健康 adapter | listener 调用一次，输出一致 |
| TP-048 | 真实 `LlmRuntime` + 故障 adapter | error attempt；无 middleware throw |
| TP-049 | 真实 Agent Loop + spy tool | 健康调用执行一次；违规调用执行 0 次 |
| TP-050 | 内层故障注入 listener | sentinel 捕获，证明预期监听器顺序 |
| TP-051 | 外层故障注入 listener | 明确展示边界；配置必须阻止/检测该顺序或停止发布 |
| TP-052 | fresh profile `dsh --profile ... --dump-config` | 唯一条目、无重复 ID、组合成功 |
| TP-053 | fresh profile 安装、Web 启动 | 受保护监听器真实装载，Web listener 健康 |
| TP-054 | fresh profile headless 健康/违规 | 退出码、错误和零工具执行符合契约 |
| TP-055 | 卸载 bundle 并重启 | profile 恢复，不残留条目或依赖 |
| TP-056 | 打包内容审计 | 仅所需源码/产物/patch/docs，无密钥与 fixture dump |

> 证据归属：TP-052～TP-055 是 fresh profile、Web/headless 和卸载恢复门禁，权威证据记录在隔离命令输出、`docs/UPSTREAM-BASELINE.md` 与 `docs/ACCEPTANCE-CRITERIA.md`，本机协作记录不随公开仓库发布，不要求伪装成 Vitest 测试标题；TP-056 由 `pnpm pack --dry-run --json` 和包内容静态审计证明。单元/集成测试标题中的 TP/P 标签只覆盖适合代码级直接断言的场景。

## 4. 属性测试

- **P-001 顺序保持**：对任意健康流，输出序列与输入序列逐项深相等。
- **P-002 单终止**：enforce 任意输入最多向下游发出一个 finish。
- **P-003 零泄漏**：一旦进入 quarantine，若最终拒绝，则从触发点起输入 chunk 均不出现在输出。
- **P-004 确定性**：同配置、同 chunk 序列产生同决策、规则和输出。
- **P-005 分片不变性**：对语义相同且身份字段合法的 arguments 任意字符串分片，最终结论相同。
- **P-006 有界性**：任何输入在达到配置上限后停止增长并终止分析。
- **P-007 首因锁存**：后续错误不能改变第一次违规 rule/index。

## 5. 测试夹具

每个 fixture 包含：

```ts
interface StreamFixture {
  id: string
  input: unknown[]
  mode: 'enforce' | 'observe'
  expectedRule?: string
  expectedOutput: 'same' | 'error-finish' | 'passthrough'
  expectedToolExecutions: number
}
```

禁止从真实会话直接复制带内容的流。社区问题只用于抽象形状，fixture 使用 `call_A`、`tool_a`、`{"x":1}` 等合成数据。

## 6. 性能测试

- 纯文本 100k chunks（虽然不隔离）测额外 CPU；
- 首 chunk 即工具调用、隔离至上限，测峰值 RSS；
- 256 个交错工具块；
- 1 MiB UTF-8 多字节参数，验证字节计数；
- 100 并发受保护流，验证无全局锁与状态串线。

性能目标在实现基准前不写绝对数字。发布时必须给出硬件、Node、DSH commit、fixture 和 p50/p95。

### 当前本地基线（非发布门槛）

在 Windows 主机 `13th Gen Intel(R) Core(TM) i9-13900H`、Node `v22.23.1`、pnpm `11.21.0`、目标 DSH commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` 上各运行 10 轮：100k 纯文本为 p50/p95 `32/44 ms`，256 个交错工具块为 `3/4 ms`，100 并发流为 `31/44 ms`；64KiB quarantine 上限每轮只输出一个拒绝终止，峰值 RSS 增量基线约 `0.14 MiB`；约 1MiB UTF-8 多字节工具参数通过字节计数，p50/p95 `5/7 ms`。这些数字仅是当前机器的可复核基线，不构成跨硬件绝对性能承诺。

## 7. 真实宿主证据要求

每次验收保存：命令、时间、DSH commit/tag、Node/pnpm、profile 路径、退出码、端口/health 证据、测试工具执行计数和卸载后结果。敏感路径可脱敏，但不能只贴“测试通过”文字。
