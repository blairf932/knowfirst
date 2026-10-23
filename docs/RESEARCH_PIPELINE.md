# Research pipeline

1. **Intent detection:** deterministic Chinese/English build and comparison patterns.
2. **Search:** canonical catalog, bilingual aliases and explicit match scores.
3. **Source collection:** fixed approved connectors, public official endpoints, deadline and size bounds.
4. **Source ranking:** S, A, B, C. C cannot support high-confidence facts alone.
5. **Entity resolution:** stable IDs and reviewed aliases; no silent speculative mergers.
6. **Fact extraction:** GitHub JSON validated by Zod; narrow README capability-mention extraction. General text extraction is PARTIAL.
7. **Deduplication:** deep equality of structured values, unique active intervals and event IDs.
8. **Evidence validation:** source foreign keys, tier gates, schema validation and independent verification records.
9. **Relationships:** reviewed catalog categories marked ANALYSIS. General automated relationship extraction remains UNAVAILABLE.
10. **Change detection:** new fact versions plus OBSERVED_CHANGE events, retaining previous records.
11. **Signals:** actual Stars/forks/issues observations. Stars/day needs independent observations at least 24 hours apart. One metric never becomes a full trend label.
12. **Card generation:** deterministic structured composition from the database. Explanations are editorial ANALYSIS, not fabricated model research.
13. **Personal relevance:** exact/bilingual keyword relevance and category neighbors, applied per user after cache lookup.
14. **Persist:** logged research runs for authenticated users, shared evidence-only cache and provenance records.

The full query-to-persist trace records each stage's status. Collection happens separately so repeatedly opening the same concept does not repeat online requests. Unknown topic searches return UNAVAILABLE. The product must not claim to have searched the whole web.

Cache TTL values are environment-configured in `lib/domain.ts`: evergreen 2160h, tool 168h, price 24h, changes 6h. The current card cache conservatively uses the minimum of evergreen/tool; source revision changes invalidate it. Price fields are not populated. Source freshness and fetch errors are distinct statuses. The next worker should enforce source-class refresh scheduling rather than relying only on manual refresh.

Build or Buy v0.1 is a constrained rule-based analysis: compare requested capability keywords against evidenced README mentions. Unknown costs, maturity, privacy and compatibility remain unknown. Permissive repository license, not archived and fresh evidence are provisional screening gates, never a guarantee of production suitability. OpenClaw integrations additionally require vendor documentation naming the plugin and a separately verified package license/deprecation status. The result recommends an integration experiment, not a claim of tested runtime compatibility. Explicit privacy/offline/Windows/budget constraints remain WAIT until independently verified. No fake 80% real-world fit claim is made.
