# 00 — Evidence Map

- **Date:** 2026-08-28
- **Decision target:** ADR-0008 implementation and live global Skills governance
- **Implementation baseline:** `0d2b853..e680b8d`
- **Live target:** `$HOME/.agents/skills`
- **Review level:** L2 Agent-separated；不是外部审计、多模型独立认证或形式化验证

## 权威与证据等级

| Claim | Authority | Current evidence | Boundary |
|---|---|---|---|
| Skill 内容 | immutable Git object + artifact tree | 四个 active plan、INDEX、实际树摘要 | local origin-tracking containment，不是在线远端实时证明 |
| 上游版本 | immutable artifact 内的 manifest | ProdCraft `1.0.0`、Better `0.2.0-dev`、LoopOS `0.2.1`、LangCraft `not_declared` | 不用 controller/schema 版本补造 |
| 本机批准 generation | active record + exact plan + operation | 四个 collection operation 与 runtime profile operation | operation 证明机器 hash gate，不单独证明 human review |
| 当前磁盘 | fresh no-follow observation | 四组 `FILESYSTEM_READY`、full `skill-scan.v7` | 磁盘状态不证明 runtime body/route |
| installer 历史 | content-bound receipt claim | `.skill-lock.json` v3 tree/source/path claim | 时间是 installer-declared；`resolved_revision=null` |
| Agent 发现 | fresh native probe | Codex/Claude catalog、Cursor status probe | catalog 不证明 body/route/context |
| 全局总览 | 可重建派生视图 | Panorama v2 | 不是 writer，不授予 cleanup authority |

## Active generation locator

| Surface | Operation | Exact plan hash | Revision / policy |
|---|---|---|---|
| ProdCraft | `prodcraft-cdbfdef5b445` | `sha256:cdbfdef5b445b4b937d9397e505345753c9c02c54436385a12e76c6c1c8faf93` | `fd05978dbbbf5a064205a695af47c8a550f1b224` |
| Better Skills | `better-skills-627a600ad94b` | `sha256:627a600ad94b3284e6cfd8f08645d4a423d1da9ee7e8ceff9da1e3705a084d0d` | `2198c88d55383f97e47ea51d914dc7703051091b` |
| LoopOS | `loopos-43762096a5d3` | `sha256:43762096a5d3e8c1e13558687b5580323778564a9c0287251ad8b33b4991a9a4` | `f4454019414143e976edac5a250eca58d92ed12d` |
| LangCraft | `langcraft-1cd7aae0f9ee` | `sha256:1cd7aae0f9ee8144210d58ec65710eb2ca8433191d7355dcea99ee6656aef8b8` | `fa31c4b85a7400c53abee3bd19c278395a0df3fa` |
| Runtime profile | `runtime-profile-a26f9a00fcfd` | `sha256:5f5c558c0e0b991d2146d7daa9faa4024f88d53836e4f37b1f538df248ba164f` | 53 Codex disabled members、16 Claude projections、Cursor observe-only |

## Durable local artifacts

Owner-private evidence is mode `0600`. Repository docs store only schema/id/digest summaries and never copy raw host paths.

| Artifact | Identity / digest |
|---|---|
| ProdCraft active plan | file SHA-256 `6ede90f87c20e759fc262f896670e28d39fd7fec619ea18d69fb5d827a3d4fd0` |
| Better active plan | file SHA-256 `6d4c1234e7e82fa77d17d333759b2ab966e82c3b592cbcb168ffd9410c8d08fe` |
| LoopOS active plan | file SHA-256 `0f388d4fd74627fc7cabb58373ff0625ce8d30b007b63ff8e56fccdfb9784c9b` |
| LangCraft active plan | file SHA-256 `b1631b1897cc57b078692a5f42cd673d00c1de6ca8d4fb87bf6ce0fbccddc6a1` |
| Runtime profile active plan | file SHA-256 `6e64640b7d835ee008f133b1f088846e76147841e90ea9f0b5c177ea339464ce` |
| Codex runtime evidence | evidence `sha256:02cef6a6293e4ae8dd4f92711d58f6bae4ee8e376576aa61741332512ca109b7` |
| Claude runtime evidence | evidence `sha256:b56667269b2564af45df61e08af576508f3912c58a1b78ae048edb01bb7dae99` |
| Cursor runtime evidence | evidence `sha256:bb9895cd1491f7f6e60436af035a0ea960b6deed87110345b5ae63c5cfc6b2e1` |
| Panorama JSON / Markdown | `83813e3b66fb7d52199f35d31ee25c1d88a63794c62f70dd68b1b7438e5e612c` / `968ed1ea7910fdda323059df9e624c29cbd518e932204669b9b8ae7be9445c72` |
| Cleanup review | `d24155e8c3f3e01af828aa5e04bdb1831cda42d26453f01df2c42c5c10f1963b`；0 selected；plan `null` |

Panorama and current-evidence file digests are recorded in the verification report after the final regeneration, so a later local
refresh cannot silently inherit an older digest.

## Review links

- [`01-role-and-independence-declaration.md`](./01-role-and-independence-declaration.md)
- [`02-champion-first-pass.md`](./02-champion-first-pass.md)
- [`03-challenger-first-pass.md`](./03-challenger-first-pass.md)
- [`04-cross-examination.md`](./04-cross-examination.md)
- [`05-objections-and-disagreements.md`](./05-objections-and-disagreements.md)
- [`06-claim-ledger.md`](./06-claim-ledger.md)
- [`07-rubric-decision.md`](./07-rubric-decision.md)
- [`08-false-consensus-and-pressure-tests.md`](./08-false-consensus-and-pressure-tests.md)
- [`09-verification-and-falsification-plan.md`](./09-verification-and-falsification-plan.md)
- [`10-promotion-boundary.md`](./10-promotion-boundary.md)
- [`11-live-upgrade-follow-up.md`](./11-live-upgrade-follow-up.md)
- [`final-product-judgment.md`](./final-product-judgment.md)
- [`acceptance.md`](./acceptance.md)
