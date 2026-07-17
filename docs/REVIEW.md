# 深度评审：`cee340e` 及之后提交（至 `150d029`）

**评审对象：** `cee340e5ca44d16e5d18bc8ff0f983c650535048..150d029`（含 `cee340e` 本身，共 7 个提交）
**评审重点：** ADR-0001 / ADR-0002 及其产物、对抗性评审包、验收记录、两个代码修复、全部待完成事项
**评审性质：** 独立于仓库既有 L1 自评审的外部视角；所有结论均附可复核证据（文件 + 行号 + 可复现实验）

---

## 一、总体结论（对三个核心问题的直接回答）

### Q1：是否偏离本仓库的定位与真实意图？

**结论：方向未偏航，但存在一条明确的、正在扩大的定位裂缝。**

方向上，这批提交与仓库的四条核心哲学（"AI judges, scripts collect"、fail-closed、保守默认、证据分级）高度一致，甚至是自我强化的：

- ADR-0001 主动**降级了本仓库自己的 canary 功能**（`skill-trace --inject`），承认其只是 L3 兜底而非计量产品。一个工具仓库愿意在 ADR 中削弱自己已实现功能的叙事地位，这是罕见且值得肯定的诚实。
- ADR-0002 的 "S0 诚实声明"（S1 落地前禁止声称节省 context）与 README 的统计准确性契约（exact / proxy / out-of-scope 三级）是同一种纪律。
- 两个代码修复（`cee340e`、`5cd2ace`）都是"宁可报 unknown 也不假装成功"的 fail-closed 修复，完全在定位内。

**裂缝在哪里：** 本仓库的公开定位是"任何人可安装的 skill 治理工具箱"（README、CONTRIBUTING、platform-support.md 均如此），但这批 ADR 产物把 **Owner 私人机器的部署实况**嵌进了公共仓库：

1. `docs/adr/artifacts/skills-pack-catalog.yaml` 是 Owner 个人机器上 129 个 skill 的完整清单（含 `ask-matt`、`talantsai-frontier-hard-task-design` 等明显个人化条目），它是一个**部署实例**，不是工具箱的**可复用契约**。
2. 两份验收记录的关键证据链大量指向仓库外、他人不可见的机器侧文件：`~/.agents/skills/POLICY-BS-CANONICAL.md`、`CONTROL-PLANE.md`、`SCALE-ANALYSIS-2026-07-17.md`、`DEBT-BACKLOG.md D-10`、`/tmp/skill-scan-acceptance.json`。对仓库读者而言，这些验收 PASS 是**不可复核的断言**。
3. `docs/adr/README.md` 约定第 2 条甚至规定"机器侧策略与仓库 ADR 冲突时以 Owner Decision 为准"——这把**公共仓库的架构权威让位给了私人机器**，与"仓库是 source of truth、安装是部署产物"（README Design principles）自相矛盾。

对抗性评审包自己也保留了这条分歧（`05-objections-and-disagreements.md` 第一条 preserved disagreement：catalog 应住在 repo 还是 `~/.agents`），说明团队已察觉但未裁决。**本评审的立场：必须裁决，且裁决方向应是"仓库持有 schema + validator + 标注清楚的示例实例；机器实例住在部署根"**（详见 §五 P1-2）。若不裁决，这个公共仓库会逐步滑向"Owner 的运维日志"，那才是真正的定位偏离。

### Q2：架构设计与实现质量是否守住了"极高质量、不妥协"？

**结论：架构设计质量守住了，且部分实践高于行业水准；实现与验证环节有 4 处未达仓库自己设定的标准。**

高于行业水准的部分：

- **对抗性评审包的方法论**：独立性等级显式标注（L1，禁止自称 independent）、claim ledger 带 reversal condition、falsification monitors、preserved disagreements、false-consensus probe。这套东西比绝大多数开源项目的"LGTM 合并"严格一个量级。
- **fail-closed 语义的一致性**：`5cd2ace` 中超界树只降级为 `unknown/truncated` 并留证据（`provenance_tree_too_large` / `provenance_tree_skipped`），tree hash 不匹配时不产生任何 `installed_copy` 判定（skill-scan.sh:553-566 落空即保持默认 unknown）——mutation 授权链没有被性能修复弱化。
- **`cee340e` 的取舍**：`com.apple.provenance` 从 relocation manifest 摘除但保留在 security digest 中（cleanup-macos-helper.c:667-716），"可观测性不丢、身份判定不脆"，注释把 kernel 副作用的因果写清楚了，是教科书级的 xattr 处理。

