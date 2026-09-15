package com.iecapp

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

class OtaPackageInstaller(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "OtaPackageInstaller"

  /**
   * Tells the native guard that this JS bundle booted fine, so it will not be
   * rolled back on the next launch.
   */
  @ReactMethod
  fun markBootSuccessful(promise: Promise) {
    try {
      OtaBundleGuard.markBootSuccessful(reactApplicationContext.filesDir)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.resolve(false)
    }
  }

  /**
   * Reports whether the previous downloaded bundle had to be discarded, so JS
   * can log it and allow the update to be offered again.
   */
  @ReactMethod
  fun consumeBootStatus(promise: Promise) {
    try {
      val reason = OtaBundleGuard.consumeRollbackReason(reactApplicationContext.filesDir)
      val result = Arguments.createMap()
      result.putBoolean("rolledBack", reason != null)
      result.putString("reason", reason ?: "")
      promise.resolve(result)
    } catch (error: Exception) {
      val result = Arguments.createMap()
      result.putBoolean("rolledBack", false)
      result.putString("reason", "")
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun install(zipPath: String, promise: Promise) {
    try {
      val zipFile = File(zipPath)
      if (!zipFile.exists()) {
        promise.reject("OTA_ZIP_MISSING", "OTA package not found: $zipPath")
        return
      }

      val filesDir = reactApplicationContext.filesDir
      val tempDir = File(filesDir, "ota_tmp")
      val otaDir = File(filesDir, "ota")
      val expectedBundle = File(tempDir, "index.android.bundle")
      val legacyBundle = File(filesDir, "index.android.bundle")

      deleteRecursively(tempDir)
      tempDir.mkdirs()

      unzipToDirectory(zipFile, tempDir)

      if (!expectedBundle.exists()) {
        deleteRecursively(tempDir)
        promise.reject("OTA_BUNDLE_MISSING", "index.android.bundle missing in OTA package")
        return
      }

      deleteRecursively(otaDir)
      if (!tempDir.renameTo(otaDir)) {
        copyDirectory(tempDir, otaDir)
        deleteRecursively(tempDir)
      }

      if (legacyBundle.exists()) {
        legacyBundle.delete()
      }

      zipFile.delete()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OTA_INSTALL_ERROR", error)
    }
  }

  private fun unzipToDirectory(zipFile: File, outputDir: File) {
    ZipInputStream(FileInputStream(zipFile)).use { zipInputStream ->
      var entry = zipInputStream.nextEntry
      while (entry != null) {
        val destination = File(outputDir, entry.name)
        val canonicalOutput = outputDir.canonicalPath + File.separator
        val canonicalDestination = destination.canonicalPath
        if (!canonicalDestination.startsWith(canonicalOutput)) {
          throw IllegalStateException("Blocked invalid zip entry: ${entry.name}")
        }

        if (entry.isDirectory) {
          destination.mkdirs()
        } else {
          destination.parentFile?.mkdirs()
          FileOutputStream(destination).use { fileOutput ->
            zipInputStream.copyTo(fileOutput)
          }
        }
        zipInputStream.closeEntry()
        entry = zipInputStream.nextEntry
      }
    }
  }

  private fun copyDirectory(source: File, destination: File) {
    if (source.isDirectory) {
      if (!destination.exists()) {
        destination.mkdirs()
      }
      source.listFiles()?.forEach { child ->
        copyDirectory(child, File(destination, child.name))
      }
      return
    }

    destination.parentFile?.mkdirs()
    FileInputStream(source).use { input ->
      FileOutputStream(destination).use { output ->
        input.copyTo(output)
      }
    }
  }

  private fun deleteRecursively(target: File) {
    if (!target.exists()) return
    if (target.isDirectory) {
      target.listFiles()?.forEach { child ->
        deleteRecursively(child)
      }
    }
    target.delete()
  }
}
