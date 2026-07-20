# Evidence Map

## Review target

- ADR: `docs/adr/0006-declarative-managed-collections-and-reconciliation-catalog.md`
- Implementation: `skills/skill-hygiene/lib/{collection-specs,collection-tree,managed-collection-contract,managed-collection}.mjs`
- Live root: `/Users/whatsup/.agents/skills`
- Review level: L2 Agent-separated advocate, challenger, and fresh-host acceptance
- Mutation boundary: reviewers were read-only; the primary agent alone applied exact confirmed plans

## Durable evidence

| ID | Evidence | Result | Boundary |
|---|---|---|---|
| E-01 | Managed/CLI bundled Node v24.14.0 regression | 50/50 PASS (46 managed + 4 CLI) | repository implementation |
| E-02 | ProdCraft V1 regression | 35/35 PASS | run before final managed changes; V1 uses its own tree engine |
| E-03 | Fresh `collection list --fresh` | four collections `FILESYSTEM_READY`, `issues=[]` | filesystem, not every Agent runtime |
| E-04 | Fresh-host available-skills surface | 40 ProdCraft + 10 LoopOS + 6 LangCraft + 8 Better | current Codex host only |
| E-05 | Installed loader/reference preflight | 64/64 frontmatter; Better 82 Markdown/310 edges; ProdCraft 166/182; 0 errors | declared exclusions apply to four authoring examples |
| E-06 | Better v3 active identity | `better-skills-30597d9f086e`, plan `sha256:30597d9f086e78585a2b86a8e50bfa462ba15dabf25082badc15f555f1fea314` | same immutable source commit, reviewed 8-member profile |
| E-07 | Receipt immutability | `.skill-lock.json` SHA-256 `193a3540064e00a9b0b20444ba9a75b6d81ba18c38619508c80a8db300597900` | controller did not act as installer writer |
| E-08 | Collision observation | Better 37, LangCraft 10, all `preserve`; broken targets in management attention | unowned paths intentionally not repaired |
| E-09 | Prose coexistence | `better-skills/bs-prose-craft` and `langcraft/prose-craft` both discovered; different bytes | disproves basename identity |
| E-10 | Recovery | prior Better 9-member generation and all live operations retain exact recovery/quarantine roots | no recovery garbage collection performed |
| E-11 | LangCraft plan-bound collision preservation | live `langcraft-1c6ef7cb054d` plan.v3 has `legacy=[]`, `projections=[]`, 10 foreign `prose-craft` preserves; pre/post raw-target and mtime digest is identical | current live generation |

## Evidence that changed the design

1. First LangCraft apply rolled back because basename logic treated Better historical `prose-craft` as LangCraft state.
2. Challenger reproduced a foreign real global `prose-craft` directory blocking planning.
3. Challenger showed preserved collisions were absent from immutable plan identity and target health was invisible.
4. Advocate proved upstream `bs-visual-design` frontmatter is invalid portable YAML.
5. Fresh acceptance found three undeclared Better shared-resource dependencies.
6. Finder added nested `.DS_Store` after Better v3 apply, exposing an overly strict deployment digest.

## Forbidden claims

- same name means same Skill, replacement, or retirement;
- broken historical projection may be silently redirected or deleted;
- GitHub `main` or newest commit is automatically stable;
- every Agent/profile has passed runtime routing and cache qualification;
- physical nesting has measured context-window savings;
- the current catalog is an append-only tamper-evident ledger.
