package com.familywealth.app

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * P0-3 全平台导出修复：Android 端文件导出（替代去 Expo 后失效的
 * expo-file-system / expo-sharing）。
 *
 * 流程：写内容到 cacheDir/exports（先清空，避免重复文件）→
 * FileProvider 转 content:// → ACTION_SEND 系统分享面板。
 * Android 分享面板无取消回调，调起即 resolve("shared")，取消天然不报错。
 */
class FileExportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "FileExport"

  @ReactMethod
  fun exportFile(fileName: String, content: String, mimeType: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      val dir = File(context.cacheDir, "exports")
      if (dir.exists()) {
        dir.listFiles()?.forEach { it.delete() }
      } else {
        dir.mkdirs()
      }

      val file = File(dir, fileName)
      file.writeText(content, Charsets.UTF_8)

      val uri = FileProvider.getUriForFile(
          context,
          "${context.packageName}.fileprovider",
          file,
      )

      val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, fileName)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(sendIntent, "导出家庭资产报表").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(chooser)
      promise.resolve("shared")
    } catch (e: Exception) {
      promise.reject("EXPORT_FAILED", e.message, e)
    }
  }
}
