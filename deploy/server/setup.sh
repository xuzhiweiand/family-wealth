#!/usr/bin/env bash
# ============================================================
# 腾讯云 CVM 一键部署自托管 Supabase（适配官方 2026.09 Envoy 版 compose）
#
# 适用：全新 Ubuntu 22.04 / 2核4G（部署前先在轻量控制台放行 TCP 8000）
# 用法：
#   sudo bash setup.sh                 # 自动探测公网 IP
#   sudo bash setup.sh 1.2.3.4         # 手动指定公网 IP
#
# 目录约定（上传后）：
#   /opt/supabase/docker/docker-compose.yml   官方 compose（本仓库 deploy 包提供）
#   /opt/supabase/docker/volumes/...          官方挂载配置
#   /opt/supabase/migrations/*.sql            业务迁移（本仓库 supabase/migrations）
#
# 资源策略（4G 内存裁剪）：
#   只启动 db / auth / rest / api-gw / studio / meta 六个核心服务；
#   realtime / storage / imgproxy / functions / supavisor 不启动
#   （App 只用 REST + Auth；Envoy 对缺失上游只返回 503，不影响其余路由）。
#   如需补齐：cd /opt/supabase/docker && docker compose up -d <服务名>
# ============================================================
set -euo pipefail

SERVER_IP="${1:-}"
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="$(curl -fsSL --max-time 5 https://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null || true)"
fi
if [ -z "$SERVER_IP" ]; then
  echo "[ERROR] 无法获取公网 IP，请用: sudo bash setup.sh <公网IP>"
  exit 1
fi
echo "==> 公网 IP: $SERVER_IP"

BASE=/opt/supabase
DOCKER_DIR="$BASE/docker"
MIGRATIONS_DIR="$BASE/migrations"
[ -f "$DOCKER_DIR/docker-compose.yml" ] || { echo "[ERROR] 缺少 $DOCKER_DIR/docker-compose.yml"; exit 1; }

# ---------- 0. 行尾归一（Windows 上传的文件可能是 CRLF） ----------
find "$BASE" -type f \( -name '*.sh' -o -name '*.yml' -o -name '*.yaml' -o -name '*.sql' -o -name '.env*' \) \
  -exec sed -i 's/\r$//' {} +

# ---------- 1. swap（防 OOM） ----------
if ! swapon --show=NAME | grep -q .; then
  echo "==> 创建 2G swap..."
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
else
  echo "==> swap 已存在"
fi

# ---------- 2. Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> 安装 Docker..."
  curl -fsSL https://get.docker.com | sh \
    || { echo "get.docker.com 失败，改用腾讯云镜像源安装 docker-ce...";
        apt-get update && apt-get install -y ca-certificates curl gnupg
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://mirrors.cloud.tencent.com/docker-ce/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.cloud.tencent.com/docker-ce/linux/ubuntu jammy stable" >/etc/apt/sources.list.d/docker.list
        apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; }
else
  echo "==> Docker 已安装: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || { echo "[ERROR] 缺少 docker compose 插件"; exit 1; }

# 腾讯云内网 Docker Hub 镜像加速
mkdir -p /etc/docker
if ! grep -q mirror.ccs.tencentyun.com /etc/docker/daemon.json 2>/dev/null; then
  cat >/etc/docker/daemon.json <<'JSON'
{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }
JSON
  systemctl restart docker
fi

# ---------- 3. 生成 .env 与密钥（已存在则复用，保证重跑不换钥） ----------
cd "$DOCKER_DIR"
if [ -f .env ]; then
  echo "==> .env 已存在，复用既有密钥"
else
  echo "==> 生成 .env 与全部密钥..."
  hex() { openssl rand -hex "$1"; }

  PG_PASSWORD="$(hex 24)"
  JWT_SECRET="$(hex 32)"
  SECRET_KEY_BASE="$(hex 48)"
  REALTIME_DB_ENC_KEY="$(hex 8)"    # 恰 16 字符
  VAULT_ENC_KEY="$(hex 16)"         # 恰 32 字符
  PG_META_CRYPTO_KEY="$(hex 24)"
  DASH_USER="admin"
  DASH_PASS="$(hex 12)"

  b64url() { openssl base64 -e -A | tr '+/' '-_' | tr -d '='; }
  jwt_sign() { # $1=payload JSON  $2=secret
    local h="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" p s
    p="$(printf '%s' "$1" | b64url)"
    s="$(printf '%s' "$h.$p" | openssl dgst -binary -sha256 -hmac "$2" | b64url)"
    echo "$h.$p.$s"
  }
  IAT="$(date +%s)"; EXP="$((IAT + 631152000))" # 20 年
  ANON_KEY="$(jwt_sign "{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":$IAT,\"exp\":$EXP}" "$JWT_SECRET")"
  SERVICE_KEY="$(jwt_sign "{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":$IAT,\"exp\":$EXP}" "$JWT_SECRET")"

  cat >.env <<EOF
COMPOSE_FILE=docker-compose.yml

# ---- 密钥 ----
POSTGRES_PASSWORD=$PG_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_KEY
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
JWT_KEYS=
JWT_JWKS=
DASHBOARD_USERNAME=$DASH_USER
DASHBOARD_PASSWORD=$DASH_PASS
SECRET_KEY_BASE=$SECRET_KEY_BASE
REALTIME_DB_ENC_KEY=$REALTIME_DB_ENC_KEY
VAULT_ENC_KEY=$VAULT_ENC_KEY
PG_META_CRYPTO_KEY=$PG_META_CRYPTO_KEY
LOGFLARE_PUBLIC_ACCESS_TOKEN=$(hex 24)
LOGFLARE_PRIVATE_ACCESS_TOKEN=$(hex 24)
S3_PROTOCOL_ACCESS_KEY_ID=
S3_PROTOCOL_ACCESS_KEY_SECRET=

