# Fund Proposal

Static Triton Wealth proposal site with a small Node.js password gate.

## Runtime

- Default local port: `127.0.0.1:8790`
- Password hash is loaded from `.triton-auth.json` or `TRITON_PASSWORD_HASH`.
- `.triton-auth.json` is intentionally not committed because this repository is public.

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
