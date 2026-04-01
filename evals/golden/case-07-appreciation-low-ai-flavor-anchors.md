# Golden anchors — Case 07: resisting the "correct but stiff" failure mode

## What a strong answer must do

### Correct object identification
- Identify the target as a research-assistance skill, not an engineering or automation tool.
- Recognize that its role is to help a human researcher move from gathered evidence to a defensible argument.
- Avoid treating it as a generic AI tool or document summarizer.

### Article quality
- Open with a sentence that commits to a real observation or claim — not a setup paragraph about "the evolving role of AI in research".
- Read like an article, not a review template.
- Vary sentence length and structure across the piece.
- Avoid three-bullet symmetry in every section.
- Avoid obviously machine-sounding transitions: "Furthermore", "It is worth noting that", "Building on this", "In addition".

### Thesis
A strong answer should form a thesis early — something like:
- the skill's main contribution is its insistence on honest treatment of contradictions, which most synthesis tools quietly suppress;
- or: the skill is essentially a discipline scaffold, not an automation tool, and that distinction matters;
- or a comparable central claim that the rest of the piece develops and defends.

The thesis should be specific enough that a reader could disagree with it.

### Mechanism explanation
A strong answer should explain at least 2 of the following:
- why leading with the central claim changes how evidence is organized (it makes the argument visible before the evidence, rather than burying it);
- why sorting evidence by strength helps a researcher spot where the argument is actually weak;
- why requiring honest handling of contradictions is a constraint with real costs (it may produce a less tidy draft, but a more defensible one);
- why flagging the most important gap is different from listing all gaps (it forces a judgment about what matters most).

### Real limits to surface
A strong answer should surface at least 2 of the following:
- the skill gives no guidance on how to evaluate source quality or credibility;
- "strength of evidence" is undefined — the model must infer what counts as strong, which may not match the researcher's field;
- the skill does not handle the case where contradictions are irresolvable with the available sources;
- it provides no mechanism for iterating once a draft is produced and the researcher disagrees with how evidence was organized;
- it assumes the researcher can already articulate the claim — if they cannot, the skill stalls at the first step.

### Transfer value
A strong answer should offer at least one design lesson that generalizes beyond this specific skill, such as:
- why making contradictions visible is more valuable than smoothing them over, even when it produces less polished output;
- why a skill that forces a prior judgment (state the claim first) produces better downstream structure than one that summarizes first and concludes later;
- why gap-flagging should be selective rather than exhaustive.

## Failure signals

Treat the answer as failing if it:
- opens with a generic "AI and research" framing paragraph instead of a real claim;
- uses obviously templated transitions throughout the piece;
- organizes every section into three symmetrical bullet points;
- applies inflated adjectives ("truly innovative", "remarkably well-designed") without concrete justification;
- produces technically accurate content that a reader would identify as clearly machine-generated;
- lists features without explaining what each design choice costs or produces in practice;
- ignores all real limits because the skill is clearly useful.

## Scoring note

This case is specifically designed to test the **Low "AI flavor"** dimension.

A technically correct but obviously stiff answer should score no higher than 2 on that dimension regardless of how accurate its content is.

To score ≥ 4 on **Low "AI flavor"**, the answer must:
- have an opening that commits to a real observation;
- use varied prose structure across sections;
- avoid stock machine transitions;
- feel shaped rather than assembled.