未达自身标准的 4 处（详见 §三、§五）：

1. **验收链的"可运行门禁"实际上没有进 CI**：`validate-skills-pack-catalog.mjs` 未出现在 `governance-tests.yml` 的任何 job 中，且它自身零测试覆盖——违反 CONTRIBUTING 自己的规则（"Run every `.mjs` test suite with `node --test`"）。验收记录声称 "Runnable gate executed"，但那只是 Owner 机器上的一次手工运行。
2. **手写 YAML 解析器有可复现的解析 bug**（`lines.indexOf(line)` lookahead，validate-skills-pack-catalog.mjs:125），本评审已构造最小复现（见 §三.5）。当前 catalog 恰好没踩中，属于"靠运气正确"。
3. **`cee340e` 的测试含一个恒真断言**（test-cleanup-macos.mjs:1478-1483）：`if (a !== b) { assert.notEqual(a, b); }` 是逻辑空操作，该分支实际什么都没验证。
4. **validator 的部署覆盖检查只在 Owner 机器上有牙齿**：deploy root 不存在时静默降级为纯 schema 检查并 PASS（本评审已实测：空目录 → `WARN` + `PASS` + exit 0）。"listed=129 deploy=129" 这条验收证据在任何其他环境都不可再现。

### Q3：还有哪些不足？

集中在三类：**验证闭环缺口**（validator 未 CI 化、无测试、恒真断言）、**边界治理**（repo vs machine 权威未裁决、验收证据不可复核）、**待办事项碎片化**（散落在 5 处、无统一台账、无触发条件跟踪）。逐条问题与修复最佳实践见 §五。

---

## 二、逐产物评审

### 1. `cee340e` — fix(macos): provenance-only xattr 下保持 relocation 身份稳定

**判定：设计正确，测试有一处实质缺陷。**

- ✅ 正确识别了根因：macOS 内核可能在 rename 进 quarantine 时写入/改写 `com.apple.provenance`，若 manifest digest 含该 xattr，干净 symlink 会在事务中途变得不可 reconcile。
- ✅ 双 digest 分离（manifest 排除 / security 保留）是正确的最小修复；`xattr-empty` 哨兵（helper.c:713-715）保证 "只有 provenance" 与 "无 xattr" 摘要相等，且哨兵仅在 `manifest_xattr_count == 0` 时写入，无域混淆。
- ⚠️ **恒真断言**（test-cleanup-macos.mjs:1478-1483）：注释解释了为何不能无条件断言 security digest 变化（`/bin/ln` 在 provenanced 进程树中可能已带 kernel provenance），但落地成 `if (a!==b) assert.notEqual(a,b)` 后该分支为空操作。正确写法：读回 xattr 实际状态（`listxattr` 是否新增了该 key / value 是否变化），据实际观测状态做条件断言；若无法稳定观测，删掉该块并把原因留在注释里——**假装在断言比不断言更差**，它会让后续维护者误以为该性质已被覆盖。
- ⚠️ **排除策略是单点特判而非命名策略**：`strcmp(names[index], "com.apple.provenance")`（helper.c:685）。`com.apple.macl` 等其他 kernel 管理的 xattr 具有同类"系统随时改写"性质，下一次同类故障仍需改 C 代码 + 发版。建议将"manifest 排除名单"提升为文件顶部的命名常量数组并附排除准则注释（什么性质的 xattr 允许进入名单：仅限内核自主写入、非用户内容语义的元数据），本次可只含 provenance 一项——这不是过度设计，是把已发生过一次的故障模式收敛为可审计的策略点。

### 2. `5cd2ace` — fix(scan): 有界化 installer provenance tree hashing

**判定：正确的 fail-closed 修复，边界选择有一个已知残留风险。**

