#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
SECRETS_DIR="$ROOT/.secrets"
KEY_FILE="$SECRETS_DIR/github_backup_ed25519"
KNOWN_HOSTS_FILE="$SECRETS_DIR/github_known_hosts"
REMOTE="git@github.com:jieyuan166-stack/Fund-proposal.git"
IMAGE="alpine/git:latest"
STAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
LOG_FILE="$LOG_DIR/github-backup.$STAMP.log"

mkdir -p "$LOG_DIR"

{
  echo "[$(date -Iseconds)] Starting GitHub data backup"
  if [ ! -r "$KEY_FILE" ] || [ ! -r "$KNOWN_HOSTS_FILE" ]; then
    echo "Missing GitHub deploy key or known_hosts file in $SECRETS_DIR"
    exit 1
  fi

  docker run --rm \
    --env HOME=/root \
    --env HOST_UID="$(id -u)" \
    --env HOST_GID="$(id -g)" \
    --env TRITON_GIT_REMOTE="$REMOTE" \
    --env "GIT_SSH_COMMAND=ssh -i /run/triton-secrets/github_backup_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/triton-secrets/github_known_hosts" \
    --volume "$ROOT:/repo" \
    --volume "$SECRETS_DIR:/run/triton-secrets:ro" \
    --workdir /repo \
    --entrypoint /bin/sh \
    "$IMAGE" -c '
      set -eu
      trap '\''chown -R "$HOST_UID:$HOST_GID" /repo/.git'\'' EXIT
      git config --global --add safe.directory /repo

      attempt=1
      while [ "$attempt" -le 2 ]; do
        git fetch "$TRITON_GIT_REMOTE" main
        git reset --mixed FETCH_HEAD
        git add -- portfolio_data.json fidelity_data.json

        for file in investment_tax_calculator.html estate_tax_diagnostic.html; do
          git show "HEAD:$file" > "/tmp/base-$(basename "$file")" 2>/dev/null || : > "/tmp/base-$(basename "$file")"
          sed -E "s/fetched: \"[0-9-]+\"/fetched: \"<checked-date>\"/" "/tmp/base-$(basename "$file")" > "/tmp/base-normalized-$(basename "$file")"
          sed -E "s/fetched: \"[0-9-]+\"/fetched: \"<checked-date>\"/" "$file" > "/tmp/work-normalized-$(basename "$file")"
          if ! cmp -s "/tmp/base-normalized-$(basename "$file")" "/tmp/work-normalized-$(basename "$file")"; then
            git add -- "$file"
          fi
        done

        if git diff --cached --quiet; then
          echo "No data changes to back up"
          exit 0
        fi

        git -c user.name="Triton NAS Data Updater" \
          -c user.email="nas-data@tritonwealth.ca" \
          commit -m "Update automated proposal data $(date +%Y-%m-%d)"
        if git push "$TRITON_GIT_REMOTE" HEAD:main; then
          echo "GitHub data backup completed"
          exit 0
        fi

        echo "Push raced with another update; refreshing and retrying"
        attempt=$((attempt + 1))
        sleep 5
      done

      echo "GitHub data backup failed after two attempts"
      exit 1
    '

  echo "[$(date -Iseconds)] Completed GitHub data backup"
} >> "$LOG_FILE" 2>&1

find "$LOG_DIR" -name 'github-backup.*.log' -type f -mtime +180 -delete
