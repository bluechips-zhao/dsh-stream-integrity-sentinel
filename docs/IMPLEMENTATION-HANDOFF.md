# 实现交接书

## 1. 当前交付状态

这是 **D4 隔离宿主夹具验收状态**。D1 上游探针、纯核心、Cordis 绑定、replayState 成功/非成功终止校验、finish failure 结构校验、真实 Agent Loop、normal retry 排除、always retry 风险复现与启动告警、真实 headless always-retry recovery、真实 user cancel、finish/abort/cleanup 与 next 挂起期间 cancel 竞态、真实绑定日志 canary、隔离 profile bundle 安装、fresh Web 模板 listener/token-cookie smoke、Web token-cookie 认证链路和真实 DSH headless fixture 健康/违规/取消证据已存在；真实供应商 provider 和完整 Web 业务宿主验收仍待完成。

### 1.1 当前实例状态快照（2026-09-19）

| 项目 | 当前证据/状态 |
| --- | --- |
| 允许状态 | `LOCALLY_TESTED`；不得写为 `HOST_VERIFIED` 或 `PUBLISHED` |
| DSH 基线 | `dsh-v0.1.5-rc.2`，commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` |
| 本地验证 | `pnpm typecheck`、`pnpm build`、`pnpm test`（5 files / 69 tests）、`pnpm pack --dry-run --json` 已通过；tsdown 保留已记录的 `define` warning |
| 隔离宿主 | fresh profile 的安装、`dump-config`、Web listener no-token `401`、token `303`→signed cookie→clean root `200`、headless 健康/违规/取消、卸载恢复和残留审计已有记录 |
| 安全边界 | 真实 Agent Loop spy tool 证明违规执行次数为 0；真实 provider 与完整 Web 业务 RPC 未测试 |
| 分发边界 | 当前 package 缺少 `LICENSE` 文件及 `license`/`repository`/`author` 等发布元数据；未执行 npm/GitHub 或其他远端变更 |
| 恢复条件 | 用户提供/确认发布元数据，或明确授权真实 provider/Web 业务验证；远端发布仍需单独确认 |

此快照是当前工作区的交接事实记录，不改变冻结设计、状态门禁或用户授权边界。

## 2. 不得重新设计的冻结项

- 项目是规范化 `StreamChunk` 一致性防火墙，不是 raw SSE 审计器。
- v1 默认只保护 `options.tools` 非空调用。
- 默认 `enforce`，显式 `observe`。
- 不提供 repair/neutralize，不猜测 ID/name/arguments。
- 首个工具相关 chunk 后隔离整个流尾，直到 finish 后确认 iterator done。
- 违规流尾不放行，合成稳定 error finish。
- 不修改请求、重试策略、历史会话或 DSH 源码。
- 不记录 messages/text/reasoning/arguments/replayState。
- 使用普通 bundle 插入唯一 row，不替换官方同 ID 条目。

改变任一项必须先写 ADR 并获得用户确认。

## 3. 第一阶段任务：D1 上游探针

1. 记录官方目标 commit/tag、Node、pnpm。
2. 写最小 plugin probe，证明 `llm/stream` listener 的：
   - `this`、options、next 形状；
   - `next()` 一次调用；
   - listener 注册和卸载；
   - 多 listener 的进入/yield 顺序。
3. 写合成 adapter 产生健康/异常 chunks。
4. 用真实 `LlmRuntime` 验证包裹顺序。
5. 用真实 Agent Loop + spy tool 验证 error finish 不执行工具。
6. 验证 default normal retry 不重试、always retry 的实际风险。
7. 验证 fresh profile 的 bundle 插入能稳定取得安全所需顺序。
8. 把证据追加到 `UPSTREAM-BASELINE.md` 和协作书。

若监听器顺序无法保证或异常工具 chunk 已先进入下游，状态必须记为 STOP/BLOCKED，不得继续写“近似保护”。

## 4. 第二阶段任务：D2 核心实现

建议按以下顺序：

1. `config.ts`：纯配置类型与归一化；
2. `validator.ts`：chunk runtime schema、全局状态；
3. `tool-block.ts`：per-index 身份/参数/关闭状态；
4. `diagnostics.ts`：只接收安全字段的类型设计；
5. `guard-stream.ts`：iterator 驱动、隔离、flush、reject、abort；
6. L1/L2 全部测试；
7. 代码审查重点检查任何 fail-open、正文日志和多终止路径。

核心层不得 import Cordis，以便单独模糊测试。

## 5. 第三阶段任务：D3/D4 绑定与宿主验收

- 实现 `plugin.ts`/`index.ts`；
- 添加严格配置 schema；
- 添加 `package.json` 与 `cordis.patch.yml`；
- 使用唯一 row id `stream-integrity-sentinel`；
- 完成 TP-047..TP-056；
- 在隔离 DSH home/profile 中安装，不污染用户常用 profile；
- 分别验证 Web 与 headless；
- 验证卸载并恢复原 profile。

## 6. 交付报告模板

```text
状态: DESIGN | SOURCE | LOCALLY_TESTED | FRESH_PROFILE_VERIFIED | HOST_VERIFIED | PUBLISHED
DSH commit/tag:
插件 commit/version:
修改文件:
完成的 FR/TP:
执行命令与退出码:
Web 证据:
Headless 证据:
违规工具执行次数:
卸载恢复:
未完成项:
风险/停止条件:
```

不得把较低状态描述为较高状态。

## 7. 给新对话的复制提示词

```text
请继续实现本项目。