- ✅ 三态清晰：skip flag → `provenance_tree_skipped`；超界 → `provenance_tree_too_large`；两者均为 `kind:unknown, confidence:truncated`，不授权 mutation。验收记录也明确 non-claim（"skip 不证明 installer tree 完整性"）。
- ✅ 测试构造 401 个文件精确压边界（limit+1），并同时覆盖两种降级证据形态。
- ⚠️ **界是文件数界，不是字节/时间界**：≤400 个文件但含超大文件（如打包资产）的 skill 仍可能让 `git write-tree` 变慢。原故障是"stall 整机 inventory"，文件数只是 stall 的一个代理变量。建议 S 级补强：对 `git_tree_hash_for_directory` 外包一层 `timeout`（或增加 `MAX_PROVENANCE_TREE_BYTES` 用 `du` 预检），超时同样落 `unknown/truncated` 并留 `provenance_tree_timeout` 证据。
- ℹ️ `count_tree_files_bounded` 中 `find ... 2>/dev/null` 吞掉权限错误可能低估文件数——但后续 write-tree 的 hash 必须精确等于 receipt 中的 `skillFolderHash` 才授出 `installed_copy`，权限残缺的树只会 hash 不匹配而回落 unknown，**不会产生假阳性授权**。此点无需修复，建议在函数注释中写明这一安全论证，防止后人"修复"它。

### 3. ADR-0001 — 非侵入式 Skill 用量观测

**判定：本批次质量最高的单一文档。决策结构、非目标、隐私门禁、明确不保证（B.7）都到位。问题集中在可维护性与证据可追溯性。**

- ✅ L0-L3 分层降级 + "计量边界在宿主运行时" 是正确的架构押注；把 `OTEL_LOG_TOOL_DETAILS` 从遥测总开关中拆出为**单独同意门禁**（第 98 行）直接回应了 Challenger O2，是对抗性评审真实改变了产物的证据。
- ⚠️ **平台能力快照会腐烂且无再验证机制**：快照表标注了 as-of 日期，但没有 review-by 日期、没有负责人、没有触发条件（如 "Codex 发布 PreSkillUse hook 时必须修订"）。厂商能力表是全文档中半衰期最短的部分。最佳实践：给快照表加一行 `Review-by: YYYY-MM-DD 或事件触发（列明事件）`，并把它登记进统一待办台账（见 §四）。
- ⚠️ **References 无 URL、无版本锚点**：`docs/adr/README.md` 约定第 3 条要求"引用外部能力时必须标注版本/门禁假设"，正文表格做到了门禁假设，但 References 节只有裸名称。对一个以"证据分级"为纲领的仓库，引用应可点击、可存档（建议附抓取日期，evidence-map 已有 "docs fetch 2026-07-17" 的先例，把它带进 ADR 本体）。
- ⚠️ **Appendix B 是"文本上可执行"而未执行**（验收已诚实声明）。但 B.6 验收探针停留为散文，最佳实践是把它变成 `docs/adr/artifacts/` 下的一个最小脚本或 checklist 文件，使"Owner 首次跑通 Appendix B"这条待办有明确的完成判据与落点（当前它只活在验收记录的 "Next recommended proofs" 里，极易蒸发）。
- ⚠️ 文字缺陷：第 53 行 "红acted"（"redacted" 混入汉字）；Related 指向机器侧 `DEBT-BACKLOG.md D-10`，仓库读者不可见（归入 §五 P1-3 统一解决）。

### 4. ADR-0002 + `skills-pack-catalog.yaml` — 目录级渐进披露

**判定：问题识别（description 路由税）与分期纪律（S0-S4 + 诚实声明）优秀；产物形态是本批次最大的架构争议点。**

- ✅ Binding rule 2（禁止"超级索引 skill"抄全量 description——税换抽屉）是真正的架构洞察，值得保留为长期红线。
- ✅ `residual_library` 显式标注 `debt: split_before_stable`，没有假装 50 个 skill 的垃圾桶是稳定分类。
- ⚠️ **实例 vs 契约混淆**（§一 Q1 已述）：catalog 是 Owner 机器实例。除定位问题外还有两个具体代价：(a) 轻度隐私泄漏——个人工作流全景（含私人 skill 名）进入公共仓库；(b) 任何人 fork 本仓库后，validator 的 membership 检查对他必然是 WARN-only，仓库声称的"门禁"对外部使用者为空。
- ⚠️ `constants` 块声称 "no magic strings in consumers"，validator 确实消费了 mount 枚举，但 `debt`、`purpose`、`references` 等字段无任何 schema 校验；`targets.description_budget_tokens_max` 声明了却不可校验（Challenger O6 已指出，可接受，但建议在 catalog 注释中标注 "declared, not validated"，与仓库"不假装验证过"的风格对齐）。
- ℹ️ 文字：第 77 行 "Catalog  alone" 双空格。

