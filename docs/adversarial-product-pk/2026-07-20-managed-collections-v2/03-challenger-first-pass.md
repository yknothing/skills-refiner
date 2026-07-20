# Challenger First Pass

## Initial decision

`NOT_READY`; veto on the claim that generic cross-repository coexistence was complete.

## High findings

1. A foreign real `~/.agents/skills/prose-craft` directory still produced `installed_conflict`; the regression covered only symlinks after deliberately deleting the real directory.
2. Collision origin came from basename lookup in `.skill-lock.json`; receipt claim and filesystem ownership were conflated.
3. Preserved collisions were not part of the immutable plan or apply preconditions.
4. Status returned `issues=[]` while broken historical targets were invisible as a separate health state.

## Required proof

- only repository/source-path-qualified entities enter `legacy`;
- foreign/unqualified real directories are preserved unless they occupy the required publication path;
- the complete preservation set is plan-hashed and re-observed before mutation;
- raw/resolved target, target health/digest, and receipt claim are observable;
- preserved paths never enter quarantine, unlink, or successor inference.
