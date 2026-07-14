# Claim Ledger

| Claim | Label | Evidence | Confidence | Validation path | Reversal condition | Must not claim yet |
|---|---|---|---|---|---|---|
| Existing scan facts can seed a disposition candidate list | Repo-derived inference | `skill-scan.v4` topology, path, hash, provenance, and signals | High | Contract fixture from scan to candidate schema | Required identity cannot be derived without unsafe assumptions | Scan JSON is already an executable plan |
| The current scanner is insufficient for mutation | Fact | Missing broken-link `entry_path`, whole-tree identity, and transaction state | High | Direct schema inspection | Future scanner schema supplies all execution preconditions | Cleanup is safe today |
| CLI is the only execution core; Agent/IDE is a thin client | Product-owner decision | Conversation approval | High | Non-TTY JSON harness | Agent needs to parse prose or duplicate logic | AI makes the filesystem decision |
| Reversible quarantine is the default | Product-owner decision | Conversation approval | High | Apply/undo fixtures | Recovery cannot preserve identity or conflicts safely | Quarantine is permanent uninstall |
| Four-step B flow is low-friction | Hypothesis | Owner visual approval only | Medium | Registered maintainer and Agent task tests | Completion or comprehension thresholds fail | Users validated the flow |
| macOS single-item mutation is the safest first implementation slice | Opinion supported by repo-derived inference | Current POSIX support plus missing Windows-native surface | Medium-high | macOS fault-injection spike | Spike fails or owner requires Windows launch parity | macOS implementation is already safe |
| Windows needs a native adapter | Repo-derived inference | Platform contract explicitly lacks PowerShell and Git Bash topology certification | High | PowerShell/.NET spike and native CI | Another proven native mechanism meets the same gates | Git Bash emulation is sufficient |
| JSON is compatibility, not an AI-native moat | Decision | Adversarial objection resolution | High | Agent harness | Evidence shows unique Agent loop value beyond compatibility | Market differentiation is proven |
| Batch review plus serial item transactions is honest and recoverable | Hypothesis | Cross-examination scope reduction | Medium | Fault injection and user-task tests | Users misunderstand summary or recovery cannot converge per item | Batch apply is atomic |
