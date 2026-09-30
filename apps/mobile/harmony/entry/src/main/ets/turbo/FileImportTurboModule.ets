/**
 * 文件导入 TurboModule（ArkTS 侧，CoreFileKit DocumentViewPicker 实现）
 *
 * P0-2 本地加密备份与恢复：与 FileExport 对称的「选文件 + 读内容」通道。
 *
 * 方案：系统文件选择器（DocumentViewPicker 选择模式）
 * - 用户在系统 UI 中选择文件（如下载/文档目录），picker 交互即授权，
 *   无需任何权限申请
 * - 用户取消时 picker 返回空数组 → JS 侧收到空串，静默处理
 * - 读回 UTF-8 全文，JSON 串 {name, content} 返回（TurboModule 跨语言
 *   只传基础类型，JSON 是务实的复合返回方式）
 *
 * 模块名 FileImport：JS 侧 TurboModuleRegistry、本文件、
 * C++ FileImportPackage.h 三处必须一致。
 */

import { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG = 'FileImport';
/** 防御性上限：备份包正常在 KB~几 MB 级，超出一律拒绝，避免 OOM */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 从 picker 返回的 uri 推一个可读文件名（失败时给空串，展示侧兜底） */
function guessFileName(uri: string): string {
  try {
    const last = uri.split('/').pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

export class FileImportTurboModule extends TurboModule {
  constructor(ctx: TurboModuleContext) {
    super(ctx);
  }

  /**
   * 调起系统文件选择器并读回所选文本文件全文
   *
   * @returns JSON 串 {"name": "...", "content": "..."}；空串表示用户取消
   */
  async pickFileWithPicker(): Promise<string> {
    try {
      const context = this.ctx.uiAbilityContext as common.UIAbilityContext;
      const selectOptions = new picker.DocumentSelectOptions();
      selectOptions.maxSelectNumber = 1;

      const documentViewPicker = new picker.DocumentViewPicker(context);
      const uris = await documentViewPicker.select(selectOptions);
      if (!uris || uris.length === 0) {
        console.info(`${TAG}: pick cancelled by user`);
        return '';
      }

      const uri = uris[0];
      const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
      const stat = fs.statSync(file.fd);
      if (stat.size > MAX_FILE_BYTES) {
        fs.closeSync(file);
        throw new Error('文件过大，不是有效的备份包');
      }
      const buf = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buf);
      fs.closeSync(file);

      const decoder = util.TextDecoder.create('utf-8');
      const content = decoder.decodeToString(new Uint8Array(buf));
      console.info(`${TAG}: picked ${uri}, ${stat.size} bytes`);
      return JSON.stringify({ name: guessFileName(uri), content });
    } catch (err) {
      const error = err as BusinessError;
      console.error(`${TAG}: pickFileWithPicker failed, code=${error.code}, msg=${error.message}`);
      throw new Error(`读取文件失败（${error.code}）`);
    }
  }
}
