---
"e2e": patch
---

Record `observationTruncated: true` on an agent step whose latest observation was cut at the engine or byte limit, so a `blocked` step reads as a cut tree rather than a missing control.
