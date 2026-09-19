# 上游基线

## 1. 当前基线摘要

- 检查日期：2026-09-15
- 官方仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 目标 tag：`dsh-v0.1.5-rc.2`
- 目标 commit：`fb2c4b9e698e30edb738bca4cf0618587db7d203`
- 官方 master（非目标基线）：`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`
- 根版本：`0.1.5-rc.2`
- Node engines：`^22.19.0 || >=24.0.0`
- pnpm：`11.7.0`
- 状态：当前实现兼容性基线；必须结合本文件的逐项证据和验收矩阵阅读，不等于对其他 commit 或真实供应商的兼容性证明。

## 2. 已核对的官方文件

| 文件 | 关键事实 |
| --- | --- |
| [`packages/llm/llm/src/types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/llm/llm/src/types.ts) | `StreamChunk` 联合类型；index 关联块；usage 在 terminal finish 前；finish 后无 chunk；tool arguments 是 raw JSON string |
| [`packages/llm/llm/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/llm/llm/src/index.ts) | `llm/stream` waterfall；adapter 异常被规范化，middleware/consumer 异常继续抛出；请求可能 deep-frozen |
| [`packages/llm/llm/src/assembler.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/llm/llm/src/assembler.ts) | 官方唯一汇编器；兼容 delta-only；关闭后忽略 straggler；block-end 权威；tool delta 的 id 无条件覆盖、name 仅 truthy 覆盖 |
| [`packages/core/agent-loop/src/agent.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/core/agent-loop/src/agent.ts) | stream chunk 进入 `AssistantStreamAttempt`；error/aborted settle 为 `assistant/attempt` 并走 `agent/request-error`；成功消息后才执行 tool calls |
| [`packages/core/agent-loop/src/assistant-stream.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/core/agent-loop/src/assistant-stream.ts) | 每个下游 chunk 同时进入 accumulator、BlockAssembler 和 live frame；最终 compact stream 随 attempt/message 持久化 |
| [`packages/llm/llm/src/retry-policy.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/llm/llm/src/retry-policy.ts) | normal 默认只重试 EMPTY_RESPONSE、RATE_LIMIT、SERVER、TIMEOUT、TRANSPORT；always 会重试所有失败 |
| [`packages/llm/llm-deepseek/src/translate.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/llm/llm-deepseek/src/translate.ts) | 当前 translator 用 `acceptIdentity` 忽略空/null continuation，并逐 delta 产出规范化 tool chunks；block-end/usage/finish 推迟到 DONE |
| [`docs/subsystems/llm-streaming.md`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/docs/subsystems/llm-streaming.md) | 官方 surface 文档；loop 请求 deep-frozen；listener 可 `next()` 或 short-circuit |
| [`docs/user/develop/basic/publish.md`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/docs/user/develop/basic/publish.md) | bundle 与 profile 分离；package 用 `dsh.bundle.patch`；插件 row 由 `cordis.patch.yml` 插入 |
| [`SAFETY.md`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/SAFETY.md) | DSH 是未审计的 experimental developer preview；sandbox/approval/permissions 不保证隔离，不可作为唯一安全控制 |
| [`CONTRIBUTING.md`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/CONTRIBUTING.md) | 当前不接受外部 PR；官方鼓励独立插件生态并使用 `dsh-plugin` topic |
| [`package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/package.json) | 根版本、Node 和 pnpm 约束 |

## 3. 关键结论

### UB-C01 — seam 存在

`llm/stream(options, next)` 是公开 waterfall，能包裹每个 streaming model call。listener 可以消费 `next()` 的 iterable 并 yield 自己的 chunk。

### UB-C02 — 请求是只读的

loop-built 请求 deep-frozen，`next` 签名不接受替换参数。sentinel 只能审查输出，不能把它设计成请求历史修复器。

### UB-C03 — 下游只见放行内容

Agent Loop 对 listener 产出的 chunk 调用 `AssistantStreamAttempt.push()`；随后才累积、展示和最终执行。这支持在正确监听器顺序下阻止隔离尾进入 durable stream 和工具执行。

### UB-C04 — middleware throw 不是 adapter failure

官方明确说 middleware failure 继续抛出。因此 sentinel 自身不能简单 throw 违规，需合成 error finish 并做宿主测试。

