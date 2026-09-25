/**
 * 为 @react-native-oh/react-native-harmony 补齐缺失的 .harmony.js 平台文件。
 *
 * 背景：RNOH 0.77.74 的 JS 包内部分模块只带 .ios.js/.android.js，
 * Metro 以 --platform harmony 打包时找不到同名 .harmony.js 会报
 * "Unable to resolve module"。这里统一以 .ios.js 实现作为鸿蒙侧副本。
 *
 * 幂等：重复执行会覆盖已有 .harmony.js。
 * 用法：node scripts/prepare-harmony-stubs.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');

let rnohRoot;
try {
  const pkgJsonPath = require.resolve(
    '@react-native-oh/react-native-harmony/package.json',
    { paths: [appRoot] }
  );
  rnohRoot = path.dirname(pkgJsonPath);
} catch {
  console.error(
    '[harmony-stubs] 未找到 @react-native-oh/react-native-harmony，请先执行 pnpm install'
  );
  process.exit(1);
}

// 需要从 .ios.js 复制为 .harmony.js 的模块（相对 RNOH 包根，不含扩展名）
const MODULES = [
  'Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent',
  'Libraries/Network/RCTNetworking',
  'src/private/debugging/ReactDevToolsSettingsManager',
];

let copied = 0;
for (const rel of MODULES) {
  const src = path.join(rnohRoot, `${rel}.ios.js`);
  const dest = path.join(rnohRoot, `${rel}.harmony.js`);
  if (!fs.existsSync(src)) {
    console.warn(`[harmony-stubs] 源文件缺失，跳过: ${rel}.ios.js`);
    continue;
  }
  fs.copyFileSync(src, dest);
  copied += 1;
  console.log(`[harmony-stubs] ${path.basename(dest)}`);
}

console.log(`[harmony-stubs] 完成，${copied}/${MODULES.length} 个模块已就绪`);
