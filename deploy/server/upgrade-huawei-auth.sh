#!/usr/bin/env bash
# ============================================================
# v0.5.0 服务端升级：部署 huawei-auth Edge Function + profiles_huawei 迁移
#
# 前提：已按 deploy/server/setup.sh 完成初始部署（/opt/supabase/docker 存在，
#       db/auth/rest/api-gw 已在运行）。
#
# 上传布局（脚本与下列两个目录同级）：
#   upgrade-huawei-auth.sh
#   functions/huawei-auth/index.ts
#   migrations/20261104000000_huawei_auth.sql
#
# 用法：
#   sudo bash upgrade-huawei-auth.sh
#   HUAWEI_CLIENT_ID=xxx HUAWEI_CLIENT_SECRET=yyy sudo -E bash upgrade-huawei-auth.sh
#
# HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET 来自 AGC「华为账号登录」，
# Client ID 需与 App 端 module.json5 的 metadata client_id 一致。
# ============================================================
set -euo pipefail

BASE=/opt/supabase
DOCKER_DIR="$BASE/docker"
MIGRATIONS_DIR="$BASE/migrations"
FUN_VOL="$DOCKER_DIR/volumes/functions"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

[ -f "$DOCKER_DIR/docker-compose.yml" ] || { echo "[ERROR] 缺少 $DOCKER_DIR/docker-compose.yml"; exit 1; }
[ -f "$SRC_DIR/functions/huawei-auth/index.ts" ] || { echo "[ERROR] 缺少 $SRC_DIR/functions/huawei-auth/index.ts"; exit 1; }
[ -f "$SRC_DIR/migrations/20261104000000_huawei_auth.sql" ] || { echo "[ERROR] 缺少迁移文件"; exit 1; }

# ---------- 1. 上传函数代码（含 edge-runtime 入口 main） ----------
echo "==> 部署函数代码..."
mkdir -p "$FUN_VOL"
for d in "$SRC_DIR/functions"/*/; do
  name="$(basename "$d")"
  mkdir -p "$FUN_VOL/$name"
  cp "$d"*.ts "$FUN_VOL/$name/"
  find "$FUN_VOL/$name" -name '*.ts' -exec sed -i 's/\r$//' {} +
  echo "  - $name"
done
[ -f "$FUN_VOL/main/index.ts" ] || { echo "[ERROR] 缺少 $FUN_VOL/main/index.ts（edge-runtime 入口）"; exit 1; }

# ---------- 2. 华为凭据写入 .env ----------
cd "$DOCKER_DIR"
upsert_env() { # $1=key $2=value
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >>.env; fi
}
if [ -n "${HUAWEI_CLIENT_ID:-}" ] && [ -n "${HUAWEI_CLIENT_SECRET:-}" ]; then
  upsert_env HUAWEI_CLIENT_ID "$HUAWEI_CLIENT_ID"
  upsert_env HUAWEI_CLIENT_SECRET "$HUAWEI_CLIENT_SECRET"
  [ -n "${HUAWEI_REDIRECT_URI:-}" ] && upsert_env HUAWEI_REDIRECT_URI "$HUAWEI_REDIRECT_URI" || true
  echo "==> 已写入 HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET"
elif grep -q '^HUAWEI_CLIENT_ID=.\+' .env && grep -q '^HUAWEI_CLIENT_SECRET=.\+' .env; then
  echo "==> .env 已存在华为凭据，复用"
else
  echo "[WARN] 未配置 HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET；函数会部署但登录时返回凭据缺失错误。"
  echo "       请稍后执行: HUAWEI_CLIENT_ID=... HUAWEI_CLIENT_SECRET=... sudo -E bash $0"
fi

# ---------- 2.5 函数容器注入 HUAWEI_*（compose override，不动原 compose） ----------
OVERRIDE="$DOCKER_DIR/docker-compose.override.yml"
if [ -f "$OVERRIDE" ] && ! grep -q 'HUAWEI_CLIENT_ID' "$OVERRIDE"; then
  cp "$OVERRIDE" "$OVERRIDE.bak.$(date +%s)"
  echo "[WARN] 已存在 override（已备份），请手工合并 HUAWEI_* 环境变量后重跑"
  exit 1
fi
cat >"$OVERRIDE" <<'EOF'
# 由 upgrade-huawei-auth.sh 生成：为 edge-functions 注入华为账号登录凭据
services:
  functions:
    environment:
      HUAWEI_CLIENT_ID: ${HUAWEI_CLIENT_ID:-}
      HUAWEI_CLIENT_SECRET: ${HUAWEI_CLIENT_SECRET:-}
      HUAWEI_REDIRECT_URI: ${HUAWEI_REDIRECT_URI:-}
EOF
echo "==> 已写入 docker-compose.override.yml"
# setup.sh 在 .env 中固定了 COMPOSE_FILE=docker-compose.yml，会屏蔽 override 自动加载
if grep '^COMPOSE_FILE=' .env | grep -qv 'override'; then
  sed -i 's|^COMPOSE_FILE=.*|COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml|' .env
  echo "==> COMPOSE_FILE 已包含 override"
fi

# ---------- 3. 业务迁移（幂等） ----------
mkdir -p "$MIGRATIONS_DIR"
cp "$SRC_DIR/migrations/20261104000000_huawei_auth.sql" "$MIGRATIONS_DIR/"
sed -i 's/\r$//' "$MIGRATIONS_DIR/20261104000000_huawei_auth.sql"
if docker compose exec -T db psql -U postgres -tAc \
  "select 1 from public.schema_migrations where version='20261104000000'" 2>/dev/null | grep -q 1; then
  echo "==> profiles_huawei 迁移已应用，跳过"
else
  echo "==> 应用 profiles_huawei 迁移..."
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres <"$MIGRATIONS_DIR/20261104000000_huawei_auth.sql"
fi
# PostgREST 启动时缓存 schema，迁移后必须通知重载
docker compose exec -T db psql -U postgres -c "NOTIFY pgrst, 'reload schema'" >/dev/null 2>&1 || \
  docker compose restart rest

# ---------- 4. 启动 functions 服务（会自动拉起依赖 analytics） ----------
echo "==> 启动 functions 服务..."
docker compose pull functions analytics || true
docker compose up -d functions

# ---------- 5. 验证 ----------
echo "==> 验证 /functions/v1/huawei-auth ..."
CHECK_KEY="$(grep '^ANON_KEY=' .env | cut -d= -f2-)"
code=""
for i in $(seq 1 15); do
  code="$(curl -s -o /tmp/hw_resp.json -w '%{http_code}' -X POST \
    -H "apikey: $CHECK_KEY" -H "Authorization: Bearer $CHECK_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"authorizationCode":"probe","state":"probe"}' \
    http://localhost:8000/functions/v1/huawei-auth || true)"
  [ -n "$code" ] && [ "$code" != "503" ] && [ "$code" != "000" ] && break
  sleep 2
done
echo "    HTTP $code  $(head -c 200 /tmp/hw_resp.json 2>/dev/null)"
if [ "$code" = "503" ] || [ "$code" = "000" ] || [ -z "$code" ]; then
  echo "[WARN] 函数网关仍不可用，排查: docker compose ps; docker compose logs functions --tail 50"
  exit 1
fi

cat <<EOF

============================================================
✅ huawei-auth 升级完成
  - 函数代码: $FUN_VOL/huawei-auth/index.ts
  - 迁移: 20261104000000_huawei_auth.sql（profiles_huawei）
  - 探测: HTTP $code（4xx JSON 属正常，503 才异常）
============================================================
EOF
