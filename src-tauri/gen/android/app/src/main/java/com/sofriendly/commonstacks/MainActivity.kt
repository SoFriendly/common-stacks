package com.sofriendly.commonstacks

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  // Android drops incoming multicast packets unless the app holds a
  // MulticastLock — without it the Rust-side mDNS resolver never hears the
  // Crosspoint's reply and `crosspoint.local` fails to resolve.
  private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.Theme_common_stacks_Base)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val wifi =
      applicationContext.getSystemService(WIFI_SERVICE) as android.net.wifi.WifiManager
    multicastLock = wifi.createMulticastLock("cs-mdns").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onDestroy() {
    multicastLock?.release()
    multicastLock = null
    super.onDestroy()
  }

  // Libby bridge. The /libby route embeds libbyapp.com in an iframe; the
  // injected script inside it (see src-tauri/src/libby_inject.js) reports
  // book context through a WebMessageListener scoped to libbyapp.com, and
  // downloads started in the iframe surface through the DownloadListener.
  // Both are forwarded into the React app (main frame) as JSON strings via
  // window.__csLibbyBridge, which relays them to Rust commands.
  override fun onWebViewCreate(webView: WebView) {
    // Libby's session cookies are third-party from the app's origin.
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(
        webView,
        "csLibbyBridge",
        setOf("https://libbyapp.com")
      ) { view, message, _, _, _ ->
        val data = message.data ?: return@addWebMessageListener
        forwardToMainFrame(view, data)
      }
    }

    webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
      val payload = JSONObject()
        .put("kind", "download")
        .put(
          "data",
          JSONObject()
            .put("url", url)
            .put("cookie", CookieManager.getInstance().getCookie(url) ?: "")
            .put("user_agent", userAgent ?: "")
            .put("mime", mimetype ?: "")
            .put("disposition", contentDisposition ?: "")
        )
      forwardToMainFrame(webView, payload.toString())
    }
  }

  private fun forwardToMainFrame(webView: WebView, json: String) {
    val quoted = JSONObject.quote(json)
    webView.post {
      webView.evaluateJavascript(
        "window.__csLibbyBridge && window.__csLibbyBridge($quoted)",
        null
      )
    }
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