### UB-C05 — current assembler 是宽容消费者

它允许 delta-only、忽略 straggler、接受权威 block-end，并在某些缺失字段上回退。sentinel 的严格规则是额外策略，不应冒充上游既有契约的全部强制要求。

### UB-C06 — 可见的是规范化流

`StreamChunk` 被官方称为 adapter emitted raw streaming protocol，但相对于供应商网络报文，它已经经过 adapter 翻译。sentinel 无法通用观察翻译之前的 wire frame。

### UB-C07 — 当前 DeepSeek 身份覆盖缺陷已部分修复

master 的 `acceptIdentity()` 只接受非空字符串，因此旧社区报告中的 null/empty continuation 覆盖问题不能作为“当前官方适配器仍未修复”的宣传。剩余防护价值包括第三方适配器、最终缺名、身份变化、重复 ID、块/终止语法和资源限制。

## 4. D1 已完成与剩余探针

以下 D1 项已完成并有 `UB-20260915-002` 与 `COL-20260915-004` 证据：

- `llm/stream` 多 listener 的精确包裹顺序、`prepend` 外层边界与隔离 bundle 插入；
- `ctx.on()` disposer 的 listener 卸载；
- 发布 `@deepseek-ai/dsh-llm@0.1.5-rc.2` / Cordis 导出可用于合成 runtime probe；
- adapter failure 的规范化 error finish。

以下仍是 D3/D4 剩余项：

- 配置 schema/logger 在完整 loader profile 中的实际装载行为；
- 合成 error finish 在真实 Agent Loop 的 attempt、retry 和工具执行计数；
- abort 时 iterator.return 的宿主竞态；
- 未知 merge-extensible block type 的真实宿主行为；
- Web/headless、fresh profile 全部启停/恢复路径。

这些未完成前，不得开始对外兼容性声明。

## 5. 更新模板

```text
### UB-YYYYMMDD-NNN
- 官方 commit/tag:
- 检查时间（Asia/Shanghai / UTC）:
- 执行者:
- 变更文件:
- 契约差异:
- 影响的 FR/ADR/TP:
- 结论: CONTINUE | UPDATE-DESIGN | STOP
- 证据:
```

### UB-20260915-002

- 官方 commit/tag: `c291e7961a515f6d7af9304e7fd1d257929aef26` / `0.1.5-rc.2`
- 检查时间（Asia/Shanghai / UTC）: 2026-09-15 11:18-11:29 / 03:18-03:29
- 执行者: Codex / root
- 变更文件: 无上游文件变更；新增本项目 D1 探针前完成官方 raw 源码复核
- 契约差异:
  - 远端 `HEAD` 重新由 `git ls-remote` 确认仍为 `c291e7961a515f6d7af9304e7fd1d257929aef26`；目标版本仍为 `0.1.5-rc.2`，Node/pnpm 契约为 `^22.19.0 || >=24.0.0` / `pnpm@11.7.0`。
  - 官方 `StreamChunk` 仍包含 `block-start`、三类 delta、`block-end`、`usage`、`finish`；tool-call arguments 是 raw JSON string，`replayState` 仅挂在 finish。
  - 官方 `llm/stream` 签名仍为 `this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>`；`streamWithRegistration()` 将 adapterStream 作为最内层 continuation，adapter dispatch/iteration failure 规范化为 error/aborted finish，middleware/consumer failure 继续抛出。
  - 官方 Cordis waterfall 明确每个 listener 包裹剩余 chain；listener 外层先进入、内层先产生下游值。`prepend` 使用 `unshift`，普通注册使用 `push`；`ctx.on()` 返回 disposer，fiber unload 自动移除。
  - 官方 `BlockAssembler` 仍容忍 delta-only、忽略关闭后的 straggler、接受权威 `block-end`，并对缺失 tool id/name 使用回退；这仍与 sentinel 的严格拒绝策略形成必要差异。
  - 官方 Agent Loop 在 error/aborted finish 时 settle `assistant/attempt` 并 dispatch `agent/request-error`；只有成功 assistant message 形成后才执行 `executeToolCalls`。normal retry 默认集合不含 sentinel 新错误码；`always` 会重试所有失败。
  - 官方 bundle 文档与 base patch 仍规定 bundle 按 `dsh.bundle.patch` 提供普通插入行，profile/home/`--patch` 层随后覆盖；base patch 注释明确 row order 不承载加载语义，激活由 service availability 驱动。
