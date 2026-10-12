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
DEPLOY_VERIFY_MODE="${KUNQIONG_DEPLOY_VERIFY_MODE:-runtime}"

case "$DEPLOY_VERIFY_MODE" in
  runtime|configuration) ;;
  *) echo "KUNQIONG_DEPLOY_VERIFY_MODE must be runtime or configuration" >&2; exit 1 ;;
esac

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
KUNQIONG_ADMIN_USERNAME=${KUNQIONG_ADMIN_USERNAME:-}
KUNQIONG_ADMIN_PASSWORD=${KUNQIONG_ADMIN_PASSWORD:-}
KUNQIONG_SCAN_MODE=required
KUNQIONG_CLAMAV_HOST=${KUNQIONG_CLAMAV_HOST:-127.0.0.1}
KUNQIONG_CLAMAV_PORT=${KUNQIONG_CLAMAV_PORT:-3310}
KUNQIONG_SCAN_TIMEOUT_MS=${KUNQIONG_SCAN_TIMEOUT_MS:-600000}
KUNQIONG_TEST_ENTERPRISE_USER_KEYS=${KUNQIONG_TEST_ENTERPRISE_USER_KEYS:-${KUNQIONG_TEST_ENTERPRISE_USER_IDS:-}}
KUNQIONG_TEST_ENTERPRISE_ALL=${KUNQIONG_TEST_ENTERPRISE_ALL:-false}
KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=${KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST:-true}
KUNQIONG_VERIFICATION_DEBUG=${KUNQIONG_VERIFICATION_DEBUG:-false}
KUNQIONG_SMTP_HOST=${KUNQIONG_SMTP_HOST:-}
KUNQIONG_SMTP_PORT=${KUNQIONG_SMTP_PORT:-465}
KUNQIONG_SMTP_SECURE=${KUNQIONG_SMTP_SECURE:-true}
KUNQIONG_SMTP_USER=${KUNQIONG_SMTP_USER:-}
KUNQIONG_SMTP_PASSWORD=${KUNQIONG_SMTP_PASSWORD:-}
KUNQIONG_SMTP_FROM=${KUNQIONG_SMTP_FROM:-}
KUNQIONG_SMTP_FROM_NAME=${KUNQIONG_SMTP_FROM_NAME:-鲲穹文件传输}
KUNQIONG_TENCENT_SECRET_ID=${KUNQIONG_TENCENT_SECRET_ID:-}
KUNQIONG_TENCENT_SECRET_KEY=${KUNQIONG_TENCENT_SECRET_KEY:-}
KUNQIONG_TENCENT_SMS_SDK_APP_ID=${KUNQIONG_TENCENT_SMS_SDK_APP_ID:-}
KUNQIONG_TENCENT_SMS_SIGN_NAME=${KUNQIONG_TENCENT_SMS_SIGN_NAME:-}
KUNQIONG_TENCENT_SMS_REGION=${KUNQIONG_TENCENT_SMS_REGION:-ap-guangzhou}
KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID:-}
KUNQIONG_TENCENT_SMS_TEMPLATE_LOGIN_CODE_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_LOGIN_CODE_ID:-}
KUNQIONG_TENCENT_SMS_TEMPLATE_PASSWORD_CODE_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_PASSWORD_CODE_ID:-}
KUNQIONG_TENCENT_SMS_TEMPLATE_WORKSPACE_INVITE_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_WORKSPACE_INVITE_ID:-}
KUNQIONG_TENCENT_SMS_TEMPLATE_FILE_SHARE_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_FILE_SHARE_ID:-}
KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_ACTIVATED_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_ACTIVATED_ID:-}
KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_EXPIRING_ID=${KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_EXPIRING_ID:-}
KUNQIONG_RELEASE_SHA=$RELEASE_SHA
EOF
}

require_var KUNQIONG_APP_URL
require_var KUNQIONG_AUTH_CALLBACK_URL
require_var KUNQIONG_OAUTH_CLIENT_ID
require_var KUNQIONG_OAUTH_CLIENT_SECRET

mkdir -p "$DEPLOY_DIR" "$RUNTIME_DIR" "$LOG_DIR"