### 5. `validate-skills-pack-catalog.mjs` — 校验门禁

**判定：意图与细节（home 路径脱敏、重复成员检查、fail 汇总输出）都好；但作为"门禁"它有三个实质缺陷，是本评审最重要的发现。**

**(a) 未接入 CI。** `governance-tests.yml` 全文无 validator 调用。验收记录 A 节声称 "Runnable gate executed"，实为 Owner 机器一次性手工运行。一个不在 CI 里的门禁会静默失效——这恰是 `docs/verification/...acceptance.md` 自己列的 falsification monitor #3（"validator fails and is ignored"）最可能的实现方式。

**(b) 门禁强度依赖运行环境且静默降级。** 本评审实测：`SKILLS_DEPLOY_ROOT=<空目录> node validate-...mjs` → `WARN deploy root empty` + `PASS` + exit 0。即：在 CI/他人机器上，membership 检查自动失牙，只剩 schema 检查，且以 PASS 报告。门禁的正确姿态是**显式声明本次运行验证了什么等级**（如输出 `gate_level: schema-only|full-membership`），或提供 `--require-deploy` 使 CI 可以选择 fail-fast。

**(c) 手写 YAML 解析器有可复现 bug。** 第 125 行用 `lines.indexOf(line)` 做 lookahead 定位当前行——当文件中存在**内容完全相同的空值键行**（如两个缩进相同的 `skills:`）且其后继结构不同（一个接 list、一个接 map）时，第二次出现会取到第一次出现的下一行，误判 list/map。最小复现（本评审已运行验证，两个方向均误判后抛出）：

```yaml
a:
  skills:
    - one
b:
  skills:
    key: value      # → 抛 "map key under non-map"（实为合法 YAML）
```

当前 catalog 未踩中仅因所有同名 `skills:` 恰好都接 list。该 bug fail-loud 不 fail-silent（会抛错而非错读），故降为 P2，但"门禁自身靠运气正确"不可接受。**修复：** 在 `for` 循环中携带行号索引（`for (let i = 0; i < lines.length; i++)`），lookahead 用 `i+1` 起扫——5 行改动，无需引入依赖。是否改用真 YAML 库是次要问题（仓库零依赖策略可以理解），索引 bug 必须修。

**(d) 零测试覆盖。** CONTRIBUTING:73-74 要求 "Run every `.mjs` test suite with `node --test`; any cleanup `.mjs` behavior change must add or update focused node:test coverage"。validator 不是 cleanup 模块，但它是唯一被验收记录引用为 gate 的脚本，按仓库自己的精神（"每个 bin/ 脚本有配套测试"）应有 `tests/`：至少覆盖合法 catalog PASS、重复成员 FAIL、缺 top-level key FAIL、deploy root 缺失 WARN、以及 (c) 的解析回归。

### 6. 对抗性评审包 ×2 + 验收记录 ×2

**判定：方法论是本仓库的护城河级资产；两个执行层缺口。**

- ✅ L1 独立性诚实（同 session、承认污染、禁止 L3 措辞）、O1-O6 每条有 severity/resolution/remaining-risk/veto 字段、false-consensus probe——这套结构建议原样固化为模板。
- ⚠️ **falsification monitors 无 owner、无自动化**：4 条 monitor（observability 包）+ 4 条（bs-canonical 包）全部是散文。monitor #3（validator 失败被忽略）可直接 CI 化（即 §五 P1-1）；其余至少应登记进待办台账并指定检查节律。**没有执行机制的 falsification monitor 只是修辞。**
- ⚠️ **bs-canonical 验收的证据不可复核**：P0-2 至 P2-10 的证据几乎全部是机器侧路径（`~/.agents/...`、`/tmp/skill-scan-acceptance.json`）。仓库内验收文档引用仓库外易失证据，等于要求读者信任而非复核。最佳实践：验收时把关键证据的**脱敏快照**（如 readlink 输出、scan JSON 的裁剪片段、计时结果）附拷进 `docs/verification/` 同目录，或在证据列显式标注 `machine-attested, not repo-verifiable`，二选一，不要留在中间态。
- ℹ️ 何时必须升级到 ≥L3 评审：两份包都说"org 推广需 L3+"，但仓库没有一条规则定义**哪些类型的变更强制 L3**（例如：扩大 mutation 支持矩阵、修改事务/quarantine 语义、对外声称统计能力升级）。建议在 `docs/adr/README.md` 约定中补一条触发清单，避免"每次都由当事 session 自行判断是否需要独立评审"的利益冲突。

