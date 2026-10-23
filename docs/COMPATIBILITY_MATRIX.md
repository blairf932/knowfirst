# Compatibility Matrix — v0.1.1

Overall: PARTIAL. Installation and limited component checks were performed; no complete host-to-memory integration is claimed.

| Integration | Plugin version | Official host declaration | Level | Install | Component load | Host startup / write / recall / update / restart |
|---|---|---|---|---|---|---|
| OpenClaw + Mem0 | 1.0.16 | Plugin API and gateway >=2026.4.24 | DECLARED | PASS | FAIL: OpenClaw plugin SDK host package absent | BLOCKED |
| OpenClaw + Supermemory | 2.1.16 | Plugin API/gateway >=2026.5.7 | DECLARED | PASS | PASS; missing-configuration stub behavior PASS | BLOCKED |

COMMUNITY_VERIFIED: none. INTERNAL_VERIFIED: none. These are evidence levels, not promotional badges. The UI now uses the exact DECLARED label. A recommendation to try an integration does not assert runtime compatibility.

Packages were installed at exact versions into ignored `.cache/compatibility` with install scripts disabled and peer dependencies deliberately excluded. They are not product dependencies and never enter the commercial artifact. Component loading used the actual published module, not a reimplementation. Supermemory registered its setup-only remember/recall stubs without a service key. This harness is not an OpenClaw host and cannot establish successful memory operations.

The configured DeepSeek key is an LLM credential; it is not a Mem0 or Supermemory service credential. Neither memory service has been provisioned for this test, and a complete OpenClaw host was not installed. No host configuration or real personal memories were used. Do not mark unexecuted write/recall/update/restart tests as PASS. Raw component evidence is produced locally by `scripts/compatibility-acceptance.mjs` and is not shipped with this repository. The database stores the declared version bounds, environment and checks separately from fact provenance.

Sources: https://docs.mem0.ai/integrations/openclaw ; https://supermemory.ai/docs/integrations/openclaw ; the existing two approved npm manifest sources and the installed packages' openclaw compatibility metadata. No additional source was added to the product catalog.

Promotion procedure: pin host/plugin versions, provision an isolated memory backend, install/start the real host, write a synthetic unique memory, recall it, update it, verify changed recall, restart both host and backend, confirm persistence, then test bad credentials/network failure. Keep logs free of service keys and private memory contents. Only a complete passing record may establish INTERNAL_VERIFIED for that exact environment. Vendor declarations alone remain DECLARED.
