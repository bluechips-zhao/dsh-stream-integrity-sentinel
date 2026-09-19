# 验收标准

## 1. 状态词定义

| 状态 | 含义 |
| --- | --- |
| `DESIGN` | 仅文档 |
| `SOURCE` | 源码存在，未证明行为 |
| `LOCALLY_TESTED` | L1/L2/L3 通过 |
| `FRESH_PROFILE_VERIFIED` | 新 profile 安装/组合/卸载通过 |
| `HOST_VERIFIED` | Web 与 headless 真实路径通过 |
| `PUBLISHED` | 远端仓库/package 已实际发布并可获取 |

状态不可跳级，也不可用未来计划代替证据。

## 2. 强制门禁

### AC-001 文档一致性

- 所有文档链接有效；
- FR/NFR/TP/ADR/T 编号唯一；
- 每个 FR 有测试和威胁/边界映射；
- 协作书存在 STARTED 和终态记录。

### AC-002 上游兼容性

- 目标 commit/tag 明确；
- D1 未触发停止条件；
- listener 顺序由源码探针和真实 profile 双重证明；
- 只使用公开、可从发布包解析的 API。

### AC-003 健康流透明

- TP-001..TP-010、P-001、P-004、P-005 通过；
- 输出 chunk 值与顺序完全相同；
- 无工具前缀保持实时；
- 无额外网络 I/O。

### AC-004 违规零执行

- TP-011..TP-040 通过；
- 真实 Agent Loop spy tool 对每个违规 fixture 的执行次数为 0；
- 隔离尾未出现在下游 attempt stream；
- 恰好一个稳定失败终止。

### AC-005 隐私与资源

- TP-033..TP-043、P-002、P-003、P-006、P-007 通过；
- canary 不出现在 plugin 日志、error 或配置 dump；
- 峰值内存符合配置硬上限的可解释范围；
- cleanup 后无 listener/iterator/state 泄漏。

### AC-006 重试和取消

- normal retry 对 sentinel 错误不重试；
- always retry 风险有可见启动告警和文档；
- abort/finish 竞态结果确定；
- 用户取消不被错误报告为完整性违规。

### AC-007 分发

- bundle/profile manifest 按官方契约；
- 无重复 loader/plugin row id；
- tarball 内容审计通过；
- Node/pnpm/peer dependency 约束准确；
- 安装不修改 DSH 源码。

### AC-008 Fresh profile 与宿主

- 在隔离 DSH home 创建 fresh profile；
- `--dump-config`/等价官方预检通过；
- Web 实际启动并确认受保护 listener 装载；
- headless 健康/违规调用符合契约；
- 卸载后 profile 可再次启动且无残留。

## 3. 发布阻断条件

任一情况阻断 release：

- 存在无法解释的健康流误报；
- 任何违规 fixture 导致工具执行；
- tool tail 在验证完成前进入下游；
- 日志出现正文/参数/凭据；
- listener 顺序依赖未声明的偶然注册顺序；
- middleware throw 导致不可审计崩溃；
- 资源上限 fail-open；
- 只在 mock/本机旧 checkout 通过；
- 未完成 fresh profile 卸载恢复；
- 文档仍声称绝对唯一或 raw-wire 完整性。

## 4. 当前验收结果

| 门禁 | 状态 |
| --- | --- |
| AC-001 文档一致性 | workspace Markdown 本地链接检查通过，FR/NFR/TP/P/T/ADR 追踪矩阵已复核，当前 `pnpm test` 为 5 files / 69 tests passed，D4 终结记录已追加 |
| AC-002 上游兼容性 | D1 seam/bundle、内层捕获和后来 `prepend` 外层边界已由真实 `LlmRuntime` 直接证明；外层同进程 listener 明确不在保护承诺内，完整宿主仍待验证 |
| AC-003 健康流透明 | TP-003..TP-010 的文本/reasoning、delta-only、end-only、多工具交错、名称省略和合法 JSON 根值直接回归通过；D2 纯核心 + 真实 `LlmRuntime`/`AgentLoop` 健康对照通过；成功 finish 的 aligned replayState 通过，非成功 finish 携带 replayState 被拒绝，error/aborted failure 结构受校验 |
| AC-004 违规零执行 | 纯核心与真实 Agent Loop spy tool 通过，恶意流执行次数为 0；完整宿主仍待验证 |
| AC-005 隐私与资源 | 纯核心诊断、quarantine/chunks/blocks/arguments 三类 enforce 上限、observe 截断原样放行、真实 `LlmRuntime` binding 日志 canary 和 binding disposer cleanup 通过；本机性能/RSS 基线已记录；完整宿主日志与跨硬件基准仍待验证 |
| AC-006 重试和取消 | 真实 Agent Loop + `dsh-llm-retry` 证明 sentinel 错误不触发 normal retry；显式 `always` 在真实 Agent Loop 与 headless fixture 中复现重试且工具执行为 0，并验证 provider 注册/替换时去重启动告警；真实 user cancel、finish/abort 和 next 挂起期间 cancel 均不转为完整性错误；并发流状态隔离通过；更复杂竞态仍待验证 |
| AC-007 分发 | 本地 build、pack dry-run、隔离安装/卸载通过；当前 `package.json` 声明了缺失的 `LICENSE` 文件且没有 `license`、`repository`、`author`、`homepage` 等发布身份字段，发布元数据闭环未完成，因此未发布 |
| AC-008 宿主 | 当前构建同一隔离 custom profile 已取得无 token `401`，并在进程内 cookie 会话中取得 token root `303`→signed cookie→clean root `200`；截至 2026-09-19，官方 `--from-default-profile web` fresh profile 也完成 sentinel 安装、`dump-config`、固定端口 Web listener no-token `401`、token root `303`→signed cookie→clean root `200`、Ctrl-C 清理、remove、无残留恢复和 `--help` 启动；最新构建在 fresh profile 中完成 headless 健康/违规/卸载 smoke，违规无 `D4_SPY_EXECUTED`；此前一次 `404` 未稳定复现并已记录为启动时序诊断；真实供应商 provider 与 Web 业务 RPC 未测试 |

当前允许状态为 `LOCALLY_TESTED`，不得上升为 `HOST_VERIFIED` 或 `PUBLISHED`。