- 影响的 FR/ADR/TP: FR-002/003/004/013/015/018/019；ADR-001/004/007/008/013；TP-047..TP-052
- 结论: CONTINUE（进入 D1 probe；尚未证明 fresh profile、Agent Loop 零工具执行、Web/headless 或 bundle 安装）
- 证据:
  - 官方 [`types.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/llm/llm/src/types.ts) lines 83-90, 119-127, 340-373, 361-372。
  - 官方 [`llm/src/index.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/llm/llm/src/index.ts) lines 54-68, 955-1009, 1042-1076。
  - 官方 [`cordis/src/events.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/vendor/cordis/src/events.ts) lines 21-28, 72-110, 212-243, 260-283。
  - 官方 [`assembler.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/llm/llm/src/assembler.ts) lines 23-32, 44-89, 101-138。
  - 官方 [`agent.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/core/agent-loop/src/agent.ts) lines 367-456；[`assistant-stream.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/core/agent-loop/src/assistant-stream.ts) lines 54-65。
  - 官方 [`retry-policy.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/llm/llm/src/retry-policy.ts) lines 11-22, 61-69, 78-101, 133-176。
  - 官方 [`llm/invariant.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/llm/llm/src/invariant.ts) lines 81-83 实际使用 `{ global: true, prepend: true }` 包裹 LLM stream。
  - 发布包 `@deepseek-ai/dsh-llm@0.1.5-rc.2` + `@deepseek-ai/cordis@4.0.2` 合成 adapter probe：记录到 `A:enter → B:enter → B:yield → A:yield`；`next.length === 0`、同一次调用 options 引用一致；adapter throw 输出单一 `finish.reason.kind === 'error'`；手动 disposer 后对应 listener 不再进入。
- 停止条件检查: 未发现公共 seam 缺失、next 无法调用、adapter error finish 消失或普通 bundle 必须替换同 ID 条目；外层后来注册并使用 `prepend` 的 listener 仍是 documented same-process boundary，须在 D1 probe/宿主证据中显式记录，不能宣称可防恶意同进程插件。

### UB-20260915-003

- 官方 commit/tag: `c291e7961a515f6d7af9304e7fd1d257929aef26` / `0.1.5-rc.2`
- 检查时间（Asia/Shanghai / UTC）: 2026-09-15 12:36 / 04:36
- 执行者: Codex / root
- 变更文件: 无上游文件变更；通过 `git ls-remote`、npm package metadata 和本地发布包声明复核
- 契约差异:
  - 官方 HEAD 未漂移；目标 DSH 版本仍为 `0.1.5-rc.2`，本轮 headless fixture 使用的 `LlmAdapter`、`LlmRuntime`、`agent/request` 和 Agent Loop 公共导出仍可解析。
  - D1 已证明 `llm/stream` 的 waterfall、adapter failure finish、listener disposer 和普通 bundle insert；D3/D4 已在真实发布包消费链证明 Agent Loop 在 error finish 前不执行工具。
  - 本轮未发现需要更新冻结设计的关键漂移；Web valid-token 自动请求脚本被本机进程策略拒绝，因此仅保留已取得的前台启动和无 token HTTP 401 证据。
- 影响的 FR/ADR/TP: FR-002/003/004/015/016/018/019；ADR-001/004/007/008/013/016；TP-047..TP-056
- 结论: CONTINUE（保留 `LOCALLY_TESTED`；真实供应商 provider 与完整 Web 交互仍未证明）
- 证据:
  - `git ls-remote https://github.com/deepseek-ai/deepseek-harness.git HEAD refs/tags/v0.1.5-rc.2` 返回目标 commit；`pnpm view @deepseek-ai/dsh@0.1.5-rc.2` 返回版本 `0.1.5-rc.2`。
  - 当前本地回归：`pnpm typecheck`、`pnpm typecheck:build`、`pnpm test`（4 files / 19 tests）、`pnpm build`、`pnpm pack --dry-run` 均通过。
  - 隔离 DSH headless fixture：healthy 退出码 0；violation 退出码 1、包含 `STREAM_INTEGRITY_VIOLATION` 且 `D4_SPY_EXECUTED=false`；取消 PTY 中断无 integrity message；remove 后 dump/`--help` 均通过。
