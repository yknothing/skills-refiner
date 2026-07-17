# ADR-0001: 非侵入式 Skill 用量观测

- **Status:** Accepted with limitations  
- **Date:** 2026-07-17  
- **Deciders:** Product owner (host machine) + skills-refiner maintainers  
- **Supersedes:** Implicit “canary inject = usage analytics” framing in `skill-debug` messaging  
- **Related:** ADR-0002; machine `~/.agents/skills/DEBT-BACKLOG.md` D-10; `skill-debug` SKILL.md accuracy contract  

## Context

skills-refiner / `skill-debug` 曾通过向被监测 `SKILL.md` **注入 canary** 来近似统计激活。该路径存在：

- 安全风险（额外 shell 指令面）
- 合规风险（改写第三方/分发 skill）
- 信度缺口（仅证明 “agent 执行了 canary”，不能证明发现/有用性）

同时，主要 Agent 宿主已具备或正在具备 **运行时遥测**，但开放程度不一、常带隐私门禁，导致“原生似乎没开”的体感。

## Decision

采用 **宿主优先、分层降级** 的观测架构；**禁止**将 canary 注入作为默认产品化计量路径。

```text
L0  平台原生遥测（首选）
L1  宿主 Hook（改配置，不改 SKILL.md）
L2  会话旁路只读解析（transcript / 本地日志）
L3  Canary 注入（显式同意、可 strip、禁止进入分发物）
```

### Binding rules

1. **计量边界在宿主运行时**，不在 skill 文件内容侧。
2. `skill-probe` 继续只回答发现面问题（非侵入）。
3. Canary / `skill-trace --inject*` 必须标注为 debug-only，且需用户显式确认。
4. 跨 Agent 统一看板通过 **adapter 聚合** 实现，不发明侵入式跨平台协议。
5. 任何导出真实 skill 名 / 工具细节的开关，必须按平台隐私门禁单独同意。

## Platform capability snapshot (as of 2026-07-17)

| Platform | Signal | Openness / gate |
|---|---|---|
| Claude Code | OTel event `claude_code.skill_activated`；`invocation_trigger` ∈ {`user-slash`,`claude-proactive`,`nested-skill`} | Opt-in: `CLAUDE_CODE_ENABLE_TELEMETRY=1`；自定义名默认可能为 `custom_skill`，真名需 `OTEL_LOG_TOOL_DETAILS=1` |
| Cursor | Analytics API `GET /analytics/team/skills` | Enterprise + admin-scoped key；**无** Skill-use Hook（社区官方确认） |
| Codex | Opt-in OTel（run/tool 级） | Skill 生命周期 hook（`PreSkillUse`/`PostSkillUse`）仍为诉求，不可假设已稳定 |

Sources: Claude Code Monitoring docs; Cursor Analytics API docs / forum; Codex OTel docs & GitHub issues.

## Consequences

### Positive

- 观测与 skill 分发解耦，降低安全/合规暴露面。
- 与厂商隐私默认（红acted skill 名）对齐，避免绕过门禁。
- 为 ADR-0002 的 pack 挂载事件（治理信号）留下非侵入扩展点。

### Negative / limitations

- 个人开发者可能暂时 **没有** Cursor Skills Analytics。
- Claude 在未开 `OTEL_LOG_TOOL_DETAILS` 时，用量报表粒度不足。
- 跨平台指标语义不一致（activation ≠ adoption ≠ usefulness）。
- 在原生管道接通前，产品无法诚实声称“已掌握真实使用率”。

### Non-goals

- 不实现中央 SaaS 遥测后端（本 ADR 只定契约与最小本地采集）。
- 不修改第三方 skill 正文以“补齐”统计。
- 不把 canary 观察率当作质量或 ROI 证明。

## Appendix B — Claude Code OTel → 本地 JSONL 最小采集

> 本附录是 ADR-0001 的可执行补充（用户选项 B）。仅描述 **本机 opt-in** 管道；不向 Anthropic 额外发送数据（数据发往你配置的 OTLP 端点）。

### B.1 常量（禁止魔法值散落）

