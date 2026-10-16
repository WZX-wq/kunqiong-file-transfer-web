#!/usr/bin/env bash
set -euo pipefail

app_name="$1"
compose_dir="$2"
release="$3"
backup_dir="$compose_dir/backups/$(date -u +%Y%m%dT%H%M%SZ)-${release:0:12}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
printf '%s\n' "$backup_dir" > "$compose_dir/.last-deployment-backup"
chmod 600 "$compose_dir/.last-deployment-backup"
for file in .env docker-compose.test.yml clamd.conf; do
  if [ -f "$compose_dir/$file" ]; then
    cp "$compose_dir/$file" "$backup_dir/$file"
    chmod 600 "$backup_dir/$file"
  fi
done
if ! docker inspect "$app_name" >/dev/null 2>&1; then
  echo "Deployment configuration backup: $backup_dir (first app deployment)"
  exit 0
fi

previous_image="$(docker inspect -f '{{.Image}}' "$app_name")"
volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$app_name")"
if [ -z "$volume" ]; then
  echo "Existing app storage is not the expected named volume; refusing to skip its backup" >&2
  exit 1
fi
printf '%s\n' "$previous_image" > "$backup_dir/previous-image.txt"
docker image tag "$previous_image" "$app_name:rollback-$(basename "$backup_dir")"
paused_here=false
resume_app() {
  if [ "$paused_here" = true ]; then docker unpause "$app_name" >/dev/null; fi
}
trap resume_app EXIT
if [ "$(docker inspect -f '{{.State.Running}}' "$app_name")" = true ] && [ "$(docker inspect -f '{{.State.Paused}}' "$app_name")" = false ]; then
  docker pause "$app_name" >/dev/null
  paused_here=true
fi
# Files are kept in the original storage volume. Back up all metadata and the
# complete independent audit directory before startup can migrate either format.
docker run --rm --network none --entrypoint node \
  --mount "type=volume,src=$volume,dst=/data,readonly" \
  --mount "type=bind,src=$backup_dir,dst=/backup" \
  "$previous_image" -e '
const fs = require("fs"), path = require("path");
for (const name of ["metadata.json", "metadata.json.bak", "metadata.json.revision", ".private-key", "audit"]) {
  const source = path.join("/data", name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join("/backup", name), { recursive: true });
}
fs.writeFileSync("/backup/backup-complete.json", JSON.stringify({ completedAt: new Date().toISOString(), metadata: fs.existsSync("/backup/metadata.json"), audit: fs.existsSync("/backup/audit") }));
'
echo "Deployment data and configuration backup: $backup_dir"
