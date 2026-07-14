# 安装布局冒烟测试计划与验收标准

> 目标读者：实现和维护发布布局、cleanup CLI 与 CI 的工程师。
> 核心问题：仓库 checkout 可运行，不代表由 skills CLI 选择性安装后的
> `skill-hygiene` 可运行，更不代表 mutation 不会越界到 source repository。

## 一、范围与真相边界

- **选择性安装面**：只复制一个包含 `SKILL.md` 的 skill 目录，不能借用 checkout
  外部文件。`skill-hygiene` 必须自带 scanner、launcher、五个 cleanup `.mjs`
  module、native helper source 与测试所依赖的 runtime 文件。
- **只治理本机部署面**：cleanup 只可 mutation 已安装/已分发 entry；独立
  source/authoring repository 只读且字节、Git object、working tree 都不变。
- **平台面**：portable contract/core/CLI 在 macOS 和 Ubuntu；真实 mutation、
  recovery 与 native helper 只在 macOS；Windows Git Bash 维持既有有界只读契约。
- **沙箱面**：每个测试使用临时、路径校验过的 `HOME`，不得触碰真实安装目录。
- **证据面**：本地通过与“CI 已配置”不是“远端 CI 已通过”。只有 push 后对应
  revision 的 required job 绿灯，才能标记该 runner 验收完成。

## 二、环境矩阵

| 环境 | Node | Cleanup 验收 | 其他依赖 |
|---|---|---|---|
| 本机 macOS 27.0 arm64 | `v24.18.0`（本次实测） | review → decisions → plan → apply → status → undo；fault/recovery；setup-cli | `jq`、Bash、Apple CLT |
| GitHub `macos-latest` | major 24 | 同上；以该 revision 的远端 job 为准 | workflow 安装 `jq`、`shellcheck` |
| GitHub `ubuntu-latest` | major 24 | review 可用；setup/plan/apply/status/undo exit `3`、零 mutation | `jq`、`shellcheck` |
| GitHub `windows-latest` Git Bash | cleanup 不在支持面 | 既有 syntax、路径、BOM/CRLF、fail-closed contract | `jq` |

## 三、测试项与验收标准

### T1 — 选择性安装布局

只把目标 skill 目录复制到 checkout 外的
`$HOME/.agents/skills/<skill-name>/`，从另一个 cwd 执行。

验收：

- 四个 skill 可分别选择安装；`skill-debug` 与 `skill-hygiene` 的
  `lib/common.sh` 字节一致，且安装根不存在共享 `skills/lib` 依赖。
- `skill-hygiene` 单独安装时包含可执行 `bin/skills-refiner`、
  `native/cleanup-macos-helper.c` 和精确五个 `lib/cleanup-*.mjs`。
- 已安装 launcher 的 human help 与 `--help --json` 均可在 checkout 外运行，
  输出不引用 checkout 路径。

### T2 — 只读治理与 schema 回归

在安装布局运行 scan、probe、dashboard、trace status 和 doctor。

验收：JSON 可解析，schema 精确，doctor 能区分 selective install 下的
`hygiene: unavailable`；`normalized_content_sha256` 语义不退化；canary
inject/strip 逐字节恢复，且 Git Bash 权限边界保持 fail closed。

### T3 — Setup CLI

在 macOS 对安全 `PATH` 目录覆盖非 TTY preview → digest confirmation、TTY
exact digest、已有相同 launcher、无安全目录 fallback、冲突文件、FIFO、hardlink、
EOF、错误 digest 与 Ctrl-C。

验收：

- 非 TTY 第一步 exit `2` 且输出唯一 `skills-refiner.setup-cli.v1` JSON；第二步
  只接受绑定 source launcher、Node binary、destination 的精确 digest。
- 不修改 profile，不覆盖冲突，不接受非 regular/多 hardlink leaf；取消路径零写入。
- 成功 launcher 固定精确 Node 24；不安全或无法证明的清理结果按
  `blocked`/`recovery_required` 如实返回。
- 非 macOS 返回 exit `3`、`unsupported_platform`、零 mutation。

### T4 — Review 与显式决策

在已安装布局运行 `cleanup review --json`，基于同一
`review_fingerprint` 为每个 candidate 生成一个 `keep`、`later` 或 `retire`。

验收：

- 真实 live Review 包含本机已安装/分发 entry，并把 agent skill root 内的
  `authoring_source` 或 `unproven_installed_copy` 标为 review-only；source 永不
  进入可执行 mutation target。
- Portable/core contract fixture 另行证明一个显式 `outside_scope` 输入也只能
  review 且 fail closed；这不声称真实 scanner 会主动扫描 workspace source。
- 少一个 decision、重复 candidate、未知 action，或 decisions 与已保存 review 的
  fingerprint 不匹配都 exit `2`。已保存 review 与重新扫描的实时状态不匹配
  属于 drift，exit `10` 且零 mutation。
