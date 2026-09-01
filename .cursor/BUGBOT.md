# Bugbot — ScoreSense

Production is a Vultr VPS, not Vercel. Review for bugs that would break the running Docker API or Fantasy/Projections UI.

## Skip

Do not spend review budget on:

- `docs/**`, `*.md`, `AGENTS.md`, `.cursorrules`, `.cursor/**`
- `render.yaml`, `vercel.json`, `.github/workflows/**`
- `artifacts/**`, lockfiles, generated JSON under `artifacts/analytics/`

Those changes cannot break `app.fourthdownlabs.com`. If a PR is only those paths, post nothing.

## Do review

- `app/**`, `src/**`, `frontend/**` — correctness, auth, SQLite/WAL, contract math, broken routes
- Deploy scripts that run on the VPS (`deploy/`, `.github/workflows/deploy.yml`)
