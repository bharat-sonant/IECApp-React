package com.iecapp

import android.app.Application
import java.io.File
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.iecapp.LocationPackage  // <-- add this import
import com.iecapp.MediaDownloadPackage
import com.iecapp.OtaPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    val jsBundleFilePath = resolveJsBundleFilePath()

    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(LocationPackage())  // <-- register manually
          add(MediaDownloadPackage())
          add(OtaPackage())
        },
      jsBundleFilePath = jsBundleFilePath,
    )
  }

  private fun resolveJsBundleFilePath(): String? {
    val directBundle = File(filesDir, "index.android.bundle")
    if (directBundle.exists()) return directBundle.absolutePath

    val otaBundle = File(filesDir, "ota/index.android.bundle")
    if (otaBundle.exists()) return otaBundle.absolutePath

    return null
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