# ---- 地址 ----
SUPABASE_PUBLIC_URL=http://$SERVER_IP:8000
API_EXTERNAL_URL=http://$SERVER_IP:8000/auth/v1
SITE_URL=http://$SERVER_IP:8000
ADDITIONAL_REDIRECT_URLS=

# ---- 数据库 ----
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_TENANT_ID=local
POOLER_DB_POOL_SIZE=5

# ---- Studio ----
STUDIO_DEFAULT_ORGANIZATION=FamilyWealth
STUDIO_DEFAULT_PROJECT=family-wealth
OPENAI_API_KEY=

# ---- Auth（邮箱注册即开通：IP 直连无回调域名，收不了确认邮件）----
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=true
MAILER_URLPATHS_CONFIRMATION="/auth/v1/verify"
MAILER_URLPATHS_INVITE="/auth/v1/verify"
MAILER_URLPATHS_RECOVERY="/auth/v1/verify"
MAILER_URLPATHS_EMAIL_CHANGE="/auth/v1/verify"
SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=

# ---- PostgREST ----
PGRST_DB_SCHEMAS=public,graphql_public
PGRST_DB_MAX_ROWS=1000
PGRST_DB_EXTRA_SEARCH_PATH=public

# ---- 其他（storage/functions/日志代理，默认不启动，占位即可）----
GLOBAL_S3_BUCKET=stub
REGION=stub
STORAGE_TENANT_ID=stub
FUNCTIONS_VERIFY_JWT=false
IMGPROXY_AUTO_WEBP=true
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
GOOGLE_PROJECT_ID=
GOOGLE_PROJECT_NUMBER=
API_GW_HTTP_PORT=8000
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443
ANON_KEY_ASYMMETRIC=
SERVICE_ROLE_KEY_ASYMMETRIC=
PROXY_DOMAIN=
CERTBOT_EMAIL=
MINIO_ROOT_USER=supa-storage
MINIO_ROOT_PASSWORD=$(hex 16)
EOF
  chmod 600 .env
fi

# ---------- 4. 启动核心六服务 ----------
echo "==> 拉取镜像并启动核心服务（首次需几分钟）..."
docker compose pull studio api-gw auth rest db meta
docker compose up -d studio api-gw auth rest db meta

echo "==> 等待数据库就绪..."
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && { echo "[ERROR] 数据库 3 分钟未就绪"; docker compose ps; exit 1; }
  sleep 3
done

# ---------- 5. 业务迁移 ----------
if [ -d "$MIGRATIONS_DIR" ] && ls "$MIGRATIONS_DIR"/*.sql >/dev/null 2>&1; then
  echo "==> 应用业务迁移..."
  for f in "$MIGRATIONS_DIR"/*.sql; do
    name="$(basename "$f")"
    # 幂等：已应用过则跳过
    if docker compose exec -T db psql -U postgres -tAc \
      "select 1 from public.schema_migrations where version='$(echo "$name" | cut -c1-14)'" 2>/dev/null | grep -q 1; then
      echo "  - $name 已应用，跳过"; continue
    fi
    echo "  - $name"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres <"$f"
  done
else
  echo "==> [WARN] 未找到迁移文件 $MIGRATIONS_DIR/*.sql，跳过"
fi

# postgrest 在启动时缓存 schema，迁移在其后执行必须通知重载，
# 否则 RPC/新表对 REST 不可见（PGRST202/204）
docker compose exec -T db psql -U postgres -c "NOTIFY pgrst, 'reload schema'" >/dev/null 2>&1 || \
  docker compose restart rest

# ---------- 6. 健康验证 ----------
echo "==> 验证网关..."
CHECK_KEY="$(grep '^ANON_KEY=' .env | cut -d= -f2-)"
ok=0
for i in $(seq 1 30); do
  auth_ok="$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $CHECK_KEY" http://localhost:8000/auth/v1/health || true)"
  rest_ok="$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $CHECK_KEY" http://localhost:8000/rest/v1/ || true)"
  if [ "$auth_ok" = "200" ] && [ "$rest_ok" = "200" ]; then ok=1; break; fi
  sleep 4
done
if [ "$ok" = "1" ]; then
  echo "    auth /health: 200  |  rest /: 200"
else
  echo "[WARN] 网关暂未全部 200（auth=$auth_ok rest=$rest_ok），可稍后自查: docker compose ps"
fi

ANON_KEY_PRINT="$(grep '^ANON_KEY=' .env | cut -d= -f2-)"
DASH_USER_PRINT="$(grep '^DASHBOARD_USERNAME=' .env | cut -d= -f2-)"
DASH_PASS_PRINT="$(grep '^DASHBOARD_PASSWORD=' .env | cut -d= -f2-)"

cat <<EOF

============================================================
✅ 部署完成（核心六服务：db auth rest api-gw studio meta）

App 环境变量：
  EXPO_PUBLIC_SUPABASE_URL=http://$SERVER_IP:8000
  EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY_PRINT

Studio（SSH 隧道访问，不对公网开放）：
  ssh -L 3000:localhost:8000 ubuntu@$SERVER_IP
  浏览器打开 http://localhost:3000/project/default
  登录：$DASH_USER_PRINT / $DASH_PASS_PRINT

防火墙：轻量控制台需放行 TCP 8000
完整日志：cd $DOCKER_DIR && docker compose logs -f --tail 50
============================================================
EOF
