/**
 * 修复 RNOH 0.77 在 Windows 上的头文件遮蔽问题。
 *
 * 背景：框架 cpp/RNOH/Assert.h 被加入 include 路径，而 NTFS 不区分大小写，
 * Clang 处理 #include <assert.h>（libcxx cassert 间接引入）时会把
 * RNOH/Assert.h 误当作系统 assert.h 加载；该文件只定义 RNOH_ASSERT，
 * 不定义标准 assert 宏，导致 double-conversion 等代码编译报
 * "use of undeclared identifier 'assert'"。
 * macOS/Linux 文件系统区分大小写，故仅 Windows 上触发。
 *
 * 修复：将 Assert.h 重命名为 RNOHAssert.h，并改写全部引用：
 *   #include "RNOH/Assert.h"  -> #include "RNOH/RNOHAssert.h"
 *   #include "Assert.h"       -> #include "RNOH/RNOHAssert.h"
 *
 * 幂等：重复执行不会重复改写。
 * 用法：node scripts/patch-rnoh-assert.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const harmonyRoot = path.join(__dirname, '..', 'harmony');
const rnohRoot = path.join(
  harmonyRoot,
  'entry',
  'oh_modules',
  '@rnoh',
  'react-native-openharmony'
);
const cppRoot = path.join(rnohRoot, 'src', 'main', 'cpp');

if (!fs.existsSync(cppRoot)) {
  // HAR 在 hvigor sync（ohpm install）后才解压；postinstall 等更早阶段安全跳过
  console.log(
    '[rnoh-assert] RNOH 尚未解压到 entry/oh_modules，跳过（请在 hvigor sync 后重跑）'
  );
  process.exit(0);
}

// 1. 重命名 Assert.h -> RNOHAssert.h
const oldHeader = path.join(cppRoot, 'RNOH', 'Assert.h');
const newHeader = path.join(cppRoot, 'RNOH', 'RNOHAssert.h');

if (fs.existsSync(oldHeader)) {
  fs.copyFileSync(oldHeader, newHeader);
  fs.rmSync(oldHeader);
  console.log('[rnoh-assert] RNOH/Assert.h -> RNOH/RNOHAssert.h');
} else if (fs.existsSync(newHeader)) {
  console.log('[rnoh-assert] RNOHAssert.h 已存在，跳过重命名');
} else {
  console.error('[rnoh-assert] 未找到 RNOH/Assert.h，包结构异常');
  process.exit(1);
}

// 2. 递归改写引用
const SOURCE_EXT = new Set(['.h', '.hpp', '.hh', '.c', '.cc', '.cpp']);
const REPLACEMENTS = [
  ['#include "RNOH/Assert.h"', '#include "RNOH/RNOHAssert.h"'],
  ['#include "Assert.h"', '#include "RNOH/RNOHAssert.h"'],
];

let patchedFiles = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      const original = fs.readFileSync(full, 'utf8');
      let updated = original;
      for (const [from, to] of REPLACEMENTS) {
        updated = updated.split(from).join(to);
      }
      if (updated !== original) {
        fs.writeFileSync(full, updated);
        patchedFiles += 1;
      }
    }
  }
}
walk(cppRoot);

console.log(`[rnoh-assert] 完成，${patchedFiles} 个源文件引用已更新`);
