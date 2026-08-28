# 02 — Champion First Pass

## Strongest case for promotion

The useful product is not a universal lock file. It is a layered local control plane in which immutable upstream content,
approved local generation, observed filesystem, runtime exposure and native runtime observation have separate authorities.

The narrow promotion slice is operationally useful:

1. ProdCraft, Better Skills, LoopOS and LangCraft are physically grouped under the user-specified global root.
2. Their 69 members are bound to exact revisions and artifact trees; upstream versions come only from those artifacts.
3. Upgrades are plan-hash gated, use no-follow/exclusive/CAS primitives, preserve recoverable predecessor evidence and fail closed
   on ambiguous state.
4. Cross-repository name conflicts default to preserve. Better `bs-prose-master` and LangCraft `prose-craft` remain separate.
5. Runtime profile separates desired exposure from catalog/body/route/context evidence.
6. Full scan and cleanup review observe the rest of the global surface without granting automatic deletion authority.

## Promotion claim

Promote only the four-collection filesystem/control-plane slice as an `Accepted with limitations` candidate. Do not promote
Cursor support, runtime body/route/context correctness, context savings, arbitrary `npx`/`npm` transactional adoption, or complete
source lifecycle for all Panorama identities.

## Known weak points submitted by Champion

- current collection operations are current-view + recovery evidence, not append-only WAL;
- whole active collection deletion is detected but not automatically reconstructed;
- installer timestamps are installer-declared;
- local origin containment is not online remote attestation;
- operation records do not carry a separate human review record;
- catalog enumeration is not runtime execution proof.