preserve_existing_config() {
  local existing_file="$COMPOSE_DIR/.env"
  [ -f "$existing_file" ] || existing_file="$DEPLOY_DIR/.env"
  [ -f "$existing_file" ] || return 0
  local name line
  for name in \
    KUNQIONG_ADMIN_USERNAME KUNQIONG_ADMIN_PASSWORD \
    KUNQIONG_SMTP_HOST KUNQIONG_SMTP_PORT KUNQIONG_SMTP_SECURE KUNQIONG_SMTP_USER \
    KUNQIONG_SMTP_PASSWORD KUNQIONG_SMTP_FROM KUNQIONG_TENCENT_SECRET_ID \
    KUNQIONG_TENCENT_SECRET_KEY KUNQIONG_TENCENT_SMS_SDK_APP_ID KUNQIONG_TENCENT_SMS_SIGN_NAME \
    KUNQIONG_TENCENT_SMS_REGION KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID \
    KUNQIONG_TENCENT_SMS_TEMPLATE_LOGIN_CODE_ID KUNQIONG_TENCENT_SMS_TEMPLATE_PASSWORD_CODE_ID \
    KUNQIONG_TENCENT_SMS_TEMPLATE_WORKSPACE_INVITE_ID KUNQIONG_TENCENT_SMS_TEMPLATE_FILE_SHARE_ID \
    KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_ACTIVATED_ID KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_EXPIRING_ID
  do
    if [ -n "${!name:-}" ]; then
      continue
    fi
    line="$(grep -m1 "^${name}=" "$existing_file" 2>/dev/null || true)"
    if [ -n "$line" ]; then
      export "$name=${line#*=}"
    fi
  done
}

preserve_existing_config

normalize_gitea_env_values() {
  local name value
  for name in \
    KUNQIONG_ADMIN_USERNAME KUNQIONG_ADMIN_PASSWORD \
    KUNQIONG_SMTP_HOST KUNQIONG_SMTP_PORT KUNQIONG_SMTP_SECURE KUNQIONG_SMTP_USER \
    KUNQIONG_SMTP_PASSWORD KUNQIONG_SMTP_FROM KUNQIONG_TENCENT_SECRET_ID \
    KUNQIONG_TENCENT_SECRET_KEY KUNQIONG_TENCENT_SMS_SDK_APP_ID KUNQIONG_TENCENT_SMS_SIGN_NAME \
    KUNQIONG_TENCENT_SMS_REGION KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID \
    KUNQIONG_TENCENT_SMS_TEMPLATE_LOGIN_CODE_ID KUNQIONG_TENCENT_SMS_TEMPLATE_PASSWORD_CODE_ID \
    KUNQIONG_TENCENT_SMS_TEMPLATE_WORKSPACE_INVITE_ID KUNQIONG_TENCENT_SMS_TEMPLATE_FILE_SHARE_ID \
    KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_ACTIVATED_ID KUNQIONG_TENCENT_SMS_TEMPLATE_MEMBERSHIP_EXPIRING_ID
  do
    value="${!name:-}"
    if [[ "$value" == "%!t(string="*")" ]]; then
      value="${value#'%!t(string='}"
      value="${value%)}"
      export "$name=$value"
    fi
  done
}

normalize_gitea_env_values
require_var KUNQIONG_ADMIN_USERNAME
require_var KUNQIONG_ADMIN_PASSWORD
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
    environment:
      KUNQIONG_SCAN_MODE: required
      KUNQIONG_CLAMAV_HOST: scanner
      KUNQIONG_CLAMAV_PORT: "3310"
    depends_on:
      scanner:
        condition: service_healthy
    volumes:
      - storage:/app/storage

  scanner:
    image: clamav/clamav:1.4
    restart: unless-stopped
    volumes:
      - clamav-data:/var/lib/clamav
      - $COMPOSE_DIR/clamd.conf:/etc/clamav/clamd.conf:ro
    healthcheck:
      # clamd binds IPv4; localhost can resolve to an unavailable IPv6 listener.
      test: ["CMD-SHELL", "echo PING | nc -w 2 127.0.0.1 3310 | grep -qx PONG"]
      interval: 30s
      timeout: 10s
      retries: 20
      start_period: 120s

volumes:
  storage:
    name: $APP_NAME-storage
  clamav-data:
    name: $APP_NAME-clamav-data
EOF
}

verify_container_configuration() {
  local expected_image actual_image name actual_value
  expected_image="$(docker image inspect -f '{{.Id}}' "$IMAGE_NAME")"
  actual_image="$(docker inspect -f '{{.Image}}' "$APP_NAME")"
  if [ "$expected_image" != "$actual_image" ]; then
    echo "App container does not use the deployed image" >&2
    return 1
  fi
  for name in KUNQIONG_ADMIN_USERNAME KUNQIONG_ADMIN_PASSWORD; do
    actual_value="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_NAME" | sed -n "s/^${name}=//p")"
    if [ "$actual_value" != "${!name}" ]; then
      echo "App container configuration mismatch: $name" >&2
      return 1
    fi
  done
  actual_value="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_NAME" | sed -n 's/^KUNQIONG_RELEASE_SHA=//p')"
  if [ "$actual_value" != "$RELEASE_SHA" ]; then
    echo "App container release does not match this deployment" >&2
    return 1
  fi
  echo "Deployment configuration verified: image, release and administrator credentials"
}

