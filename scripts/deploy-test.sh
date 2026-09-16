#!/usr/bin/env bash
set -euo pipefail

APP_NAME="kunqiong-file-transfer-web"
IMAGE_NAME="$APP_NAME:test"
DEPLOY_DIR="${KUNQIONG_DEPLOY_DIR:-$HOME/apps/$APP_NAME}"
RUNTIME_DIR="$DEPLOY_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_FILE="$RUNTIME_DIR/server.pid"
ENV_FILE="$RUNTIME_DIR/test.env"
PORT="${PORT:-8045}"
HOST="${KUNQIONG_HOST:-0.0.0.0}"
COMPOSE_DIR="${KUNQIONG_COMPOSE_DIR:-/opt/$APP_NAME}"
COMPOSE_FILE="docker-compose.test.yml"
RELEASE_SHA="${GITHUB_SHA:-${GITEA_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}}"

require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

write_env_file() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  cat > "$target" <<EOF
NODE_ENV=test
PORT=$PORT
KUNQIONG_HOST=$HOST
KUNQIONG_APP_URL=$KUNQIONG_APP_URL
KUNQIONG_AUTH_CALLBACK_URL=$KUNQIONG_AUTH_CALLBACK_URL
KUNQIONG_OAUTH_AUTHORIZE_URL=${KUNQIONG_OAUTH_AUTHORIZE_URL:-https://login.kunqiongai.com/authorize.html}
KUNQIONG_OAUTH_TOKEN_URL=${KUNQIONG_OAUTH_TOKEN_URL:-https://login.kunqiongai.com/api/oauth/token}
KUNQIONG_OAUTH_CLIENT_ID=$KUNQIONG_OAUTH_CLIENT_ID
KUNQIONG_OAUTH_CLIENT_SECRET=$KUNQIONG_OAUTH_CLIENT_SECRET
KUNQIONG_ADMIN_USER_IDS=${KUNQIONG_ADMIN_USER_IDS:-}
KUNQIONG_SMTP_HOST=${KUNQIONG_SMTP_HOST:-}
KUNQIONG_SMTP_PORT=${KUNQIONG_SMTP_PORT:-465}
KUNQIONG_SMTP_SECURE=${KUNQIONG_SMTP_SECURE:-true}
KUNQIONG_SMTP_USER=${KUNQIONG_SMTP_USER:-}
KUNQIONG_SMTP_PASSWORD=${KUNQIONG_SMTP_PASSWORD:-}
KUNQIONG_SMTP_FROM=${KUNQIONG_SMTP_FROM:-}
KUNQIONG_SMTP_FROM_NAME=${KUNQIONG_SMTP_FROM_NAME:-鲲穹文件传输}
KUNQIONG_RELEASE_SHA=$RELEASE_SHA
EOF
}

require_var KUNQIONG_APP_URL
require_var KUNQIONG_AUTH_CALLBACK_URL
require_var KUNQIONG_OAUTH_CLIENT_ID
require_var KUNQIONG_OAUTH_CLIENT_SECRET

mkdir -p "$DEPLOY_DIR" "$RUNTIME_DIR" "$LOG_DIR"
write_env_file "$ENV_FILE"

healthcheck_docker() {
  for _ in $(seq 1 40); do
    if docker exec "$APP_NAME" node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '$PORT') + '/api/health').then(async r => { if (!r.ok) process.exit(1); console.log(await r.text()) }).catch(() => process.exit(1))"; then
      return 0
    fi
    sleep 1
  done
  docker logs --tail 100 "$APP_NAME" >&2 || true
  return 1
}

write_compose_file() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  cat > "$target" <<EOF
name: $APP_NAME

services:
  app:
    image: $IMAGE_NAME
    container_name: $APP_NAME
    restart: unless-stopped
    ports:
      - "$PORT:$PORT"
    env_file:
      - .env
    volumes:
      - storage:/app/storage

volumes:
  storage:
    name: $APP_NAME-storage
EOF
}

deploy_with_docker() {
  docker info >/dev/null 2>&1 || return 1
  docker build -t "$IMAGE_NAME" .

  mkdir -p "$COMPOSE_DIR"
  write_compose_file "$COMPOSE_DIR/$COMPOSE_FILE"
  cp "$ENV_FILE" "$COMPOSE_DIR/.env"
  chmod 600 "$COMPOSE_DIR/.env" 2>/dev/null || true

  # 清掉历史遗留的裸 docker run 容器（非 compose 管理），避免容器名冲突
  existing_proj="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$APP_NAME" 2>/dev/null || true)"
  if [ "$existing_proj" = "<no value>" ]; then
    docker rm -f "$APP_NAME" >/dev/null 2>&1 || true
  fi

  ( cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans )
  healthcheck_docker
}

copy_to_deploy_dir() {
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude ".git" \
      --exclude ".gitea" \
      --exclude "node_modules" \
      --exclude "storage" \
      --exclude "*.log" \
      ./ "$DEPLOY_DIR/"
  else
    tar \
      --exclude="./.git" \
      --exclude="./.gitea" \
      --exclude="./node_modules" \
      --exclude="./storage" \
      --exclude="./*.log" \
      -cf - . | tar -xf - -C "$DEPLOY_DIR"
  fi
  cp "$ENV_FILE" "$DEPLOY_DIR/.env"
}

stop_pid_file() {
  if [ -f "$PID_FILE" ]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" >/dev/null 2>&1; then
      kill "$old_pid" || true
      for _ in $(seq 1 20); do
        if ! kill -0 "$old_pid" >/dev/null 2>&1; then
          break
        fi
        sleep 0.3
      done
      if kill -0 "$old_pid" >/dev/null 2>&1; then
        kill -9 "$old_pid" || true
      fi
    fi
    rm -f "$PID_FILE"
  fi
}

stop_port() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:$PORT" || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "$PORT/tcp" 2>/dev/null || true)"
  fi
  if [ -n "$pids" ]; then
    kill $pids || true
    sleep 1
  fi
}

healthcheck_process() {
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/tmp/kunqiong-health.json; then
      cat /tmp/kunqiong-health.json
      return 0
    fi
    sleep 1
  done
  if [ -f "$LOG_DIR/server.log" ]; then
    tail -100 "$LOG_DIR/server.log" >&2 || true
  fi
  return 1
}

deploy_with_process_manager() {
  npm ci
  npm run build
  copy_to_deploy_dir

  cd "$DEPLOY_DIR"
  npm ci --omit=dev
  mkdir -p storage

  if command -v pm2 >/dev/null 2>&1; then
    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
      pm2 restart "$APP_NAME" --update-env
    else
      stop_port
      pm2 start "$DEPLOY_DIR/server.mjs" --name "$APP_NAME" --interpreter node --cwd "$DEPLOY_DIR" --update-env
    fi
    pm2 save || true
  else
    stop_pid_file
    stop_port
    nohup node server.mjs > "$LOG_DIR/server.log" 2>&1 &
    echo $! > "$PID_FILE"
  fi

  healthcheck_process
}

running_in_container() {
  [ -f /.dockerenv ] || { [ -r /proc/1/cgroup ] && grep -qaE 'docker|containerd|kubepods' /proc/1/cgroup; }
}

if deploy_with_docker; then
  exit 0
fi

if running_in_container; then
  echo "Docker is not available inside the CI container, so the service cannot be deployed persistently from this job." >&2
  exit 1
fi

deploy_with_process_manager