- 停止条件检查: 未触发；没有修改 GenerateOptions、retry policy、DSH 源码或常用 profile，也没有读取真实凭据或执行远端发布。

### UB-20260915-004

- 官方 commit/tag: `fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`；默认分支 `master` 当前为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`
- 检查时间（Asia/Shanghai / UTC）: 2026-09-15 12:57-13:00 / 04:57-05:00
- 执行者: Codex / root
- 变更文件: 无上游文件变更；纠正本项目先前把不存在的 `v0.1.5-rc.2` 与默认分支 HEAD 当作同一引用的记录
- 契约差异:
  - 官方 tag 名称实际为 `dsh-v0.1.5-rc.2`；其目标 commit 为 `fb2c4b9e...`。目标 tag 与此前检查的 `c291e796...` 关键文件内容 SHA-256 一致：`types.ts`、`llm/index.ts`、Cordis `events.ts`、`assembler.ts`、Agent Loop `agent.ts`/`assistant-stream.ts`、`retry-policy.ts`、`invariant.ts` 均未发现差异。
  - tag 仍提供公开 `LlmAdapter.providerRetryPolicy()`、`LlmRuntime.registerAdapter()`、`llm/stream` waterfall、Agent Loop `agent/request-error` 恢复点和 `dsh-llm-retry` 的 `always` 策略；always 模式仍会对所有 model-request failure 重试，直至成功、取消或插件销毁。
  - 发布包 `@deepseek-ai/dsh@0.1.5-rc.2` metadata 未提供 `gitHead`；因此后续兼容性证据以可定位的官方 tag commit 和发布包公共 API 双重标识，不再把默认分支 HEAD 作为发布目标。
- 影响的 FR/ADR/TP: FR-002/003/004/015/016/018/019；ADR-001/004/007/008/013/016；TP-047..TP-056
- 结论: CONTINUE；官方目标 tag 契约稳定，允许继续做不接入真实供应商的 always-retry/取消边界测试；当前状态仍不得超过 `LOCALLY_TESTED`
- 证据:
  - `git ls-remote --refs` 返回 `fb2c4b9e... refs/tags/dsh-v0.1.5-rc.2`，并单独返回 `0d1f5000... refs/heads/master`。
  - 官方 tag 与此前 commit 的八个关键源码文件逐一 SHA-256 比对，全部一致；发布包版本仍为 `0.1.5-rc.2`。
  - 官方 `@deepseek-ai/dsh-llm-retry` README 与发布包代码确认 always 模式为无界 retry，normal 模式为有界 retry；该插件只在 Agent Loop durable step 边界重试，直接 `ctx.llm.stream()` 不重试。
- 停止条件检查: 未触发；没有发现公共 seam 消失、sentinel error finish 不可达、bundle 必须替换同 ID 条目或需要未公开导出；未读取真实凭据、未访问真实供应商、未修改 DSH 源码或常用 profile。

### UB-20260915-005

- 官方 commit/tag: `fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`
- 检查时间（Asia/Shanghai / UTC）：2026-09-15 13:43-13:46 / 05:43-05:46
- 执行者：Codex / root
- 变更文件：无上游文件变更；本轮仅使用隔离 fresh profile 做 Web 认证链路验证，并更新本项目证据文档
- 契约差异：官方 `dsh-client-connection` 发布包的 Web 认证契约为：启动时输出带 query token 的根 URL；根 URL 返回重定向并写入 authority-bound signed cookie；之后带 cookie 的 clean `/` 才通过认证；无 token 请求保持 401。不存在把 token 放入 Authorization header 的替代路径。
- 影响的 FR/ADR/TP：FR-015/016/018；ADR-008/016；TP-054/TP-055
- 结论：CONTINUE；Web token-cookie 交换已由隔离真实 DSH Web listener 证明，但真实供应商流、完整宿主日志与远端发布仍未完成，状态保持 `LOCALLY_TESTED`
- 证据：
  - 全新临时 DSH home/profile 使用官方 `@deepseek-ai/dsh@0.1.5-rc.2` 创建，并安装本地 sentinel bundle；测试结束后相关 pnpm/node/cmd 子进程已按精确 PID 清理，临时 profile 目录未删除。
  - 未携带 token 的 root 请求返回 `401`；捕获启动 URL 后，token root 请求在不跟随重定向的情况下返回 `303` 并设置 cookie；仅携带 cookie 请求 clean root 返回 `200`。
  - token、cookie、完整启动 URL 和供应商凭据均未输出、写入日志或保存到项目文件。
- 停止条件检查：未触发；未修改 DSH 源码、请求、retry policy 或常用 profile，未执行任何 npm/GitHub 远端发布。

### UB-20260915-006

- 官方 commit/tag：`fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`；本轮 `git ls-remote --refs` 同时确认默认 `master` 为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`
- 检查时间（Asia/Shanghai / UTC）：2026-09-15 14:58 / 06:58
- 执行者：Codex / root
- 变更文件：无上游文件变更；本轮继续在本地实现与测试 observe 诊断收敛
- 契约差异：目标 tag 未漂移；`llm/stream`、公开 adapter/runtime、Agent Loop、retry 和 bundle 公开 seam 仍与已冻结基线一致。后来注册的 outer `prepend` listener 仍属于 documented same-process boundary，不纳入 sentinel 保护承诺。
- 影响的 FR/ADR/TP：FR-014/016/017；ADR-001/005/011/013；TP-041/TP-042/TP-051
- 结论：CONTINUE；允许继续本地 observe 首因/汇总、性能和隔离宿主证据，状态仍保持 `LOCALLY_TESTED`
- 证据：`git ls-remote --refs` 返回目标 tag 与 master 分支的独立引用；本轮未发现关键契约漂移或需要更新冻结设计的停止条件。
- 停止条件检查：未触发；未修改 DSH 源码、请求、retry policy 或常用 profile，未读取真实凭据、未访问真实供应商、未执行远端发布。

