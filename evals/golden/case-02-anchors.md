# Golden anchors — Case 02: README-only evidence

Apply the shared quality-first rubric. The evidence boundary is decisive.

## Required judgment

- Identify a multi-skill repository as described by its README.
- Keep Stage 1 scope; no integration destination exists.
- State that no Skill bodies, dependencies, tests or runtime observations were
  supplied. Their quality and loadability cannot be established.
- Use the listed scope and installation instructions as limited observations,
  and identify the next evidence that would change a meaningful decision.

The README lists five domains and a manual copy installation process. Versions,
update behavior and invocation examples are not documented in this snapshot;
do not turn their absence from the README into claims that the repository
implements none of them.

## Useful response

A bounded conclusion and focused request for source/runtime evidence can be
enough. Any inference about likely use should be labeled. A five-domain list
does not prove either completeness or incoherence. Manual installation alone
does not establish poor engineering or a need to build an installer.

## Fail the case if

- It claims individual Skill quality, mature runtime behavior or broad coverage
  from the README alone.
- It invents body-level defects, test results or source inspection.
- It forces integration or gives a confident numerical maturity score.
- It offers only generic praise without a useful evidence-bounded next step.
