# Fund Proposal

Static Triton Wealth proposal site with a small Node.js password gate.

## Runtime

- Default local port: `127.0.0.1:8790`
- Password hash is loaded from `.triton-auth.json` or `TRITON_PASSWORD_HASH`.
- `.triton-auth.json` is intentionally not committed because this repository is public.
- Portfolio data is served through `/api/portfolio-data` with `Cache-Control: no-store`.
- `/api/data-health` reports data age and flags portfolio performance data as stale after 45 days by default.
- Portfolio performance is updated on the NAS by `scripts/update-portfolio-data.sh`, which downloads Equitable/Fundata FundSummary PDFs, parses the official return tables, backs up the prior JSON, and rewrites `portfolio_data.json`.
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
sh scripts/update-portfolio-data.sh
```

Recommended NAS crontab entry:

```cron
15 7 8 * * cd "/volume1/docker/Triton Fund proposal" && sh scripts/update-portfolio-data.sh
```

Logs are written to `logs/portfolio-update.*.log`.
Backups are written to `backups/portfolio-data/`.
