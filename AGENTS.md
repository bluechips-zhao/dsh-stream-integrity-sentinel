# AGENTS.md

本文件约束所有在此项目中工作的人员和 Agent。项目的首要目标是可审计地实现已冻结设计，而不是临场扩大范围。

## 1. 权威顺序

发生冲突时按以下顺序处理：

1. 用户在当前任务中的明确要求。
2. 本文件。
3. 内部冻结契约与 `docs/TECHNICAL-SPEC.md`。
4. `docs/ARCHITECTURE.md`、`docs/THREAT-MODEL.md`。
5. `docs/PROJECT.md`、`docs/TEST-PLAN.md`、`docs/TRACEABILITY.md`。
6. README、注释与历史讨论。

禁止仅凭旧对话、记忆或本机修改过的 DSH checkout 推翻上述文档。

## 2. 每次实现前必须做的上游预检

1. 从官方仓库读取当前目标 commit/tag，而不是只信本机副本。
2. 重新核对：
   - `StreamChunk` 与 `FinishReason` 类型；
   - `GenerateOptions`；
   - `llm/stream` 的 waterfall 签名和监听器顺序；
   - `LlmRuntime.adapterStream()` 的异常规范化；
   - Agent Loop 接收、持久化、汇编和执行工具调用的顺序；
   - `BlockAssembler` 的容错规则；
   - bundle/patch/plugin 的官方安装契约。
3. 把实际 commit、日期、差异和结论追加到 `docs/UPSTREAM-BASELINE.md`。
4. 若关键契约漂移，立即停止实现，先更新设计、追踪矩阵与测试计划。

以下任一项成立即为停止条件：

- 没有公共 API 可以稳定包裹 `llm/stream`；
- 无法证明 sentinel 位于其他可能改写输出的中间件之外；
- 无法在违规时阻止工具调用进入 Agent Loop；
- 合成错误 `finish` 不再被 Agent Loop 当作失败处理；
- bundle 安装必须替换同 ID 官方条目或依赖未公开内部导出；
- 实现需要记录工具参数、密钥、完整提示词或推理内容；
- 测试无法证明内存上限、取消和 iterator cleanup。

## 3. 固定范围

v1 只做规范化输出流的验证和阻断：

- 默认仅保护 `options.tools` 非空的调用；
- 只读请求，不修改冻结的 `GenerateOptions`；
- 不读取供应商原始网络字节；
- 不修复、重写、补全或重映射工具调用；
- 不修复历史会话；
- 不改变 DSH 的工具权限、批准或沙箱策略；
- 不发送网络遥测。

范围变更必须先写 ADR，再由用户确认。

## 4. 协作书规则

每次工作必须在本机私有协作记录中追加两类记录：

- 开始时写 `STARTED`：时间、执行者、目标、文件归属、预期解决的问题。
- 结束时写 `COMPLETED`、`BLOCKED` 或 `ABORTED`：实际修改、证据、解决事项、未解决事项和下一步。

记录只能追加，不能覆写历史。时间同时写 Asia/Shanghai 和 UTC。执行者必须可区分，例如 `Codex/root`、`Codex/worker-1` 或人员姓名。

## 5. 实现纪律

- 采用 TypeScript ESM；Node 版本服从目标 DSH 的官方 `engines`。
- 纯状态机与 DSH 绑定层分开；核心验证器不得依赖 Cordis。
- 所有配置必须有有界默认值和 schema；未知配置字段失败。
- 对未知 chunk/block 扩展采用保守兼容策略：未进入工具调用语义的扩展按原样传递；可能影响工具调用或终止语义的扩展在 `enforce` 下拒绝。
- 插件自身异常不得逃逸为普通 middleware throw；必须转换为稳定的 sentinel 错误终止，除非宿主已取消。
- 日志不得包含原始工具参数、消息正文、推理文本、凭据或 replayState。
- 禁止把 mock、构建成功或配置 dump 称为“真实可用”。

## 6. 最低验证层级

完成实现至少需要分别报告：

1. 纯状态机单元测试。
2. 属性/模糊测试与资源上限测试。
3. 使用真实 `LlmRuntime`、`BlockAssembler`、Agent Loop 的宿主集成测试。
4. bundle 打包与已发布内容检查。
5. 全新 DSH profile 安装、启动、卸载和恢复。
6. Web 与 headless 的真实健康流、违规流、取消流测试。

任何层级未完成都必须明确标注。

## 7. 禁止事项

- 不得声称“GitHub 上没有任何同类”。
- 不得把 observe 模式称为保护。
- 不得用自动修复掩盖违规。
- 不得让资源超限退化为 fail-open。
- 不得覆盖用户未授权的文件或发布远端仓库/npm 包。
- 不得删除或改写协作历史。
