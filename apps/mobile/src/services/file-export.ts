/**
 * 跨平台文件导出（P0-3 全平台导出修复）
 *
 * 去 Expo 后的统一导出通道：
 * - Android：自建原生 FileExport 模块（FileProvider + ACTION_SEND 系统分享面板）；
 *   Android 分享面板无取消回调，调起即视为 shared，取消天然不报错。
 * - HarmonyOS：自建 FileExport TurboModule（DocumentViewPicker 系统「另存为」），
 *   用户选择目录落盘；返回 saved(uri) / cancelled。无需任何权限申请。
 * - 其他平台（iOS/Web 未接入）：抛出「暂不支持」。
 *
 * 接口按通用文件导出设计（文件名 + 内容 + MIME），CSV 是第一种，
 * P0-5 的 HTML 月报直接复用本通道。
 */

export type FileExportStatus = 'shared' | 'saved' | 'cancelled';

export interface FileExportResult {
  status: FileExportStatus;
  /** saved 时为用户选择的文件 URI（鸿蒙）；其余平台为空 */
  uri?: string;
}

interface HarmonyFileExportModule {
  /** 返回保存后的文件 URI；空串表示用户取消 */
  saveFileWithPicker(fileName: string, content: string): Promise<string>;
}

interface AndroidFileExportModule {
  /** 写缓存文件并调起系统分享；调起即成功（无法感知取消） */
  exportFile(fileName: string, content: string, mimeType: string): Promise<string>;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadRN = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('react-native') as {
    Platform: { OS: string };
    TurboModuleRegistry: { getEnforcing: (name: string) => unknown };
    NativeModules: Record<string, unknown>;
  };

export async function exportFile(
  fileName: string,
  content: string,
  mimeType: string,
): Promise<FileExportResult> {
  const rn = loadRN();
  if (rn.Platform.OS === 'harmony') {
    const mod = rn.TurboModuleRegistry.getEnforcing(
      'FileExport',
    ) as HarmonyFileExportModule;
    const uri = await mod.saveFileWithPicker(fileName, content);
    if (uri === '') return { status: 'cancelled' };
    return { status: 'saved', uri };
  }

  if (rn.Platform.OS === 'android') {
    const mod = rn.NativeModules['FileExport'] as AndroidFileExportModule | undefined;
    if (!mod) throw new Error('导出模块未注册');
    await mod.exportFile(fileName, content, mimeType);
    return { status: 'shared' };
  }

  throw new Error('当前平台暂不支持导出');
}
