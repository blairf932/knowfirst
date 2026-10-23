# Source and copyright policy

| Tier | Allowed role |
|---|---|
| S | Official docs/repositories/releases, standards, research metadata |
| A | Official company/developer blogs; evidence still scoped to the claim |
| B | HN/community discussion; discovery and discussion signals |
| C | Weak signals only; never sole support for high-confidence facts |

Connectors use an exact HTTPS host allowlist, no user-supplied fetch URLs, no arbitrary GitHub repo names, manual redirect handling with each destination validated, a 15-second request timeout, at most three redirects, 4 MB response bound and small batches. Authentication tokens are sent only to api.github.com. Failures remain ERROR or RATE_LIMITED; missing connectors remain UNAVAILABLE.

Collected and retained: source URL, title, basic metadata, ETag/hash when available, release/paper/discussion dates, factual structured fields, short matched capability phrases and source-specific identifiers. Full README/HTML/Atom bodies are transient and discarded. No external articles, release bodies, full papers or copied code are permanently stored. Facts and quoted phrases link to the original source.

The source policy is an engineering control, not a conclusion that all commercial reuse is permitted. Provider terms, robots policy, attribution, database rights and downstream display require review before charging. The current adapters do not bypass login, paywalls, CAPTCHA or rate limits.

Live sources used during acceptance:

- [GitHub REST repository API](https://docs.github.com/en/rest/repos/repos)
- [Mem0 official repository](https://github.com/mem0ai/mem0)
- [Supermemory official repository](https://github.com/supermemoryai/supermemory)
- [Graphiti official repository](https://github.com/getzep/graphiti)
- [LangGraph official repository](https://github.com/langchain-ai/langgraph)
- [Microsoft GraphRAG](https://github.com/microsoft/graphrag)
- [Browser Use](https://github.com/browser-use/browser-use)
- [OpenClaw](https://github.com/openclaw/openclaw)
- [LangChain memory documentation](https://docs.langchain.com/oss/python/concepts/memory), [MCP documentation](https://modelcontextprotocol.io/docs/getting-started/intro), [Agent Skills](https://agentskills.io/home), [OpenTelemetry](https://opentelemetry.io/docs/)
- [LangChain official blog](https://www.langchain.com/blog)
- [arXiv API](https://info.arxiv.org/help/api/index.html)
- [Hacker News search API](https://hn.algolia.com/api)

Source snapshots have their actual retrieval times. Web research used to choose candidates is not a substitute for runtime facts. Any later freshness indicator is recalculated from stored dates.

Official integration evidence is also collected from [Mem0 OpenClaw documentation](https://docs.mem0.ai/integrations/openclaw), [Supermemory OpenClaw documentation](https://supermemory.ai/docs/integrations/openclaw) and the two explicitly allowlisted npm package manifests. Package code is not installed. A plugin license is evaluated independently of the main repository license.