---

## 三、待完成事项审计

### 当前分布（碎片化是问题本身）

| # | 事项 | 当前唯一记载处 | 有完成判据? | 有触发/期限? |
|---|---|---|---|---|
| 1 | S1 mount 工具（按 profile 增删发现面 symlink） | ADR-0002 stages 表 | 部分（token before/after 实验，O1） | 无 |
| 2 | S2 会话短索引 / router meta-skill | ADR-0002 stages 表 | 无 | 无 |
| 3 | S3 用 ADR-0001 信号修订 Core（O3 未决） | ADR-0002 + objections O3 | 无 | 无 |
| 4 | S4 拆分 `residual_library`（O4 未决） | ADR-0002 + catalog `debt` 字段 + monitor #4 | 无 | monitor 有条件但无人执行 |
| 5 | Appendix B 首次 e2e 捕获 + 脱敏样本归档 | 验收记录 "Next recommended proofs" | 有（B.6 五步） | 无 |
| 6 | repo vs machine catalog 权威裁决 | preserved disagreement #1 | 有（首次 S1 mount 用哪份输入） | 无 |
| 7 | Windows 原生 cleanup 适配器 | platform-support.md Recorded follow-ups #1 | 有 | 无 |
| 8 | WSL 专用 runner | 同上 #2 | 有 | 无 |
| 9 | Git Bash symlink/junction fixture | 同上 #3 | 有 | 无 |
| 10 | 新 macOS release/arch 证据后才扩支持声明 | 同上 #4 | 有 | 事件触发（清晰） |
| 11 | evals 自动化 runner（当前非 CI 门禁） | CONTRIBUTING:113 | 无 | 无 |
| 12 | 平台能力快照再验证（Codex hooks 等） | 无处登记（本评审新增） | — | — |
| 13 | falsification monitors 的执行归属 | 无处登记（本评审新增） | — | — |

**评价：** 每一条单看都有诚实的记载（这比多数项目好），但它们分散在 5 类文档中，无编号、无状态、无 owner。对一个以"治理 silent decay"为使命的仓库，**自己的待办正处于它警告用户的那种衰减模式**。另有部分待办只存在于机器侧 `DEBT-BACKLOG.md`（仓库读者不可见），例如 D-10。

### 待办内容本身的评价

- 排序合理：S1 是唯一能兑现 ADR-0002 价值主张的项，位置正确。
- 无发现"该列而未列"的重大缺项，除两条：#12（快照腐烂）与 #13（monitor 归属）——均为元层缺口，已补入上表。
- S1 实施前建议先裁决 #6（disagreement #1），否则 S1 工具的输入源本身是悬案，做完还要返工。

---

## 四、问题清单与修复最佳实践（按优先级）

> 本节只给方案，不改代码（按约定）。P0 = 立即；P1 = 下一个工作批次；P2 = 随缘但登记台账；P3 = 记录即可。

### P0 — 无

没有已合入的正确性回归或安全弱化。两个代码修复本身质量达标。

### P1-1 把 validator 变成真门禁（对应 §二.5 a/b/d）

1. `governance-tests.yml` 增加 step：构造一个 fixture deploy root（用 catalog 中任取若干名字建 `SKILL.md` 目录，或提供 `--schema-only` 模式），运行 `node docs/adr/artifacts/validate-skills-pack-catalog.mjs`，非零即红。
2. validator 输出增加显式 `gate_level`（schema-only / full-membership），空 deploy root 时不再无差别 PASS；新增 `--require-deploy` 供强模式使用。
3. 补 `node --test` 测试套件（PASS / 重复成员 / 缺键 / 空 deploy / 解析回归）。
4. 完成后，验收记录中 "Runnable gate executed" 才与事实相符；同时天然实现了 falsification monitor #3。

### P1-2 裁决 repo vs machine 的 catalog 权威（对应 §一 Q1、待办 #6）