| 常量名 | 值 | 含义 |
|---|---|---|
| `ENV_TELEMETRY_ENABLE` | `CLAUDE_CODE_ENABLE_TELEMETRY` | 总开关 |
| `ENV_OTEL_LOGS_EXPORTER` | `OTEL_LOGS_EXPORTER` | logs 导出器 |
| `ENV_OTEL_EXPORTER_OTLP_ENDPOINT` | `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP 端点 |
| `ENV_OTEL_LOG_TOOL_DETAILS` | `OTEL_LOG_TOOL_DETAILS` | 暴露真实 skill/工具细节（隐私敏感） |
| `EVENT_SKILL_ACTIVATED` | `claude_code.skill_activated` | Skill 激活事件名 |
| `DEFAULT_LOCAL_OTLP_ENDPOINT` | `http://127.0.0.1:4318` | 本机 collector 默认 HTTP 端点 |
| `DEFAULT_JSONL_RELATIVE` | `.agents/debug/claude-skill-activated.jsonl` | 建议落盘相对 `$HOME` |

### B.2 隐私门禁决策树

```text
需要计量？
  ├─ 否 → 保持 TELEMETRY 关闭；只用 skill-probe
  └─ 是 → 开启 ENV_TELEMETRY_ENABLE=1
           ├─ 只要“有激活、不知真名” → 不要开 TOOL_DETAILS
           └─ 需要按 skill 名聚合 → 显式同意后开 ENV_OTEL_LOG_TOOL_DETAILS=1
                                      并记录同意时间/范围到运维笔记
```

**禁止：** 在未获同意时于共享机器或 CI 默认打开 `OTEL_LOG_TOOL_DETAILS` / `OTEL_LOG_USER_PROMPTS` / `OTEL_LOG_RAW_API_BODIES`。

**单独同意门禁：** `OTEL_LOG_TOOL_DETAILS=1` 不得与“打开遥测”捆绑默认开启。开启前须记录：同意人、时间、范围（本机/项目/团队）、预计关闭条件。未开此门禁时，报表只允许聚合到 `custom_skill` / 匿名桶，不得宣称“按 skill 名的采用率”。

### B.3 推荐拓扑

```text
Claude Code ──OTLP/HTTP──► 本机 Collector / 简易接收器
                              │
                              └─► $HOME/.agents/debug/claude-skill-activated.jsonl
```

### B.4 最小环境示例（zsh）

将下列片段写入 **个人** shell 配置或一次性 session（勿提交含密钥的配置到公开仓库）：

```bash
# --- ADR-0001 Appendix B: local-only Claude skill activation ---
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}"
# 仅在明确需要真实 skill 名时取消下一行注释：
# export OTEL_LOG_TOOL_DETAILS=1
```

### B.5 JSONL 事件契约（adapter 目标形状）

采集器应将 `EVENT_SKILL_ACTIVATED` 归一为每行一个 JSON 对象，字段建议：

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | string | 固定 `skills-refiner.claude-skill-activated.v1` |
| `observed_at` | string | ISO-8601 |
| `skill_name` | string | 可能为 `custom_skill`（未开 TOOL_DETAILS） |
| `invocation_trigger` | string | `user-slash` \| `claude-proactive` \| `nested-skill` \| `unknown` |
| `skill_source` | string \| null | 平台属性透传 |
| `session_id` | string \| null | 若平台提供 |
| `privacy_tool_details` | boolean | 本次管道是否开启 TOOL_DETAILS |

### B.6 验收探针（人工）

1. 启动本机 OTLP 接收端（或临时 console exporter）。  
2. 开启 B.4 环境变量后启动 Claude Code。  
3. 显式执行一个 slash skill / 触发一次 skill 激活。  
4. 确认出现 `EVENT_SKILL_ACTIVATED`（或归一 JSONL 一行）。  
5. **关闭** 遥测环境变量，确认不再产生新事件。

### B.7 明确不保证

- 不保证 Cursor / Codex 同期具备同等字段。  
- 不保证 `custom_skill` 占位可被本地反解为真名。  
- 不保证激活事件等于“技能有效”或“应保留该 skill”。

## Validation

- 对抗性评审：`docs/adversarial-product-pk/2026-07-17-observability-pack-catalog/`  
- 验收记录：`docs/verification/2026-07-17-observability-pack-catalog-acceptance.md`  

## References

- Claude Code Docs — Monitoring / OpenTelemetry  
- Cursor Docs — Analytics API (`/analytics/team/skills`)  
- Cursor Forum — “Hook on Skill usage” (no skill hook)  
- Codex OTel configuration docs; GitHub issue on PreSkillUse/PostSkillUse  
- `~/.agents/skills/skill-debug/SKILL.md` — Native Platform Signals First  
