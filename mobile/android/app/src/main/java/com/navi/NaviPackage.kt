package com.navi

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class NaviPackage : ReactPackage {
  private val ocrController = NaviOcrController()
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(NaviNativeModule(context, ocrController))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(NaviCameraViewManager(context, ocrController), NaviMapViewManager(context))
}