推荐裁决：**仓库持有 schema 定义 + validator + 一份明确标注 `example instance` 的小型示例 catalog；Owner 的 129-skill 实例迁至部署根（`~/.agents/skills/skills-pack-catalog.yaml`），validator 通过 `SKILLS_DEPLOY_ROOT` 同时支持两侧。** 以 ADR-0003（或 ADR-0002 amendment）记录，同时修订 `docs/adr/README.md` 约定第 2 条——公共仓库的架构文档不应默认让位于私人机器。此举一并解决：定位裂缝、隐私泄漏、fork 用户门禁失牙三个问题。

### P1-3 建立单一待办台账（对应 §三）

新建 `docs/BACKLOG.md`：单调编号（B-1…）、来源文档链接、完成判据、触发条件/期限、状态（open/blocked/done + 日期）。首批内容即 §三 表格 13 项。规则写进 CONTRIBUTING：任何 ADR stages 表、验收 "next proofs"、platform-support follow-ups 新增项必须同步登记。机器侧 `DEBT-BACKLOG` 与仓库台账各管各的资产，交叉引用编号即可，不要求合并。

### P1-4 修复恒真断言（对应 §二.1）

test-cleanup-macos.mjs:1478-1483：读回 xattr 实际状态后做真实条件断言，或删除该块并注释说明不可稳定断言的原因。禁止保留形式化断言。

### P2-1 validator 解析器索引 bug（§二.5 c）

`for` 循环携带索引，lookahead 从 `i+1` 起扫。连同 P1-1 的解析回归测试一起交付。

### P2-2 provenance hashing 的时间界（§二.2）

`git write-tree` 外包 `timeout`（或加字节界预检），超时落 `unknown/truncated` + `provenance_tree_timeout` 证据。在 `count_tree_files_bounded` 注释中写明"权限错误低估不构成假阳性授权"的安全论证。

### P2-3 ADR-0001 可维护性（§二.3）

平台能力快照加 review-by/事件触发；References 补 URL + 抓取日期；修正 "红acted"；Appendix B.6 落为 artifacts 下的 checklist/脚本文件；仓库内不可见的机器侧引用（DEBT-BACKLOG D-10）改为台账编号引用。

### P2-4 xattr 排除策略常量化（§二.1）

`com.apple.provenance` 特判提升为命名排除名单常量 + 准入准则注释，为 `com.apple.macl` 类后续故障留下不改逻辑只改名单的通道。

### P2-5 验收证据可复核化 + L3 触发清单（§二.6）

验收文档的机器侧证据附脱敏快照或标注 `machine-attested`；`docs/adr/README.md` 增补"强制 ≥L3 评审的变更类型清单"。

### P3 — 记录即可

- ADR-0002:77 双空格；catalog 中 `description_budget_tokens_max` 旁注 "declared, not validated"。
- 对抗性评审包结构固化为 `docs/adversarial-product-pk/TEMPLATE/`，防止下次包结构漂移。

---

## 五、明确不是问题的点（避免误修）

1. **catalog 覆盖 129 个非本仓库 skill 名** 不是 validator 的 bug——validator 的 membership 语义本来就是对 deploy root 的核对；问题只在实例存放位置（P1-2）与 CI 语义（P1-1）。
2. **`--skip-provenance-tree` 弱化完整性** 已被验收 non-claim 明确覆盖，且不影响 mutation 授权链，无需再加强。
3. **L1 自评审** 对 S0 文档类交付是可接受的独立性等级，已诚实标注；问题只是缺少"何时必须 L3"的规则（P2-5），不是这两次评审本身不合格。
4. **`lib/common.sh` 双份镜像** 是被 CI `cmp` 门禁强制的刻意设计（selective install 自包含），不是重复代码坏味道。
5. **evals 不进 CI** 是 CONTRIBUTING 已声明的现状（anchor-based 人工评审），登记台账（#11）即可，不必急于自动化。

---

## 六、结语

这批提交的核心资产不是 ADR 的具体结论，而是它建立的**决策纪律**：分级独立性、claim ledger、S0 诚实声明、fail-closed 一致性。守住这套纪律的方式，是把它从"散文承诺"变成"机器强制"（P1-1）并把权威边界裁决清楚（P1-2）。当前最大的风险不是任何一行代码，而是：**验收链引用了一个不在 CI 里、没有测试、在他人机器上自动失牙的门禁，而所有人都以为它在站岗。**
