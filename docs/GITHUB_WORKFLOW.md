# UVMS AI — GitHub workflow

GitHub should be the single source of truth for the project.

## Repository
Recommended name: `uvms-ai`
Recommended visibility during Stage 1: **Private**.

Do not commit `.env`, API keys, Apple/Google credentials, payment secrets or production database credentials.

## Branches
- `main` — stable/demo-ready code.
- `develop` — active Stage 1 development.
- optional short-lived `feat/*` branches for risky work.

## Local VS Code / Codex sync
GitHub changes do not magically appear in an already-open local folder. Before Codex works on the project, sync the local checkout:

```bash
git status
git pull --rebase origin develop
```

If Codex is allowed to use the terminal, you can simply tell it: `Sync with origin/develop, inspect the current changes, run tests, and only then continue.`

For maximum Codex quota efficiency, use Codex mainly for local execution/debugging while ChatGPT produces the primary implementation and commits.

## First upload
After the repository is created, upload/commit the current repository contents to `main`, then create `develop` from it. The included GitHub Actions workflow verifies API tests and Web/Mobile TypeScript on pushes and PRs.