deploy_with_docker() {
  docker info >/dev/null 2>&1 || return 1
  docker build -t "$IMAGE_NAME" .

  mkdir -p "$COMPOSE_DIR"
  write_compose_file "$COMPOSE_DIR/$COMPOSE_FILE"
  cp deployment/clamd.conf "$COMPOSE_DIR/clamd.conf"
  cp "$ENV_FILE" "$COMPOSE_DIR/.env"
  chmod 600 "$COMPOSE_DIR/.env" 2>/dev/null || true

  # 处理同名容器，避免 `up` 直接 Conflict 失败。
  #
  # 关键：不能对所有同名容器一律 docker rm -f —— 测试机上真正对外提供 8045 服务的
  # 容器是由 compose 管理的，删掉它之后新建的容器往往拿不到主机端口绑定，
  # 结果 CI 显示成功但线上仍是旧版本（run #35 的教训）。
  # 因此分两种情况：
  #   1) 容器属于当前 compose 项目或没有项目标签 -> 交给 compose 自己 recreate；
  #   2) 容器属于其它 compose 项目            -> 先 down 掉那个旧项目再重建。
  if docker inspect "$APP_NAME" >/dev/null 2>&1; then
    existing_proj="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$APP_NAME" 2>/dev/null || true)"
    if [ -n "$existing_proj" ] && [ "$existing_proj" != "$APP_NAME" ]; then
      echo "Removing container '$APP_NAME' owned by foreign compose project '$existing_proj'"
      docker compose -p "$existing_proj" down --remove-orphans >/dev/null 2>&1 || true
      docker rm -f "$APP_NAME" >/dev/null 2>&1 || true
    else
      echo "Container '$APP_NAME' will be recreated by compose (project: ${existing_proj:-$APP_NAME})"
    fi
  fi

  # This test server intentionally stops containers automatically. Validate the
  # installed image and configuration independently of its runtime policy.
  if [ "$DEPLOY_VERIFY_MODE" = "configuration" ]; then
    ( cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" create --force-recreate --remove-orphans )
    verify_container_configuration
    local configured_scanner_id
    configured_scanner_id="$(cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" ps -a -q scanner)"
    docker start "$configured_scanner_id" "$APP_NAME"
    echo "Deployment complete; automatic container shutdown is managed by the server"
    return 0
  fi

  if ! ( cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans ); then
    echo "Compose startup failed; collecting scanner diagnostics" >&2
    ( cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" ps -a && docker compose -f "$COMPOSE_FILE" logs --no-color --tail 120 scanner ) >&2 || true
    local scanner_id
    scanner_id="$(cd "$COMPOSE_DIR" && docker compose -f "$COMPOSE_FILE" ps -a -q scanner)"
    if [ -n "$scanner_id" ]; then
      docker inspect -f 'Scanner state: {{json .State}}' "$scanner_id" >&2 || true
      docker inspect -f 'Scanner resources: memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}} restartCount={{.RestartCount}}' "$scanner_id" >&2 || true
      docker events --since 3m --until "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --filter "container=$scanner_id" >&2 || true
    fi
    free -m >&2 || true
    df -h "$COMPOSE_DIR" >&2 || true
    dmesg --ctime 2>/dev/null | grep -Ei 'out of memory|oom-kill|killed process|clamd' | tail -20 >&2 || true
    return 1
  fi

  # 校验：运行中的容器 release 必须是本次提交，否则说明端口仍被旧容器占用。
  healthcheck_docker || return 1
  local running_release
  running_release="$(docker exec "$APP_NAME" node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '$PORT') + '/api/health').then(r=>r.json()).then(j=>process.stdout.write(String(j.release||''))).catch(()=>process.stdout.write(''))" 2>/dev/null || true)"
  echo "Deployed release: ${running_release:-<unknown>} (expected: $RELEASE_SHA)"
  if [ -z "$running_release" ] || [ "$running_release" != "$RELEASE_SHA" ]; then
    echo "Running container release does not match the deployed commit." >&2
    return 1
  fi

  return 0
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

if docker info >/dev/null 2>&1; then
  deploy_with_docker
  exit $?
fi

if running_in_container; then
  echo "Docker deployment failed or Docker is not available inside the CI container, so the service cannot be deployed persistently from this job." >&2
  exit 1
fi

deploy_with_process_manager
