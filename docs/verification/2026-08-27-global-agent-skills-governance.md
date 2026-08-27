# 全局 Agent Skills 治理与 skills-refiner 实机验收

- **Date:** 2026-08-27
- **Scope:** repository `main@4a6a034ee295811a9b614dfa8fc15deb77a15ac9` + `/Users/whatsup/.agents/skills` + 22 个实际 Agent roots
- **Decision:** **accept-with-limitations**
- **Review level:** 实机证据验收；复用既有 ADR/L2 设计评审结论，本轮不冒充新的外部独立审计

## 1. 结论

本轮同时完成了两件事：

1. 建立并实际运行了面向全局 Agent Skills 的统一只读管理视图；
2. 用真实的 Better Skills 升级、全局五 Skill 发布、全量扫描与故障暴露，反向修复了最新版 skills-refiner 的集合事务、扫描器、全景报告和发布契约。

当前全局事实为：148 个唯一 Skill、537 个 Agent 投影、0 个断链、0 个静态运行时阻断、0 个 frontmatter/描述长度/本地引用错误。四个受管集合均为 `FILESYSTEM_READY`，但运行时仍诚实标记为 `UNVERIFIED`。全景中的 4 个同名异内容冲突和 5 个静态安全复核信号被保留为治理事项，没有自动删除或替用户裁决。

## 2. 唯一事实源与派生状态

本机制不把单个 lock 文件提升为唯一事实源，而是明确区分四层事实：

| 层 | 角色 | 本轮证据 |
|---|---|---|
| 上游 Git revision / release field | 内容权威与版本权威 | exact 40-character revision；版本只从上游声明字段提取 |
| `/Users/whatsup/.agents/skills` | 当前物理安装事实 | no-follow 扫描、内容摘要、集合 INDEX 与目录后置条件 |
| `.skill-lock.json` | 外部安装器历史收据 | 收据必须与当前 tree hash 绑定后才作为 direct provenance |
| `skills-panorama` | 可重建的治理视图 | 每次从当前磁盘、收据、Agent roots 和集合状态重新生成 |

因此：手工删除或修改 Skill 后，物理扫描和集合 observer 会立即产生 missing/drift；旧收据不能覆盖当前磁盘事实；删除派生报告后可以重新生成。GitHub 上游是内容权威，但“最新 commit”不自动等于合格版本，必须先固定 revision、通过 qualification，再进入事务化升级。

## 3. 实机现状

### 3.1 全局拓扑

| 指标 | Result |
|---|---:|
| 实际 Agent roots | 22 |
| `/Users/whatsup/.agents/skills` entries | 71（70 directory + 1 symlink） |
| 唯一 Skills | 148 |
| Agent projections | 537 |
| broken symlinks | 0 |
| scanner native name collisions | 2 |
| panorama enriched name collisions | 4 |
| runtime load blockers | 0 |
| missing name/description | 0 |
| description length violations | 0 |
| referenced-file findings | 0 |

### 3.2 受管集合

| Collection | Revision | Upstream version | Members | Filesystem | Runtime |
|---|---|---|---:|---|---|
| ProdCraft | `fd05978dbbbf5a064205a695af47c8a550f1b224` | `1.0.0` from `manifest.yml` | 40 | `FILESYSTEM_READY` | `UNVERIFIED` |
| Better Skills | `b5d0005aebb2bd8fcfb7389ab85d1f03f75b915d` | `0.2.0-dev` from `skills.json` | 12 | `FILESYSTEM_READY` | `UNVERIFIED` |
| LangCraft | `fa31c4b85a7400c53abee3bd19c278395a0df3fa` | `not_declared` | 6 | `FILESYSTEM_READY` | `UNVERIFIED` |
| LoopOS | `f4454019414143e976edac5a250eca58d92ed12d` | `0.2.1` from `pyproject.toml` | 10 | `FILESYSTEM_READY` | `UNVERIFIED` |

这些版本均来自固定 upstream artifact，没有为已安装 Skill 自行定义版本。`skills-refiner.collection.status.v1/v2` 是控制器响应 schema，不是 Skill 版本。

### 3.3 全景缺口

