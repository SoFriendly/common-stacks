package com.sofriendly.commonstacks

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.Theme_common_stacks_Base)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  @Suppress("unused")
  fun openDownloadedFile(path: String, mimeType: String): String? {
    return try {
      val file = File(path)
      if (!file.exists()) {
        return "File not found: ${file.name}"
      }

      val uri = FileProvider.getUriForFile(
        this,
        "${applicationContext.packageName}.fileprovider",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        clipData = ClipData.newUri(contentResolver, file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(intent, "Open ${file.name}").apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      startActivity(chooser)
      null
    } catch (_: ActivityNotFoundException) {
      "No app is installed that can open this file."
    } catch (ex: Exception) {
      ex.message ?: "Unable to open this file."
    }
  }
}
