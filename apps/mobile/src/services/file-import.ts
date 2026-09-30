/**
 * 跨平台文件导入（P0-2 本地加密备份与恢复）
 *
 * 与 file-export.ts 对称的「选文件 + 读内容」通道：
 * - Android：自建原生 FileImport 模块（SAF ACTION_OPEN_DOCUMENT +
 *   ContentResolver 读取）；用户取消 resolve null。
 * - HarmonyOS：自建 FileImport TurboModule（DocumentViewPicker 选择模式），
 *   无需任何权限；用户取消返回空串。
 * - 其他平台（iOS/Web 未接入）：抛出「暂不支持」。
 *
 * 接口按通用文本文件读取设计（文件名 + 全文内容），备份包是第一种，
 * 后续 CSV 导入（P2-3）可直接复用。
 */

export interface PickedTextFile {
  /** 用户选择的文件名（展示用；取不到时为空串） */
  name: string;
  /** 文件全文（UTF-8 字符串） */
  content: string;
}

interface HarmonyFileImportModule {
  /** 返回 JSON 串 {name, content}；空串表示用户取消 */
  pickFileWithPicker(): Promise<string>;
}

interface AndroidFileImportModule {
  /** 调起系统文件选择器并读回全文；取消 resolve null */
  pickTextFile(): Promise<{ name: string; content: string } | null>;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadRN = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('react-native') as {
    Platform: { OS: string };
    TurboModuleRegistry: { getEnforcing: (name: string) => unknown };
    NativeModules: Record<string, unknown>;
  };

/** 调起系统文件选择器，读取所选文本文件；用户取消返回 null */
export async function pickTextFile(): Promise<PickedTextFile | null> {
  const rn = loadRN();
  if (rn.Platform.OS === 'harmony') {
    const mod = rn.TurboModuleRegistry.getEnforcing(
      'FileImport',
    ) as HarmonyFileImportModule;
    const raw = await mod.pickFileWithPicker();
    if (raw === '') return null;
    return JSON.parse(raw) as PickedTextFile;
  }

  if (rn.Platform.OS === 'android') {
    const mod = rn.NativeModules['FileImport'] as AndroidFileImportModule | undefined;
    if (!mod) throw new Error('文件选择模块未注册');
    return mod.pickTextFile();
  }

  throw new Error('当前平台暂不支持选择文件');
}
