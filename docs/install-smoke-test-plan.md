# 安装布局冒烟测试计划与验收标准

> 目标读者：负责实现自动化冒烟测试与 CI 的工程师。
> 背景：`skills/skill-debug/lib/common.sh` 是共享事实层的 canonical authoring source，`skills/skill-hygiene/lib/common.sh` 是字节一致的 deployment mirror。skills CLI（`npx skills add`）按"含 `SKILL.md` 的目录"逐个安装 skill，**不会安装 skill 目录之外或未选择的 sibling skill 文件**。双份部署文件让 `skill-debug` 与 `skill-hygiene` 均可独立安装；`cmp` gate 防止实现分叉。历史上共享库曾放在 `skills/lib/`，导致安装产物中所有脚本无法运行。本计划的目的是让这类"开发布局可用、发布布局损坏"的事故被机器拦截。

## 一、范围与原则

- **被测对象**：`skill-scan.sh`、`skill-probe.sh`、`skill-dashboard.sh`、`skill-trace.sh`、`skill-canary.sh`、`skills-refiner-doctor.sh` 在**安装布局**下的可运行性与行为一致性。
- **核心原则**：安装布局测试必须在**模拟安装布局**（只有 skill 目录，没有仓库其余文件）下执行，而不是借用 git checkout。checkout、安装布局与保守观测语义由 7 个集成套件覆盖；平台边界另由 `test-platform-contract.sh` 验证。
- **沙箱纪律**：与现有测试一致——`HOME` 指向临时沙箱；清理函数必须路径校验（只删除已知临时根下的目录）。

## 二、测试环境矩阵

| 维度 | 要求 |
|---|---|
| 操作系统 | macOS 与 Ubuntu 跑全量；Windows `windows-latest` 通过 Git Bash 跑只读治理、CRLF/BOM trace 往返与 canary fail-closed 契约 |
| 依赖 | jq 必装；另加一个 **无 jq** 的降级用例（仅 T6） |
| 安装方式 | 首选真实 `npx skills add <本仓库>`（若 CI 网络允许）；否则用"仅复制含 SKILL.md 的目录"模拟（见 T1 准备步骤） |

## 三、测试项与验收标准

### T1 — 安装布局构造（其余用例的前置）

**步骤**：
1. `SANDBOX=$(mktemp -d)`；`mkdir -p "$SANDBOX/.agents/skills"`。
2. 对仓库中每个含 `SKILL.md` 的目录（当前为 `skills-refiner`、`skills-appreciation`、`skill-hygiene`、`skill-debug`），`cp -r` 到 `$SANDBOX/.agents/skills/`。**不得**复制 `skills/` 下的其他文件或仓库根的任何文件。
3. 若使用真实 `npx skills add`，以其产物为准，并断言产物目录集合与第 2 步一致。

**验收**：
- `$SANDBOX/.agents/skills/{skill-debug,skill-hygiene}/lib/common.sh` 均存在。
- 两份 `common.sh` 必须 `cmp` 字节一致；debug 副本是 authoring source，hygiene 副本是独立安装所需的 deployment mirror。
- `$SANDBOX/.agents/skills/lib` **不存在**（防止未来有人把库移回 skill 目录之外）。

### T2 — 四脚本安装布局可运行性（本计划的核心）

**步骤**：以 `HOME=$SANDBOX`，在沙箱外的任意 cwd 依次执行：
```bash
bash "$SANDBOX/.agents/skills/skill-hygiene/bin/skill-scan.sh" --json
bash "$SANDBOX/.agents/skills/skill-debug/bin/skill-probe.sh" --json
bash "$SANDBOX/.agents/skills/skill-debug/bin/skill-dashboard.sh" --json
bash "$SANDBOX/.agents/skills/skill-debug/bin/skill-trace.sh" --status
bash "$SANDBOX/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh" --json
```

**验收**：
- 退出码：scan/probe/trace-status 为 0；dashboard 无日志时允许非 0 但 stdout 必须是 `{"error":"no_activation_log",...}` 合法 JSON；doctor 为 0。
- stderr 中**不得出现** `Missing shared helper`。
- 所有 `--json` 输出可被 `jq .` 解析。
- doctor JSON 的 `steps.probe.status=="ok"`、`steps.hygiene.status=="ok"`、`steps.dashboard.status` ∈ {ok, no_data}。

### T3 — Schema 合同断言

**步骤**：解析 T2 的 JSON 输出。

**验收**：
- `scan.metadata.schema_version == "skill-scan.v4"`，`metadata.runtime_validation_mode == "static-preflight"`，且 `metadata.hash_normalization == "strip-canary-crlf-bom.v1"`。
- `probe.schema_version == "skill-probe.v3"`。
- dashboard（有数据时，见 T4）`schema_version == "skill-dashboard.identity.v2"`。
- 全部输出中字段 `content_sha256` **出现次数为 0**（已更名 `normalized_content_sha256`）；`jq '[..|objects|select(has("content_sha256"))]|length'` 为 0。
- `normalized_content_sha256` 为 64 位十六进制。
- canary 事件的 `trace_schema` 仍为 `skill-debug.identity.v1`（事件协议未变，不得误升）。

