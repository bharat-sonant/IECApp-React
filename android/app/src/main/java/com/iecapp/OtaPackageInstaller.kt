package com.iecapp

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

class OtaPackageInstaller(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "OtaPackageInstaller"

    @ReactMethod
    fun install(zipPath: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val zipFile = File(zipPath)

            if (!zipFile.exists()) {
                promise.reject("FILE_NOT_FOUND", "OTA package file not found at: $zipPath")
                return
            }

            val documentsDir = context.filesDir

            val zipIn = ZipInputStream(FileInputStream(zipFile))
            var entry: ZipEntry? = zipIn.nextEntry

            while (entry != null) {
                val entryFile = File(documentsDir, entry.name)
                if (entry.isDirectory) {
                    entryFile.mkdirs()
                } else {
                    entryFile.parentFile?.mkdirs()
                    val fos = FileOutputStream(entryFile)
                    val buffer = ByteArray(8192)
                    var len: Int = zipIn.read(buffer)

                    while (len > 0) {
                        fos.write(buffer, 0, len)
                        len = zipIn.read(buffer)
                    }
                    fos.close()
                }
                zipIn.closeEntry()
                entry = zipIn.nextEntry
            }
            zipIn.close()

            zipFile.delete()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("INSTALL_FAILED", "Failed to install OTA package: ${e.message}", e)
        }
    }
}