| 缺口类 | Count | 解释 |
|---|---:|---|
| 链接损坏 | 0 | 无失效投影 |
| 命名冲突 | 4 | `brainstorming`、`impeccable`、`onboard`、`review` |
| 清单与现实不符 | 0 | 当前批准成员与目录事实一致 |
| 部分 Agent 已出现 | 69 | 未投影到全部 22 个 roots，不等于损坏 |
| 仅在 Agent | 78 | Agent 自带/插件/其他来源，不自动清退 |
| 仅在源目录 | 66 | canonical 有内容但未投影到所选全部 Agent |
| 暂无法判定 | 0 | 无 |
| 齐全 | 0 | “齐全”要求覆盖全部 22 个实际 roots |

`齐全=0` 是严格的跨 Agent 覆盖语义，不是“全部 Skill 都坏了”。后续应按 Agent 的真实 loader 与需要建立投影策略，不能为了把数字变绿而盲目全量投影。

### 3.4 待人工治理项

静态扫描保留 5 个 review-only 信号：

- `origin`: `pipe_to_shell`，存在真实 `curl ... | sh` 供应链复核点；
- `openclaw-jarvis-ops`、`pdf`: `dangerous_cmd`，属于带 `sudo` 的运维/安装说明，需结合用途审核；
- `playwright-cli`、`sdk`: `possible_secret`，当前命中 mock/placeholder 示例，不能直接定性为泄密。

四个命名冲突也只报告、不自动裁决。尤其同名 Skill 来自不同仓库时，它们可以是两个合法产品；治理机制必须保留 qualified identity，而不是按 basename 清退。

## 4. Better Skills 真实升级

本轮不是只更新管理记录，而是把物理集合升级为 upstream 当前 12 个 `bs-*` members：

```text
bs-prdefine
bs-insight-product
bs-prospect-customer
bs-ui-master
bs-prose-master
bs-sw-master
bs-reflect-loop
bs-skill-auditor
bs-skill-forge
bs-social-card
bs-visual-article
bs-ppt-master
```

- operation: `better-skills-eed368bd7ae9`
- plan: `skills-refiner.collection.plan.v4`
- plan hash: `sha256:eed368bd7ae9041184a07e9079c80f23656aa653c802a0cd15f65a06da16fa89`
- recovery: `/Users/whatsup/Library/Application Support/skills-refiner/recovery/operations/better-skills-eed368bd7ae9`
- quarantine: `/Users/whatsup/.agents/skills-quarantine/collections/better-skills-eed368bd7ae9`

旧混合集合没有被不可逆删除。事务只收养 exact candidate-owned member 或 allowlisted metadata；未知额外文件 fail closed。上游从 `skills/<member>` 布局物化为集合平铺布局时，仅对已声明 packaging inputs 中、可闭包解析的本地 Markdown 引用做确定性重定位；不做通用文本修补。

## 5. 真实验证发现并修复的产品缺陷

### 5.1 Managed collection

- 旧 plan 无法安全接管已存在但可证明同源的目标；V4 增加受限 adoption 和 predecessor exact recovery。
- 旧目录布局升级后 Markdown 相对引用可能失效；增加可证明闭包的确定性 relocation。
- Agent root 历史上存在、当前已消失时会产生伪 drift；observer 现跳过已消失的历史 roots。
- quarantine 安全元数据不再依赖易漂移 inode identity。

### 5.2 Scanner 与 panorama

- 大 JSON 使用立即 `process.exit()` 会截断 stdout；改为 `process.exitCode`。
- nested collection member 被误判 missing；现按 INDEX exact path no-follow 读取。
- 可达 external symlink 被误判 broken；现区分 raw target 与 canonical target。
- `--agents all` 曾被当成 literal root，导致静默扫描空集合；现展开实际 topology，并明确排除 canonical `.agents/skills`。
- collision 仅按声明名会漏报；现结合 canonical target 与 content fingerprint 增强。
- fenced/inline code 中的负例 `@path` 曾产生伪 broken reference；现只提取 active Markdown reference。
- 静态风险信号进入结构化 `identity.review_signals`，但不污染 topology gap，也不冒充已确认漏洞。

### 5.3 Repository packaging

- 仓库已有第五个 `skills-panorama`，安装文档和测试仍声称四个 Skill；已统一为五 Skill 发布契约。
- `skill-debug/lib/common.sh` 缺少动态 Agent-root discovery；已与 `skill-hygiene/lib/common.sh` 同步且四份文件 SHA-256 完全一致：`60f89e1304e8f264e8bf39ba17e5a1fa9700a782f566479a658e9b67279f1f71`。

对应提交已推送到 `origin/main`：

1. `2809ac3 feat(collections): harden current Better Skills upgrades`
2. `4111b25 fix(panorama): report complete global skills truth`
3. `4a6a034 fix(packaging): align the five-skill install contract`

