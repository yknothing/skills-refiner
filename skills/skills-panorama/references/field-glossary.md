# 字段对照

| 对人显示 | JSON 键 | 说明 |
|---|---|---|
| 身份 | `identity` | 名字、路径、内容指纹；可知时含仓库/版本 |
| 源目录里有没有 | `stored` | 全局源或物理集合中是否有实体 |
| 在哪个 Agent 里出现 | `projected` | **按 Agent 分列**，不是单个「已分发」布尔 |
| 控制清单是否批准启用 | `catalog_active` | `active` / `inactive` / `absent` / `unknown` |
| 链接是否完好 | `link_health` | `ok` / `broken` / `unexpected_target` / `not_applicable` / `unknown`；外部但可达仍是 `ok`，只有权威计划给出期望目标时才可判 `unexpected_target` |
| 同名记录与加载冲突 | `collision` | `none` / `conflict` / `unknown` |
| 缺口类（衍生） | `gap_class` | 八类中文名之一（稳定英文 id 见 gap-taxonomy）；由上表可逆推导 |

`identity.catalog_members` 保存受管 `INDEX.json` 声明的成员路径、tree digest 与 no-follow 存在性观察。它仍属于「身份」原子列，用于区分「集合成员未被 scanner 展开」和「声明路径真实缺失」。

`identity.variants[]` 是同名身份的精确事实面。每个 variant 单独保存 `entity_id`、仓库/修订/source path、canonical target、内容指纹、`catalog_active` 和 `catalog_conformance`。顶层 `catalog_active` 只有在所有 variant 一致时才复述该值；混合状态为 `unknown`，不会把一个仓库的批准误套到另一个同名仓库。`identity_status` 使用 `ambiguous_name`、`source_qualified`、`collection_qualified`、`path_qualified` 或 `unqualified`。

`identity.review_signals` 原样聚合 scanner 已给出的 `risk_indicators` 与 `hygiene_flags`；它是可追溯的治理复核证据，不参与八类拓扑缺口推导。`review_required` 只表示需要人工查看，不等于已确认漏洞。

`provenance_lifecycle` 是逐 identity variant 的来源、版本与生命周期观察面，不是新的事实源。每条 `observations[]` 都保留 `evidence_scope`、`evidence_state` 与 `content_binding`：

- `controller_verified` 只允许来自 schema、observer、状态 shape、operation/plan、source identity 与当前 `INDEX.json` 全部一致且 `FILESYSTEM_READY` 的 collection status；其上游版本 authority 为 `immutable_artifact_manifest`。
- `controller_observed_not_ready`、`controller_identity_mismatch`、`controller_contract_invalid`、`catalog_fallback` 与 `index_fallback` 均不得产生 `source_qualified` identity 或暴露 immutable revision。
- `installer_declared` 只是安装器 receipt 对时间的声明。只有 receipt key 与当前 frontmatter name 一致时才展示；`tree_unverified` 仍明确表示内容未绑定，不能写成已验证安装事件。
- `installer_declared_collection_aggregate` 是集合 receipt 的聚合历史，不代表单个成员的安装/更新时间。
- 同名多 variant 必须逐项保留，禁止把不同仓库的来源、版本或时间合并为一个值。

顶层 `managed_collections` 不是技能行的第七个布尔字段，而是集合控制面的独立状态：文件系统、运行时、上游版本证据与 issues 不得相互塌缩。

顶层 `runtime_truth_matrix` 按 Agent 将 `filesystem` / `deployment` / `catalog` / `body` / `route` / `context` 六层分开。`context.result=unverified` 时禁止推断目录索引已经节省 context；`cursor.deployment.result=observe_only` 也不得冒充已部署。

`provenance_lifecycle.variants[].observations[].installation` 保留每个入口的
`entry_kind`、`link_target`、`canonical_target` 和 `link_health`，直接来自扫描器。
软链接入口与它指向的实际文件目录是不同路径；`source.repository_id` 表示上游仓库，
缺失仓库信息不表示链接目标未知。`lifecycle` 时间只适用于该条记录对应的路径，
不能从目标目录复制为各软链接的创建时间。旧报告没有 `installation` 时保留未知，
不得仅凭路径不同推断它是软链接。

顶层 `collectors` 保存 `status`、`completeness`、`degraded_reasons` 与结构化 `blockers`。可解析的非零收集器输出会保留事实并标记 `DEGRADED`，CLI 返回 3。

## 禁止字段

不得出现：`installed`、`ready`，或任何把未知谓词塌缩成单一绿灯的汇总枚举。


`collision.status=conflict` 仅用于已获得同一宿主加载空间内冲突证据的情况。当前文件系统采集只能报告同名本地记录：`status=unknown`、`assessment=inventory_only`、`confirmation=null`，不能将源码目录、软链接或不同内容直接升级为命名冲突。`identity_status=ambiguous_name` 只表示报告中的名字对应多个本地身份，不表示宿主解析歧义。指向同一 canonical target 且内容相同的入口按一个 path-qualified identity 聚合，来源字段缺失不再拆分身份。

Scanner 的可选 `installer_source_claim` 保留安全读取、字段约束和当前 frontmatter 名称匹配后的安装来源声明；`confidence=installer_declared` 不证明当前内容匹配，不提供不可变修订，也不授予修改权限。全树核验通过后已有 `provenance.confidence=receipt_bound` 和 `mutation_provenance` 契约保持不变。Panorama 将未绑定的声明标为 `evidence_state.source=receipt_declared`；没有采集到来源不能表述为磁盘上没有安装记录。

安装声明与存储目录的 Git provenance 同时存在时，上游来源采用安装声明，原存储信息保留在对应 observation 的 `storage_provenance`。存储仓库的修订不能绑定到安装声明。`identity.review_signals.runtime_load_blockers` 仅转述 scanner 已确认失败的 `runtime_contract.load_blockers`，保留路径和验证方法；未知要求不升级为加载阻塞。
