/**
 * 文件导出 TurboModule（ArkTS 侧，CoreFileKit DocumentViewPicker 实现）
 *
 * P0-3 全平台导出修复：替代去 Expo 后不可用的 expo-file-system/expo-sharing。
 *
 * 方案选型：系统「另存为」选择器
 * - DocumentViewPicker 保存模式：用户选择目录（如下载/文档）落盘，
 *   文件位置用户可见，体验对齐「导出」直觉
 * - 无需任何权限申请（picker 交互即授权，user_grant 都不需要）
 * - 用户取消时 picker 返回空数组 → JS 侧收到空串，静默处理（验收 3）
 *
 * 模块名 FileExport：JS 侧 TurboModuleRegistry、本文件、
 * C++ FileExportPackage.h 三处必须一致。
 */

import { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG = 'FileExport';

export class FileExportTurboModule extends TurboModule {
  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  /**
   * 调起系统「另存为」并把内容写入用户选择的位置
   *
   * @param fileName 建议文件名（如 家庭资产报表-2026-09-30.csv）
   * @param content 文件全文（UTF-8 字符串）
   * @returns 保存后的文件 URI；空串表示用户取消
   */
  async saveFileWithPicker(fileName: string, content: string): Promise<string> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const saveOptions = new picker.DocumentSaveOptions();
      saveOptions.newFileNames = [fileName];

      const documentViewPicker = new picker.DocumentViewPicker(context);
      const uris = await documentViewPicker.save(saveOptions);
      if (!uris || uris.length === 0) {
        console.info(`${TAG}: save cancelled by user`);
        return '';
      }

      const uri = uris[0];
      const file = fs.openSync(
        uri,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC,
      );
      fs.writeSync(file.fd, content);
      fs.closeSync(file);
      console.info(`${TAG}: saved to ${uri}`);
      return uri;
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: saveFileWithPicker failed, code=${error.code}, msg=${error.message}`);
      throw new Error(`保存文件失败（${error.code}）`);
    }
  }
}
