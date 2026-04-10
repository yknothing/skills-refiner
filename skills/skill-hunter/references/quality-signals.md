# Quality signals reference

This reference documents the concrete signals that separate genuinely excellent skills from the noise. Use it to calibrate your judgment when evaluating candidates.

## Strong positive signals

### Structure and design
- The SKILL.md has clear YAML frontmatter with an accurate, non-inflated description.
- The skill defines its scope explicitly — what it does and what it does not do.
- Instructions are ordered logically, not dumped in a flat list.
- The skill handles edge cases and failure modes, not just the happy path.
- There is evidence of iteration: version history, changelogs, or refined language that shows the author has used and improved the skill.

### Context engineering
- The skill manages what the model sees carefully — no context pollution.
- References and examples are used precisely, not thrown in for bulk.
- The prompt architecture separates concerns: identity, constraints, workflow, output format.
- Partial or ambiguous input is handled with graceful defaults or clarifying questions, not crashes.

### Practical usefulness
- The invocation is natural — a user can trigger it without memorizing a syntax guide.
- The output is immediately usable, not a raw dump that requires post-processing.
- The gap between the demo and real-world usage is small.
- The skill works in multiple agents or environments, not just one.
- The skill is visible through the channels where serious practitioners actually discover things: major skill platforms, app-owned hubs, GitHub, and X.

### Author quality signals
- The author has a track record of quality work (not just quantity).
- The repository is maintained: recent commits, responsive issues, clear documentation.
- The author shows awareness of the skill's limitations in their own documentation.
- The author iterates based on real usage feedback, not just feature requests.

## Strong negative signals

### Design red flags
- The skill description uses marketing language: "revolutionary", "game-changing", "the ultimate."
- The scope is vague or unlimited: "handles any task", "works for everything."
- Instructions are a wall of text with no structure.
- The skill has no explicit boundaries — it never says "do not" or "stop when."
- There are too many features for the stated purpose (feature bloat).

### Context engineering red flags
- The skill dumps large blocks of text into the prompt without clear purpose.
- Examples are generic or copied from documentation rather than crafted for the skill's specific use case.
- The skill does not handle missing or partial input.
- System instructions and user instructions are tangled together.

### Ecosystem red flags
- High star count but no meaningful commits in months.
- Many forks but no merged contributions (often means the forks are abandoned experiments).
- The README is polished but the skill itself is thin.
- The repository has many skills but no coherent design philosophy connecting them.
- Self-reported benchmarks with no reproducible methodology.
- The skill appears everywhere in registries but is almost absent from serious builder discussion or real usage threads.

### Author red flags
- The author ships many skills rapidly with no evidence of deep iteration on any of them.
- Issues are ignored or dismissed.
- The author promotes heavily but does not engage with technical feedback.
- Version numbers inflate without corresponding quality improvements.

## Signals that look positive but are not

These are traps that fool surface-level evaluation:

- **High star count** — measures visibility, not quality. Many excellent skills have fewer than 50 stars.
- **Frequent releases** — can mean active development or can mean unstable, untested churn.
- **Long SKILL.md** — length is not depth. Many overlong skills are unfocused.
- **Complex architecture** — complexity is a cost, not a feature. The best skills are often surprisingly simple.
- **Celebrity author** — famous people ship mediocre work too. Judge the skill, not the name.
- **Beautiful README** — documentation quality matters, but a polished README with a thin skill behind it is a common pattern.
- **"Works with everything"** — universal compatibility claims usually mean the skill is too generic to be excellent at anything.
- **Leaderboard visibility** — being easy to find on a major platform helps discovery, but it is not proof of quality.

## Signals that look negative but are not

These are often misread as weaknesses:

- **Low star count** — many of the best skills are quiet. Quality does not require marketing.
- **Minimal README** — if the skill itself is well-written and self-explanatory, a short README is fine.
- **Single-purpose skill** — a skill that does one thing superbly is more valuable than a skill that does ten things adequately.
- **No changelog** — some excellent authors iterate through commit history without maintaining a separate changelog.
- **Opinionated constraints** — a skill that says "no" to many things often has a clearer design center than one that tries to accommodate everything.
- **Early X-native visibility** — a skill showing up first in serious practitioner threads can be a positive discovery signal, but only after the linked repo or demo holds up.
