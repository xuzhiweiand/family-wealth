#!/bin/bash
# 鸿蒙 RN Bundle 打包脚本
# 用法: ./scripts/bundle-harmony.sh [--dev]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")"
HARMONY_DIR="$MOBILE_DIR/harmony"
RAWFILE_DIR="$HARMONY_DIR/entry/src/main/resources/rawfile"

DEV_MODE="false"
if [[ "$1" == "--dev" ]]; then
  DEV_MODE="true"
fi

echo "=== 鸿蒙 RN Bundle 打包 ==="
echo "开发模式: $DEV_MODE"
echo "输出目录: $RAWFILE_DIR"

# 确保 rawfile 目录存在
mkdir -p "$RAWFILE_DIR/bundle"

cd "$MOBILE_DIR"

# 清理旧 bundle
rm -rf "$RAWFILE_DIR/bundle/*"
rm -rf "$RAWFILE_DIR/assets/*"

# 打包
if [[ "$DEV_MODE" == "true" ]]; then
  pnpm react-native bundle \
    --platform harmony \
    --dev true \
    --entry-file index.js \
    --bundle-output "$RAWFILE_DIR/bundle/index.harmony.bundle" \
    --assets-dest "$RAWFILE_DIR/"
else
  pnpm react-native bundle \
    --platform harmony \
    --dev false \
    --entry-file index.js \
    --bundle-output "$RAWFILE_DIR/bundle/index.harmony.bundle" \
    --assets-dest "$RAWFILE_DIR/" \
    --minify true
fi

echo "=== 打包完成 ==="
ls -lh "$RAWFILE_DIR/bundle/"