先完整阅读根目录 AGENTS.md，以及 README.md、docs/PROJECT.md、docs/ARCHITECTURE.md、docs/TECHNICAL-SPEC.md、docs/THREAT-MODEL.md、docs/TEST-PLAN.md、docs/TRACEABILITY.md、docs/UPSTREAM-BASELINE.md、docs/IMPLEMENTATION-HANDOFF.md、docs/ACCEPTANCE-CRITERIA.md。内部冻结契约和协作记录仅在本机工作区读取，不随公开仓库发布。不得凭旧对话或本机可能修改过的 DeepSeek Harness 源码重新设计。

开始任何修改前：
1. 在本机私有协作记录追加 STARTED，写明北京时间/UTC、执行者、目标和文件归属；
2. 从 DeepSeek Harness 官方仓库重新核对目标 commit 下的 StreamChunk、llm/stream、LlmRuntime.adapterStream、BlockAssembler、Agent Loop、retry policy 和 bundle 安装契约；
3. 先完成 IMPLEMENTATION-HANDOFF.md 的 D1 探针，特别证明 listener 顺序、合成 error finish、零工具执行和 iterator cleanup；
4. 如触发 AGENTS.md 停止条件，停止实现并报告，不要做近似方案。

冻结设计：v1 是规范化 StreamChunk 的 fail-closed 防火墙；默认只保护带 tools 的调用；不看 raw SSE；不修复/补全/重编号；首次工具 chunk 后隔离全部流尾直到 iterator done；健康流原值原序放行；违规时丢弃流尾并输出稳定、非默认重试的错误 finish；不得记录正文、arguments、reasoning、replayState 或凭据；不得修改请求、历史、retry policy 或 DSH 源码。

按 docs/TRACEABILITY.md 实现并执行 docs/TEST-PLAN.md。完成时追加 COMPLETED/BLOCKED 协作记录，分别报告设计、源码、局部测试、fresh profile、Web/headless 和发布状态，不得把 mock/build/config dump 称为已可用。不要提交或发布远端，除非我另行明确授权。
```

## 8. 接手完成判定

只有 `docs/ACCEPTANCE-CRITERIA.md` 全部强制门禁通过，才能说“实现完成”。只有 fresh profile 的 Web/headless 证据通过，才能说“对该 DSH 基线可用”。只有用户明确授权并完成远端操作，才能说“已发布”。
