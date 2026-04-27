package com.iecapp

import android.app.Application
import android.content.Context
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
    val sharedPrefs = applicationContext.getSharedPreferences("ota_bundle_meta", Context.MODE_PRIVATE)
    val storedAppVersion = sharedPrefs.getString("installed_for_app_version", null)
    val currentAppVersion = try {
      packageManager.getPackageInfo(packageName, 0).versionName
    } catch (_: Exception) {
      null
    }

    val jsBundleFilePath =
      if (installedBundle.exists() && !storedAppVersion.isNullOrBlank() && storedAppVersion == currentAppVersion) {
        installedBundle.absolutePath
      } else {
        if (installedBundle.exists() && storedAppVersion != currentAppVersion) {
          installedBundle.delete()
        }
        sharedPrefs.edit().remove("installed_for_app_version").apply()
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
