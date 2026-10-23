# Source provenance and attribution

AFI v0.1.1 is published as a clean source snapshot. The original development repository was
private and contained personal working history; that history is intentionally not distributed.

- **Copyright holder**: `2026 AFI contributors`, as stated in [LICENSE](LICENSE). The MIT license
  text is unchanged and unmodified.
- **What this snapshot is**: application source, tests, migrations, scripts, documentation and the
  exact dependency lockfile. No build artifacts, runtime bundles, databases, backups, logs,
  environment files or dependency trees are included.
- **What it is not**: a rewrite. In-file notices, contribution guidance, source policy documents and
  the dependency license inventory are preserved as they were written.
- **Third-party material**: no third-party dependency code or binaries are vendored here.
  `package-lock.json` records exact versions; [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and
  [docs/LICENSE_AUDIT.md](docs/LICENSE_AUDIT.md) record attribution and license conditions,
  including the optional libvips LGPL entries and caniuse-lite attribution.
- **Inbound licensing**: the maintainer confirms the code in this repository was written by them or
  contributed under terms compatible with MIT. No contributor identity or email address was
  scraped, exported or reconstructed from Git metadata.

Historic audit and acceptance records from private development are not part of this repository.
Verification artifacts referenced by the tooling under `scripts/` are regenerated locally when you
run those scripts; they are not shipped, because a stale "PASS" file sitting next to source code
misleads readers about what was actually tested.
