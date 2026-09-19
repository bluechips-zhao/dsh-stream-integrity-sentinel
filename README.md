# dsh-stream-integrity-sentinel

`dsh-stream-integrity-sentinel` 是一个面向 DeepSeek Harness（DSH）的插件：它在 `llm/stream` 瀑布边界验证适配器产出的规范化 `StreamChunk`，并在不可信工具调用进入 Agent Loop、会话记录和工具执行之前阻断它。

当前仓库已进入 **D4 隔离宿主夹具验收阶段**。纯核心、发布包绑定、真实 Agent Loop、fresh Web 模板 token-cookie 认证/listener smoke 和真实 DSH headless fixture 证据已存在；真实供应商 provider 与完整 Web 业务宿主验收仍未完成，不应被描述为对目标 DSH 已全面可用。

## 核心定位

- 它是规范化流的一致性防火墙，不是供应商 HTTP/SSE 原始报文审计器。
- 它验证身份、索引、块生命周期、终止顺序、工具参数 JSON 和资源上限。
- 它不自动补 ID、不重命名工具、不拼猜参数，也不伪造模型意图。
- 一旦进入工具调用片段，整个后续流尾被暂存；只有完整验证通过才按原顺序放行。
- 违规流在 `enforce` 模式下变为一个稳定、非默认重试的错误终止，已暂存的工具调用不会到达 Agent Loop。

## 为什么仍有必要

DSH 当前的 `BlockAssembler` 有意兼容 delta-only 协议，并会忽略部分迟到片段、采用权威 `block-end`、以及对缺失身份使用回退。这种宽容适合兼容性，却不等于“可安全执行”。社区已经出现空工具名/ID、重复 call ID、无效 JSON 参数和会话持久化污染等真实问题。

已有项目会修复或中和其中某些故障。本项目的区别不是“第一个看到工具流”，而是建立一套 **拒绝猜测、完整流语法验证、流尾隔离、可证明不执行** 的统一边界。详细设计决策与竞品材料属于内部文档，不随公开仓库发布。

## 文档导航

- [项目章程](docs/PROJECT.md)
- [架构设计](docs/ARCHITECTURE.md)
- [技术规范](docs/TECHNICAL-SPEC.md)
- [威胁模型](docs/THREAT-MODEL.md)
- [测试计划](docs/TEST-PLAN.md)
- [需求追踪矩阵](docs/TRACEABILITY.md)
- [上游基线](docs/UPSTREAM-BASELINE.md)
- [实现交接书](docs/IMPLEMENTATION-HANDOFF.md)
- [验收标准](docs/ACCEPTANCE-CRITERIA.md)
- 设计决策、创新性与竞品分析、协作记录：内部材料，不随公开仓库发布

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 文档基线 | 已建立，D1 已复核 |
| 上游源码基线 | `fb2c4b9e698e30edb738bca4cf0618587db7d203`（`dsh-v0.1.5-rc.2`） |
| 源码实现 | D2 核心 + Cordis 绑定已存在 |
| 单元/集成测试 | 69 项通过（纯核心、结构契约、属性、真实 `LlmRuntime`、真实 `AgentLoop`/retry/取消） |
| 新配置安装验证 | 隔离 profile 安装、dump-config、卸载通过 |
| Web/headless 真实宿主证据子集 | fresh Web 模板 no-token 根请求 `401`、token 根请求 `303`→cookie→clean root `200`，headless fixture 健康/违规/取消/always-retry recovery 已通过；完整 Web 业务流与真实 provider 仍未完成 |
| npm/GitHub 发布 | 未授权、未执行；`LICENSE`、`license` 以及 `repository`/`author`/`homepage` 等发布身份元数据待用户确认后补齐 |

## 安全声明

该插件即使实现完成，也只能保护经过它并且仍能被它观察到的规范化流。它不能证明适配器对供应商原始报文的翻译忠实，也不能替代 DSH 自身、工具权限、审批策略或操作系统隔离。任何“安全边界”声明必须引用 [威胁模型](docs/THREAT-MODEL.md) 和真实宿主验收证据。