- Agent plan 默认不持久化 Keep；只有显式 `--persist-keep` 才写入
  `~/.agents/skills-refiner/cleanup/keep-decisions.json`。
- TTY 空输入为 Later；Inspect 不落 decision；Retire 还需 `apply <12 hex>`
  精确确认。

### T5 — macOS 单条目 transaction

用真实已分发 symlink 执行 review → decisions → plan → apply → status → undo。

验收：

- Plan/apply 都绑定精确 path、entry kind、filesystem identity、plan hash 与
  transaction id；drift exit `10`，restore conflict exit `21`。
- Apply 只移动 active entry 到
  `~/.agents/skills-quarantine/transactions/<id>/payload/`；source bytes、Git
  object 和 clean working tree 不变。
- 移走 installed helper source、使 compiler 不可用于重新编译后，status/undo
  仍使用同一 cache inode/mode/hash 并恢复原始 symlink raw target。

### T6 — 批次与恢复真相

覆盖多条目 plan 的 preflight、逐项 commit、首失败停止、lease/lock、fault
phase、status reconciliation 和独立 undo。

验收：

- 每个 item 是独立 transaction；第一项失败时后续零 mutation。
- 中途失败保留精确 `committed_transaction_ids`；已提交 prefix 可分别 undo。
- 无法证明 outcome 时 exit `20` 且 `mutation_outcome:"unknown"`，不得伪报
  unchanged 或整体成功。

### T7 — Post-apply rehydration

使用 `--post-scan` 覆盖 active entry 未重现、同 identity 重现、冲突 identity、
scanner/native observation 不可用与 race。

验收：每项只能是 `QUARANTINED`、`REHYDRATED`、`RESTORE_CONFLICT` 或
`INDETERMINATE`；始终提示 installer redeploy 与 running Agent cache；出现
rehydration 时包含 `automatic_requarantine_disabled`，且绝不自动再次隔离。

### T8 — 非 macOS mutation guard

在 Ubuntu/portable fixture 中使用 contract-valid review、decisions、plan 与
transaction id 执行 setup/plan/apply/status/undo。

验收：

- `setup-cli` exit `3`，返回精确 `skills-refiner.setup-cli.v1`；
  `status/overall_status:"unsupported"`、`mutation_occurred:false`、
  `mutation_outcome:"unchanged"`，且不创建 launcher。
- `plan`/`apply`/`status`/`undo` exit `3`，返回精确
  `skills-refiner.cleanup.error.v1`；除上述 mutation truth 外，还要求
  `transaction_has_mutated:false` 与空 `committed_transaction_ids`。
- active entry、source/link 与 transaction root 均不变；Review 仍 exit `0`。

### T9 — 静态与 Skill surface

验收：

- 所有 user-facing Bash launcher 有匹配 shell test；所有 `.mjs` test suite 由
  `node --test` 执行。
- Shell 文件通过 `bash -n` 与 `shellcheck --severity=error`。
- Native helper 通过 C17 `-Wall -Wextra -Werror -fsyntax-only`；macOS release
  gate 还包含真实编译和 fault tests。
- `skill-hygiene/SKILL.md` 的 frontmatter name/description 合法、description
  不超过 1024 chars、引用文件存在，并可被 repository scanner 读取。

## 四、CI gate 映射

`.github/workflows/governance-tests.yml` 当前配置：

1. macOS + Ubuntu：scan/debug integration、platform contract、cleanup
   contract/core/CLI、选择性安装布局、shell static checks，Node 24。
2. 仅 macOS：cleanup adapter/transaction 与 native helper compiler gate。
3. Windows Git Bash：既有 syntax、helper mirror、platform contract；不运行
   cleanup mutation。

任何 required job 失败都不得合入。不能把 Ubuntu portable CLI green 写成 Linux
mutation support，也不能把 Windows read-only green 写成 native Windows cleanup。

## 五、当前证据状态（2026-07-15）

- [x] 本机 macOS 27.0 arm64 / Node `v24.18.0`：选择性安装、真实
  review→plan→apply→status→undo、source Git 不变、helper cache continuity 已验证。
- [x] 本机：cleanup contract/core/CLI、adapter/transaction、shell static、native C
  compiler/static-analyzer gates 已验证。
- [x] Workflow 已配置 macOS/Ubuntu Node 24 分层 gates 与 Windows bounded gate。
- [ ] 当前 revision push 后的 `macos-latest` required job 结果。
- [ ] 当前 revision push 后的 `ubuntu-latest` required job 结果。
- [ ] 当前 revision push 后的 `windows-latest` Git Bash required job 结果。
- [ ] 故意破坏 installed layout 后确认 CI 变红的远端负验证；执行后必须还原，
  不得把破坏性样本提交到主干。

只有最后三类远端 job 对同一 committed revision 全绿，才能把本批次标记为
跨 runner 验收完成；cleanup mutation 的支持声明仍仅限 macOS。
