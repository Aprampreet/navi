package com.navi

import android.graphics.Color
import android.util.Log
import android.view.View.MeasureSpec
import android.webkit.WebView
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import android.webkit.WebViewClient
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NaviMapWebView(context: ThemedReactContext) : WebView(context) {
  var mapData = "{}"
  var ready = false

  fun renderData() {
    if (ready) evaluateJavascript("window.naviUpdate($mapData);", null)
  }

  fun refreshLayout() {
    if (width <= 0 || height <= 0) return
    val widthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
    val heightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    measure(widthSpec, heightSpec)
    forceLayout()
    layout(left, top, right, bottom)
    for (index in 0 until childCount) {
      val child = getChildAt(index)
      child.measure(widthSpec, heightSpec)
      child.layout(0, 0, width, height)
    }
    val cssHeight = height / resources.displayMetrics.density
    evaluateJavascript("window.naviRefresh && window.naviRefresh($cssHeight);", null)
    evaluateJavascript("typeof L + ':' + document.getElementById('map').offsetWidth + 'x' + document.getElementById('map').offsetHeight + ':' + map.getSize().x + 'x' + map.getSize().y") {
      Log.i("NAVI", "Map page size: $it")
    }
    Log.i("NAVI", "Map WebView laid out: ${width}x${height} children=$childCount")
  }
}

class NaviMapViewManager(@Suppress("UNUSED_PARAMETER") context: ReactApplicationContext) :
  SimpleViewManager<NaviMapWebView>() {
  override fun getName() = "NaviMapView"

  override fun createViewInstance(reactContext: ThemedReactContext): NaviMapWebView =
    NaviMapWebView(reactContext).apply {
      setBackgroundColor(Color.rgb(21, 42, 51))
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.userAgentString += " NAVI-Prototype/0.1"
      webChromeClient = object : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
          Log.i("NAVI", "Map JS: ${message.message()}")
          return true
        }
      }
      webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
          ready = true
          renderData()
          post { refreshLayout() }
          postDelayed({ refreshLayout() }, 500)
          Log.i("NAVI", "Map page loaded: $url")
        }
      }
      loadUrl("file:///android_asset/navi_map.html")
    }

  @ReactProp(name = "mapData")
  fun setMapData(view: NaviMapWebView, data: String?) {
    view.mapData = data ?: "{}"
    view.renderData()
  }

  override fun onDropViewInstance(view: NaviMapWebView) {
    view.destroy()
    super.onDropViewInstance(view)
  }
}
