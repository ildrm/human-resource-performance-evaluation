# Evidence Quality Index (EQI)

The EQI is a **tenant-configured descriptive index**, not a probability, confidence interval, validity coefficient, or guarantee that a performance score is correct. A policy has an integer version, rationale, independent activation, a freshness window, an explicit factor for evidence without an external reference, and four positive weights that sum to one. Only one policy is active for new calculations. Existing evaluation input and result snapshots remain fixed when a policy changes.

The engine uses the latest **verified** evidence item for each metric within the review cycle, following the same selection rule as the performance calculation. Each metric contributes equally to the quality components, independently of its performance weight. This prevents a high-weight outcome metric from concealing weak evidence on other expected measures.

| Component | Calculation, range 0–1 |
|---|---|
| Completeness | Observed or explicit zero among required metrics, divided by required metric count. If no metric is required, all configured metrics are used. |
| Freshness | Mean of `max(0, 1 − age in days / policy freshness window)` for observed metrics, using cycle end as the reference date. |
| Sample adequacy | Mean of `min(1, denominator / configured minimum sample)` for observed metrics. A metric with no minimum has value 1. A missing denominator when a minimum exists has value 0. |
| Traceability | Mean of 1 when an external reference is present, otherwise the policy's disclosed unreferenced-evidence factor. |

When no metric has an observed item, freshness, sample adequacy, and traceability are zero. The final index is `100 × sum(component × configured weight)` rounded to two decimal places. Component and metric traces are saved with the evaluation and recomputed by replay. The index does not modify the performance score, replace evidence review, or establish job-related validity. External-reference presence is only a coarse traceability proxy. Source reliability, coverage, rater agreement, and statistical confidence intervals need separate methods and data before they can be claimed.
