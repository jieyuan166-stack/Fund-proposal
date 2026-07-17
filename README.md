# Fund Proposal

Static Triton Wealth proposal site with a small Node.js password gate.

## Runtime

- Default local port: `127.0.0.1:8790`
- Password hash is loaded from `.triton-auth.json` or `TRITON_PASSWORD_HASH`.
- `.triton-auth.json` is intentionally not committed because this repository is public.
- Portfolio data is served through `/api/portfolio-data` with `Cache-Control: no-store`.
- `/api/data-health` reports data age and flags portfolio performance data as stale after 45 days by default.
- Seg fund portfolio performance is updated on the NAS by `scripts/update-portfolio-data.sh`, which downloads Equitable/Fundata FundSummary PDFs with retry/backoff, requires a consistent source date across all funds, parses the official return tables, and updates `portfolio_data.json` only when source data changes.
- Fidelity T-Class fund data is updated on the NAS by `scripts/update-fidelity-data.sh`, which downloads Fidelity Canada fund pages with retry/backoff, requires a consistent source date across all funds, and updates `fidelity_data.json` only when source data changes.
- Investment tax calculator and estate diagnostic rates are updated on the NAS by `scripts/update-tax-rates.sh`, which downloads the current calendar year's TaxTips.ca combined federal/provincial marginal tax tables and rewrites the embedded tax data in `investment_tax_calculator.html` and `estate_tax_diagnostic.html`. Both pages render their tax year/status from that embedded data, not from hardcoded text.
- `scripts/update-all-data.sh` runs every data refresh independently, so one unavailable source does not prevent the others from updating, and is the monthly NAS catch-up cron target.
- `scripts/backup-data-to-github.sh` commits changed fund/tax data from the NAS to GitHub using the NAS deploy key. The private key and known-hosts file live under ignored `.secrets/` and are never committed.
- Fund returns are historical official-source returns. Do not present them as future projections.

## Start

```bash
node server.js
```

For the current deployment, Cloudflare Tunnel points `proposal.tritonwealth.ca` to this Node service.

## NAS Docker Deployment

Place the tunnel credential file at:

```text
deploy/cloudflared/e764ed59-3700-40d6-b48d-5cf7f9352331.json
```

Then start on the NAS:

```bash
docker compose up -d
```

The `proposal`, `cloudflared`, and `cloudflared-backup` containers use `restart: always`.
The two Cloudflared containers register two independent connectors for the same tunnel, so one tunnel container can restart while the other continues serving traffic.

## NAS Monthly Portfolio Data Update

The NAS owns monthly data refreshes. The Mac is not required.

Manual run on the NAS:

```bash
cd "/volume1/docker/Triton Fund proposal"
sh scripts/update-all-data.sh
```

Recommended NAS crontab entry:

```cron
15 7 8-28 * * cd "/volume1/docker/Triton Fund proposal" && sh scripts/update-all-data.sh
05 7 * * * cd "/volume1/docker/Triton Fund proposal" && sh scripts/update-tax-rates.sh
45 7 * * * cd "/volume1/docker/Triton Fund proposal" && sh scripts/backup-data-to-github.sh
```

GitHub backup credentials are expected at `.secrets/github_backup_ed25519` and `.secrets/github_known_hosts`.
Logs are written to `logs/portfolio-update.*.log`, `logs/fidelity-update.*.log`, `logs/tax-rates-update.*.log`, and `logs/github-backup.*.log`.
Backups are written to `backups/portfolio-data/` and `backups/fidelity-data/`.
