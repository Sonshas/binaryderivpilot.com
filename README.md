# smartbase

Private monorepo: Vite/React web (`apps/web`) + local Express market-data helper (`apps/api`).

## Live deploy

Production site is a **static** build behind Caddy on Vultr. Ship by pushing `main` — GitHub Actions uploads a release. Details: [`deploy/vultr/README.md`](deploy/vultr/README.md).

`apps/api` (`PORT` / `CORS_ORIGIN`) is **local development only** and is not deployed.

## Local dev

Root `.env` only (no example env files). Then:

```bash
npm ci
npm run dev
```