### T4 — 安装布局下的 canary 全链路

**步骤**：
1. 在 `$SANDBOX/.agents/skills/demo/SKILL.md` 创建最小合法 skill（含 name/description），记录副本与 `stat` 的 mtime/权限。
2. `skill-trace.sh --inject` 该文件。
3. 从注入块中提取 ```` ```bash ```` 围栏内的命令并以 `HOME=$SANDBOX` 执行（模拟 agent 执行 canary）。
4. 运行 dashboard `--json`。
5. `skill-trace.sh --strip` 该文件，再次运行 dashboard `--json`。

**验收**：
- 注入块行数 ≤ 13（其中一行记录原文件 EOF 换行状态，以支持逐字节 strip 恢复；其余模板仍需保持紧凑）；块内包含指向 `$SANDBOX/.../skill-debug/bin/skill-canary.sh` 的**绝对路径**。
- 步骤 3 后 `~/.agents/debug/activation.jsonl` 追加恰好 1 行合法 JSON，`trace_kind=="canary"` 且 `identity_key` 非空。
- 步骤 4：demo 的 `observed==true`。
- 步骤 5：strip 后文件与原始副本**逐字节相等**（`cmp`），mtime/权限不变；**strip 后 demo 的 `observed` 仍为 true**（身份连续性——历史事件不因 strip 变成孤儿）。

### T5 — 降级路径（helper 缺失）

**步骤**：完成 T4 注入后，把 `skill-debug/bin/skill-canary.sh` 改名移走，再次执行注入块中的命令。

**验收**：
- 命令退出码为 0（不得静默失败也不得硬报错中断 agent）。
- 日志追加 1 行 `trace_kind=="canary_degraded"`、`identity_key==""` 的合法 JSON。
- dashboard 对该事件按 legacy name-only 语义处理，不崩溃。
- 上述成功降级仅适用于能证明 POSIX 权限语义的 macOS/Linux/WSL Linux 文件系统。Windows Git Bash 或 WSL `/mnt/<drive>` 必须非 0 退出、输出明确错误且不创建日志。

### T6 — 无 jq 降级（仅 canary helper）

**步骤**：构造 `PATH` 中无 `jq` 的环境，直接执行 `skill-canary.sh <demo 的 SKILL.md>`。

**验收**：退出码 0；追加的行可被（恢复 jq 后）`jq .` 解析；`identity_key` 与有 jq 时计算值一致。

### T7 — 回归护栏（在安装布局与 checkout 布局各跑一次）

**步骤**：运行 7 个集成测试套件，并把本计划的安装布局断言固化在 `skills/skill-debug/tests/test-install-layout.sh`。

**验收**：
- 7 个集成套件全绿（macOS + Ubuntu）。
- `test-install-layout.sh` 纳入 CONTRIBUTING 与 CI 清单。
- 选择性安装 fixture 必须从 checkout 外的临时 cwd 执行，且输出不得引用仓库根路径。

### T8 — Windows 环境边界

**步骤**：在 `windows-latest` 的 Git Bash 中运行 `test-platform-contract.sh`。构造带空格的 `HOME`/cwd、BOM+CRLF skill、MINGW 平台信号与 helper 缺失场景。

**验收**：
- scan/probe/doctor 在带空格路径下返回结构化 JSON；dashboard 无日志保持 `no_data` 协议。
- trace 对 BOM+CRLF 文件 inject/strip 后 `cmp` 逐字节一致。
- helper 与 degraded canary 均在 Git Bash 权限语义下 fail closed，且不创建 `activation.jsonl`。
- 原生 PowerShell/cmd 不进入支持声明；WSL 2 仅在 `HOME` 位于 Linux 文件系统且实际 mode 可复核时进入设计支持范围，专用 WSL runner 认证另记。
- Windows Git Bash 只验收真实目录/复制布局；symlink/junction 拓扑必须等独立 Windows fixture 通过后才能进入支持声明。

## 四、CI 集成要求

1. GitHub Actions：`ubuntu-latest` + `macos-latest` 跑 7 个集成套件、`test-platform-contract.sh`、helper `cmp` 与 `shellcheck --severity=error`；`windows-latest` 使用 Git Bash 跑 `bash -n`、helper `cmp` 与平台契约测试。
2. 触发：PR 与 main push。
3. **合入门槛**：上述全部通过；任何一项失败即红。

## 五、总体退出标准（Definition of Done）

- [ ] T1–T8 全部实现；macOS/Ubuntu 全量通过，Windows Git Bash 有界契约通过；
- [ ] 所有实际输出 JSON 中旧 key `content_sha256` 的出现次数为 0；测试源码可以引用该字符串来断言它不存在于输出；
- [ ] 模拟安装布局的测试不依赖仓库根的任何文件（可通过把沙箱移到 `/tmp` 独立目录验证）；
- [ ] canonical helper 与 deployment mirror 字节一致，且两份都进入 shellcheck surface；
- [ ] CI 在故意注入的坏样本上确实变红（做一次"负验证"：临时把 `COMMON_SH` 路径改错，确认 T2 失败后还原）。
