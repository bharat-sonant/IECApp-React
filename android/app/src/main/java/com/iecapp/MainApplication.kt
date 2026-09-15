package com.iecapp

import android.app.Application
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

  /**
   * Returns the downloaded OTA bundle only when it passes [OtaBundleGuard]'s
   * integrity and previous-boot checks; otherwise null, which makes React
   * Native fall back to the bundle shipped inside the APK.
   */
  private fun resolveJsBundleFilePath(): String? = OtaBundleGuard.resolveBundlePath(filesDir)

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
