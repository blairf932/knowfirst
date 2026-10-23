# Contributing

Thanks for considering a contribution to AI Frontier Intelligence (AFI).

## Before opening a change

- Check existing issues and open a discussion or issue before large changes.
- Keep evidence labels accurate: a source declaration, an analysis, and a tested result are different things.
- Do not include API keys, `.env` files, backups, account data, or private logs in commits or pull requests.
- Keep changes focused and include tests for behavior changes.

## Local setup

AFI currently targets Node.js 24 and npm. From a clean clone:

```powershell
npm ci
New-Item -ItemType File .env # only if it does not exist
npm run db:migrate
npm run db:seed
npm run dev
```

The default database is local PGlite under `.data/`. Keep the app to one process in this mode. To use PostgreSQL, configure a dedicated development database in `.env`; never point tests at a production database.

## Checks

Before opening a pull request, run the checks relevant to your change:

```powershell
npm run typecheck
npm test
npm run build
npm audit
```

PostgreSQL integration and browser checks require their documented test services and should be reported separately from unit tests. Do not claim a check passed if it was skipped or simulated.

## Pull requests

Explain the user-visible change, the evidence or bug that motivated it, tests actually run, and remaining limitations. Never edit a recorded result so a new change looks previously tested - regenerate the evidence instead.

## Sign-off (DCO)

There is no CLA here, so no paperwork and no copyright assignment. Instead we use the Developer
Certificate of Origin: add a sign-off line to every commit.

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` writes it for you. The sign-off is your statement that you wrote the change, or
that you have the right to submit it under this project's MIT license. That is the whole obligation.