### UB-20260919-007

- 官方 commit/tag：`fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`；默认 `master` 已从旧记录的 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` 漂移到 `ddefc45fbc7f8e46dd73185e68295696d1297887`
- 检查时间（Asia/Shanghai / UTC）：2026-09-19 / 2026-09-19
- 执行者：Codex / root
- 变更文件：无上游文件变更；本轮仅确认目标 tag 与默认分支引用，并继续目标 tag 上的隔离 host 验证
- 契约差异：冻结目标 tag 未漂移；master 漂移不纳入本项目兼容目标，也不替换已冻结 tag 基线。现有公共 `llm/stream`、adapter/runtime、Agent Loop、retry 与 bundle seam 仍以目标 tag 为准。
- 影响的 FR/ADR/TP：FR-002/003/004/013/015/016；ADR-001/007/008/013；TP-052..TP-056
- 结论：CONTINUE；允许在目标 tag 上重跑最新构建产物的隔离 fresh profile，状态继续保持 `LOCALLY_TESTED`
- 证据：`git ls-remote --refs` 返回目标 tag `fb2c4b9…` 与 master `ddefc45…` 两个独立引用；未发现目标 tag 契约漂移或停止条件。
- 停止条件检查：未修改 DSH 源码、请求、retry policy 或常用 profile，未读取真实凭据、未访问真实供应商、未执行远端发布。

### UB-20260919-010

- 官方 commit/tag：`fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`
- 检查时间（Asia/Shanghai / UTC）：2026-09-19 00:57-01:00 / 2026-09-18 16:57-17:00
- 执行者：Codex / root
- 变更文件：无上游文件变更；沿用 `dsh-sis-web-fresh-20260919-0052` 的官方 fresh Web profile，在隔离端口 `3202` 复核认证链路
- 契约差异：目标 tag 未漂移。token root 返回 `303`，响应包含 `Set-Cookie`；同一内存 CookieContainer 请求 clean root 返回 `200`，cookie 数量为 `1`。token/cookie 未写入文件、未输出；未调用 Web 业务 RPC。
- 影响的 FR/ADR/TP：FR-015/016；ADR-008；TP-053
- 结论：CONTINUE；fresh Web token-cookie 认证证据已补齐，但这不等于完整 Web 业务流或真实 provider 可用，状态保持 `LOCALLY_TESTED`
- 证据：token root `303`、`Set-Cookie=True`、clean root `200`、cookie 数量 `1`；listener 停止后端口监听数 `0`；remove/dump/help 成功，sentinel 配置/引用及 profile-local Junction 清零，工作区目标仍存在。
- 停止条件检查：未修改 DSH 源码、请求、retry policy 或常用 profile，未读取真实凭据、未访问真实供应商、未执行远端发布。

### UB-20260919-009

- 官方 commit/tag：`fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`
- 检查时间（Asia/Shanghai / UTC）：2026-09-19 00:52-00:55 / 2026-09-18 16:52-16:55
- 执行者：Codex / root
- 变更文件：无上游文件变更；在全新隔离 DSH home 使用官方 `--from-default-profile web` 初始化 profile，并安装当前本地 sentinel
- 契约差异：目标 tag 未漂移。fresh Web profile 的 `dump-config` 成功且 Web 配置行存在；固定端口 listener 启动后无 token `GET /` 返回 `401`；Ctrl-C 后端口归零。官方 remove 后 `dump-config` 与 `--help` 成功，sentinel 配置/锁文件/package map 引用与 profile-local Junction 均清零。未调用 Web 业务 RPC，不读取或输出 token/cookie。
- 影响的 FR/ADR/TP：FR-015/016/018/019；ADR-008/016；TP-052/TP-053/TP-055
- 结论：CONTINUE；fresh Web 模板的安装、受保护 listener 装载和卸载恢复证据已补强，但完整 Web 业务流、真实 provider 与 HOST_VERIFIED 门禁仍未完成，状态保持 `LOCALLY_TESTED`
- 证据：隔离 DSH home `dsh-sis-web-fresh-20260919-0052`、profile `sis-web-fresh-20260919-0052`、端口 `3201`；setup/add/dump/remove/help 均退出码 0，no-token status `401`，listener cleanup 后端口监听数 `0`，最终 sentinel 行数 `0`、Junction 不存在、残余引用文件数 `0`，工作区目标仍存在。
- 停止条件检查：未修改 DSH 源码、请求、retry policy 或常用 profile，未读取真实凭据、未访问真实供应商、未执行远端发布。

### UB-20260919-008

- 官方 commit/tag：`fb2c4b9e698e30edb738bca4cf0618587db7d203` / `dsh-v0.1.5-rc.2`
- 检查时间（Asia/Shanghai / UTC）：2026-09-19 00:34-00:36 / 2026-09-18 16:34-16:36
- 执行者：Codex / root
- 变更文件：无上游文件变更；本轮复核当前构建在隔离 custom profile 的 Web 受保护 listener 装载
- 契约差异：目标 tag 未漂移。官方 webserver 在无 fallback 时返回 `404`；当前 profile 的固定端口重跑已返回无 token `401`，说明受保护 listener/fallback 在该次启动中已装载；同一当前构建随后在进程内 cookie 会话中取得 token root `303`、`Set-Cookie` 存在、clean root `200`。不读取或输出 token，也未调用 Web 业务 RPC。
- 影响的 FR/ADR/TP：FR-015/016/018/019；ADR-008/016；TP-052/TP-053/TP-055
- 结论：CONTINUE；当前构建的隔离 Web no-token 装载证据已补强，完整 Web 业务流、真实 provider 与 HOST_VERIFIED 门禁仍未完成，状态保持 `LOCALLY_TESTED`
- 证据：隔离 DSH home `dsh-sis-web-current-a83b74ded1e746e7836af04f352325a0`、custom profile `sis-web-current-a83b74de`；端口 `3199` 的脱敏启动输出与 no-token `GET /` status `401`；端口 `3200` 的进程内认证复核为 token root `303`、`Set-Cookie=True`、clean root `200`、cookie 数量 `1`；两次实验结束后目标端口监听数均为 `0`、匹配 pnpm/node/cmd 进程数均为 `0`。
- 停止条件检查：未修改 DSH 源码、请求、retry policy 或常用 profile，未读取真实凭据、未访问真实供应商、未执行远端发布。
