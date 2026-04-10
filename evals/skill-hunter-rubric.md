# Evaluation rubric — skill-hunter

Use this rubric to judge whether a `skill-hunter` run is actually good.

## Scoring dimensions

Score each dimension from 1 to 5.

### 1. Need interpretation
Does the skill correctly understand what the user is actually looking for?

- **5**: restates the need precisely, identifies the real requirement behind the request, clarifies any ambiguity
- **3**: broadly correct but misses nuance or takes the request too literally
- **1**: misunderstands the need or skips need interpretation entirely

### 2. Source strategy
Does the skill look in the right places?

- **5**: demonstrates awareness of multiple source types; uses major skill
  platforms/apps and X for discovery; uses GitHub for verification; avoids
  low-signal noise
- **3**: uses reasonable sources, but the source strategy is incomplete.
  It may miss important channels such as X or mainstream platforms, or it may
  over-rely on a single channel without enough cross-checking.
- **1**: only searches the most obvious source or lists results without evidence of strategic sourcing

### 3. Quality judgment
Are the quality assessments actually sharp and defensible?

- **5**: identifies real quality signals and real flaws, distinguishes genuine excellence from surface impressiveness, assessments are grounded in specific evidence
- **3**: some useful quality judgment but mixed with generic praise or surface-level observations
- **1**: confuses popularity with quality, gives generic assessments, or treats all candidates equally

### 4. Anti-noise discipline
Does the skill successfully resist popularity bias, marketing language, and surface impressions?

- **5**: explicitly identifies and avoids noise; recommendations are based on structural quality, not visibility; explains why popular but mediocre options are excluded
- **3**: mostly avoids noise but occasionally falls for star counts or marketing language
- **1**: recommendations are essentially a popularity ranking with light commentary

### 5. Curation quality
Is the output a curated shortlist, not a dump?

- **5**: small number of genuinely excellent recommendations, each with a clear reason for inclusion; when `target_repo` or adoption intent is present, clearly routes picks into upstream-linked vs absorb-and-refine paths and defines the acceptable local boundary for upstream-linked picks; willing to say "nothing meets the bar" when appropriate
- **3**: reasonable shortlist but includes some filler or fails to differentiate clearly between picks
- **1**: long list with no meaningful curation, or a single recommendation without alternatives

### 6. Evidence discipline
Does the skill respect the evidence available?

- **5**: clearly distinguishes what it has directly assessed versus what it infers; adjusts confidence based on evidence depth; does not rate a skill as excellent based on a README alone
- **3**: mostly grounded but overclaims in places
- **1**: makes strong quality claims from thin evidence without disclosure

### 7. Gap identification
Does the skill honestly report when the ecosystem does not fully serve the need?

- **5**: explicitly identifies gaps; does not stretch mediocre skills to fill unmet needs; suggests what an ideal skill would look like
- **3**: acknowledges limitations but does not clearly articulate the gap
- **1**: always finds something to recommend regardless of actual quality

### 8. Output clarity
Is the recommendation report clear, direct, and useful?

- **5**: dense with signal, easy to act on, judgments visible early, writing is sharp and direct
- **3**: readable but verbose or hedged in places
- **1**: padded, generic, or hard to extract actionable recommendations from

### 9. Language discipline
Does the output language, tone, and terminology stay consistent and high-quality?

- **5**: one consistent language, sharp prose, no AI-sounding filler, reads like a knowledgeable scout briefing
- **3**: mostly consistent with some drift or stiffness
- **1**: mixed-language, template prose, or obvious AI-flavor padding

## Quick pass/fail checks

A run should be considered **failing** if any of the following happens:

- it recommends skills primarily based on star count or download numbers;
- it ignores major skill platforms/apps and X as discovery channels when they are clearly relevant;
- it treats every candidate as roughly equal without meaningful differentiation;
- it cannot identify a clear top pick when asked;
- when the user wants adoption into a target repository, it blurs together upstream-linked and absorb-and-refine paths;
- it overclaims quality from thin evidence (README-only);
- it produces a long list without curation;
- it uses inflated language ("game-changing", "revolutionary") without irony.

A run should be considered **strong** if it does all of the following:

- demonstrates sharp taste by recommending skills based on structural quality, not visibility;
- is willing to exclude popular options that do not meet the quality bar;
- gives clear, defensible reasons for each recommendation;
- keeps the output tight and actionable;
- honestly identifies gaps when the ecosystem falls short.