## 6. 五个仓库 Skill 的全局发布与溯源

已通过 GitHub source 安装/更新：`skill-debug`、`skill-hygiene`、`skills-appreciation`、`skills-panorama`、`skills-refiner`。当前 `.skill-lock.json` 为 schema v3，五条记录均指向 `yknothing/skills-refiner`，完整扫描把它们判定为：

```text
mutation_provenance.kind       = installed_copy
mutation_provenance.confidence = direct
evidence.kind                  = content_bound_installer_receipt
```

收据 tree hash 与当前目录一致：

| Skill | tree hash |
|---|---|
| `skill-debug` | `bb97cc6140248ce7d380182d7cf024b35b57e734` |
| `skill-hygiene` | `950f30ca52137e8cd96f5a5210434c3fb70d6862` |
| `skills-appreciation` | `555ddab2404f3176581da8ec9b8941d69f25c634` |
| `skills-panorama` | `3a91891b9b4a00a67913eb99a72cc2e68533ee1a` |
| `skills-refiner` | `f1e0ef8329096347576f78cfafe48c1daf337281` |

仓库与全局 runtime payload 的 `diff -qr` 唯一差异是未安装 `skills/skills-panorama/tests/fixtures`；其余文件一致。该差异属于测试 fixture 的发布边界，不影响 Skill runtime payload，但不得把它写成整个仓库目录的 byte-for-byte mirror。

## 7. 验证矩阵

| Gate | Result |
|---|---|
| scanner suite | 103/103 PASS |
| panorama unit | 16/16 PASS |
| panorama CLI | 18/18 PASS |
| managed collection | 51/51 PASS |
| collection contract | 4/4 PASS |
| collection CLI | 4/4 PASS |
| global installed layout | 146/146 PASS |
| platform contract | 26/26 PASS |
| doctor smoke | PASS |
| changed shell scripts | shellcheck PASS |
| full provenance scan | 148 Skills；0 broken；0 runtime blocker；0 frontmatter/reference failure |

一次 216-test 聚合运行得到 212 PASS / 4 FAIL：其中 1 项为 Better 旧 8-member / plan.v3 断言，更新为真实 12-member / plan.v4 后 focused 4/4 PASS；另 3 项是 sandbox 下 Unix socket、`hdiutil`、`clang` 临时目录权限失败，脱离 sandbox 的对应 4 项原生测试 4/4 PASS。没有用 mock 替换被测控制器来制造绿灯。

本轮没有注入或删除 canary，也没有通过清理现场文件来制造通过结果。

## 8. 正式治理产物

```text
/Users/whatsup/Library/Application Support/skills-refiner/panorama/latest.json
/Users/whatsup/Library/Application Support/skills-refiner/panorama/latest.md
```

生成时间：`2026-08-27T08:14:34Z`。证据摘要：

| Artifact | SHA-256 |
|---|---|
| `latest.json` | `fa040bcced8bece34f85087a6146cc26b42eef297bf4ac486c85a3e254e979dc` |
| `latest.md` | `81ef357a582e0ddf655cb7c73d9a24148549641a7d24c43bd5d629493ad9a8fc` |
| `.skill-lock.json` | `492b4e4307b7411f5a698f9ee8101be43a4282ab46980b57def3b0dd1fe11db8` |

## 9. 明确非宣称与后续门禁

- 当前 session 的静态 preflight 为 0 blockers，`npx skills` 可枚举五个仓库 Skill；但未刷新所有 Agent host/cache，因此不把 4 个 collection 的 runtime 写成 PASS。
- 未测量 context-window token reduction；物理目录索引带来的管理收益不等于已证明 token 节省。
- 没有把 4 个 name collisions 自动清退；需按来源、内容、目标 Agent 和用户意图做 disposition。
- 5 个静态安全信号只是 review queue，不是 5 个已确认漏洞。
- `partial`、`agent-only`、`source-only` 需要逐 Agent 的明确投影策略，不能以“全部变绿”为目标盲目复制。

建议后续按以下顺序推进：

1. 在 fresh Codex/Claude/Cursor 等真实宿主会话验证受管集合的 discoverability，并把 runtime evidence 独立写回；
2. 对 4 个冲突建立 qualified disposition，默认 preserve；
3. 人工复核 5 个静态安全信号，确认后再决定修复或 allowlist；
4. 为各 Agent 建立最小必要 coverage policy，使“缺口”变成显式 desired state，而不是由全量投影隐式决定。
