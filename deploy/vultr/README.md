# Vultr + GitHub deploy

Live site: **https://optionmarkettraders.com**  
Doc root: `/var/www/optionmarkettraders/current` (symlink to a release under `releases/`)

## Start here (one-time)

1. **GitHub repo** — private remote is `origin` → `https://github.com/Sonshas/smartbase.git`. Push goes to `main`.
2. **GitHub Actions secrets** (Settings → Secrets and variables → Actions):

   | Secret                                                       | Purpose                                                                   |
   | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
   | `VULTR_HOST`                                                 | VPS IP (e.g. `139.84.240.227`)                                            |
   | `VULTR_SSH_USER`                                             | `deploy`                                                                  |
   | `VULTR_SSH_KEY`                                              | Private SSH key whose **public** key is in `~deploy/.ssh/authorized_keys` |
   | `VITE_SUPABASE_URL`                                          | Same as local root `.env`                                                 |
   | `VITE_SUPABASE_PUBLISHABLE_KEY`                              | Publishable key                                                           |
   | `VITE_SUPABASE_ANON_KEY`                                     | Optional if unused                                                        |
   | `VITE_SITE_URL`                                              | `https://optionmarkettraders.com`                                         |
   | `VITE_MARKET_DATA_PROVIDER`                                  | e.g. `deriv`                                                              |
   | `VITE_DERIV_APP_ID`                                          | Deriv app id                                                              |
   | `VITE_MARKET_DATA_WS_URL`                                    | Deriv WS URL                                                              |
   | `VITE_DEMO_ACCOUNT_NAME` / `VITE_REAL_ACCOUNT_NAME` / shorts | Branding                                                                  |
   | `VITE_ADMIN_EMAILS` / `VITE_VIP_EMAILS`                      | Allow-lists                                                               |
   | `VITE_MARKET_DATA_API_URL`                                   | Leave empty for live (Deriv); local API is not on the VPS                 |

3. **VPS** — `deploy` user can write `/var/www/optionmarkettraders` and (optional) `sudo systemctl reload caddy`. Use `setup-server.sh` if the box is new.
4. **Archive old website files** (SSH once, before first clean release):

   ```bash
   # copy archive-legacy-site.sh up, then:
   bash archive-legacy-site.sh /var/www/optionmarkettraders
   # optional second tree, e.g. old Apache docroot:
   # bash archive-legacy-site.sh /var/www/optionmarkettraders /var/www/html
   ```

5. **Trigger deploy** — push to `main` (paths under `apps/web/**`) or run **Deploy web** → _Run workflow_.

## What ships where

| Piece                | How it goes live                                                     |
| -------------------- | -------------------------------------------------------------------- |
| Website (`apps/web`) | GitHub Actions → SCP release → `activate-release.sh`                 |
| Edge Functions       | Still `deploy/vultr/deploy-supabase-functions.ps1` (Supabase CLI)    |
| DB migrations        | Supabase CLI apply / repair (see Cursor rule)                        |
| Express `apps/api`   | **Local only** — not deployed. No `PORT` / `CORS_ORIGIN` on the VPS. |

## Fallback (emergency only)

`deploy.ps1` still builds and SCPs from a PC. Prefer GitHub Actions for routine deploys.
