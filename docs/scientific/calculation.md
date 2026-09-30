# Calculation policy and interpretation

The implemented score is a **tenant-configured business policy**, not a scientifically validated measure or universal ranking. Organizations must document job analysis, intended interpretation, suitability, and fairness evidence before using a model for high-impact decisions.

For each metric, an approved target version stores an ordered table of `(actual, score)` anchor pairs. Between adjacent anchors, the engine interpolates linearly with `decimal.js` precision 40. Below and above the anchor range it floors or caps at the endpoint score. Higher- and lower-is-better policies must be monotonic. The target and formula IDs are included in the saved snapshot. Each metric score is rounded to four decimal places before weighted aggregation; dimensions and final results are also rounded to four places.

Weights at each level must be positive and sum exactly to one. An unscorable optional metric has its weight redistributed among scorable metrics in the same dimension, and the trace marks the redistribution. A required unscorable metric leaves the evaluation incomplete with no overall score. Missing values are never treated as zero. `ZERO` requires an actual value of zero. A minimum sample threshold can make a metric unscorable, but this is a policy threshold and is not a confidence interval.

The current evidence selection uses the latest **verified** observation for a metric within the cycle. The target selected is the most specific target active at the cycle end. This is a simplifying policy that needs review for cycles where targets change mid-period. Rates preserve numerator and denominator in evidence, but Wilson intervals, Bayesian models, inter-rater reliability, psychometric validation, and fairness analytics are not implemented.

## Reference guidance and distinctions

- [ISO 30414:2025](https://committee.iso.org/sites/tc260/home/news/content-left-area/news-and-updates/iso-30414-2025-strengthening-hum.html) concerns human capital reporting. It does not validate this scoring policy.
- [ISO 45003:2021](https://www.iso.org/standard/64283.html) provides psychosocial risk guidance. Health and well-being must remain outside performance penalties.
- [SIOP Principles](https://www.siop.org/wp-content/uploads/2025/12/UniformSelectionStatement_121525.pdf) are relevant to validation evidence. The present repository has no empirical validation study.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the accessibility target, not a claim of conformance.
- [OWASP API Security Top 10:2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/) informs object-level authorization checks.
- [NIST AI RMF 1.0](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) informs future AI governance. No AI decision engine is present.

Legal requirements vary by jurisdiction. In particular, employment-related AI may fall within the [EU AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689). This implementation has not been assessed for any jurisdiction.
