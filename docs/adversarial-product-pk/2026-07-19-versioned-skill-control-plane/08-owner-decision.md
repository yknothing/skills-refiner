# Owner Decisions

The following decisions are explicit inputs from the product owner and are not inferred by reviewers:

1. The normal source of installed Agent Skills is GitHub or an equivalent versioned repository; that source is the natural content authority.
2. The newest version is not automatically stable or reliable; version selection and promotion must be designed explicitly.
3. ProdCraft is the first physical-directory migration example, not merely a logical pack/catalog example.
4. Physical migration and lifecycle governance are required capabilities of skills-refiner.
5. The management mechanism must account for out-of-band manual deletion and other drift between recorded state and actual Skills.
6. The first version must be robust, convenient, elegant and low-friction rather than a disposable prototype.

These decisions authorize ADR documentation and adversarial review. They do not authorize physical migration or implementation in this task.
