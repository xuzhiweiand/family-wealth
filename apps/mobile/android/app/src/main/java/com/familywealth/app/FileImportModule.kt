package com.familywealth.app

import android.app.Activity
import android.content.Intent
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * P0-2 本地加密备份与恢复：Android 端文件导入（与 FileExport 对称）。
 *
 * 流程：ACTION_OPEN_DOCUMENT 系统文件选择器 → ContentResolver 读全文 →
 * resolve {name, content}；用户取消 resolve(null)。SAF 无需任何权限。
 * 结果经 ActivityEventListener 回调（RN 标准机制，与 image-picker 相同）。
 */
class FileImportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  companion object {
    const val REQ_PICK_FILE = 7301
  }

  private var pendingPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "FileImport"

  @ReactMethod
  fun pickTextFile(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前页面不可用")
      return
    }
    if (pendingPromise != null) {
      promise.reject("BUSY", "已有文件选择操作进行中")
      return
    }
    pendingPromise = promise
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
      }
      activity.startActivityForResult(intent, REQ_PICK_FILE)
    } catch (e: Exception) {
      pendingPromise = null
      promise.reject("PICK_FAILED", e.message, e)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQ_PICK_FILE) return
    val promise = pendingPromise ?: return
    pendingPromise = null
    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      promise.resolve(null) // 用户取消
      return
    }
    try {
      val uri = data.data!!
      val resolver = reactApplicationContext.contentResolver
      val name = resolver.query(uri, null, null, null, null)?.use { c ->
        val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (idx >= 0 && c.moveToFirst()) c.getString(idx) else ""
      } ?: ""
      val content = resolver.openInputStream(uri)
          ?.bufferedReader(Charsets.UTF_8)
          ?.use { it.readText() }
          ?: throw java.io.IOException("无法读取文件内容")
      val result = Arguments.createMap()
      result.putString("name", name)
      result.putString("content", content)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("READ_FAILED", e.message, e)
    }
  }

  override fun onNewIntent(intent: Intent) {}
}
