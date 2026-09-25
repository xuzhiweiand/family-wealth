/**
 * 从 @react-native-oh/react-native-harmony npm 包复制 HAR 到鸿蒙工程 libs/。
 *
 * 背景：HAR 是 RNOH 构建产物（单文件 128MB，超过 GitHub 100MB 限制），
 * 不纳入 Git 版本控制；该 npm 包根目录已自带 3 个 HAR，安装依赖后
 * 执行本脚本即可在 harmony/libs/ 生成，供 DevEco Studio 的 ohpm overrides 引用。
 *
 * 幂等：重复执行会覆盖已有文件。
 * 用法：node scripts/prepare-harmony-hars.cjs
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
    '[harmony-hars] 未找到 @react-native-oh/react-native-harmony，请先执行 pnpm install'
  );
  process.exit(1);
}

const HARS = [
  'react_native_openharmony.har',
  'react_native_openharmony_release.har',
  'react_native_openharmony_release2.har',
];

const destDir = path.join(appRoot, 'harmony', 'libs');
fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const name of HARS) {
  const src = path.join(rnohRoot, name);
  const dest = path.join(destDir, name);
  if (!fs.existsSync(src)) {
    console.warn(`[harmony-hars] 源文件缺失，跳过: ${name}`);
    continue;
  }
  fs.copyFileSync(src, dest);
  copied += 1;
  const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(`[harmony-hars] ${name} (${sizeMB} MB)`);
}

console.log(`[harmony-hars] 完成，${copied}/${HARS.length} 个 HAR 已就绪 -> harmony/libs/`);
