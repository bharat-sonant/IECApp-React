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
    val installedBundle = File(applicationContext.filesDir, "index.android.bundle")
    val jsBundleFilePath = if (installedBundle.exists()) {
      installedBundle.absolutePath
    } else {
      null
    }

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

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
