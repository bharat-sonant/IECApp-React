package com.iecapp

import java.io.File
import java.io.FileInputStream

/**
 * Protects the app from a corrupt or incompatible downloaded JS bundle.
 *
 * Before an OTA bundle is handed to React Native we (1) sanity check the file
 * and (2) drop a "boot pending" marker. JS deletes that marker a couple of
 * seconds after it starts. If the marker is still there on the next launch the
 * downloaded bundle never managed to boot, so it is discarded and the app falls
 * back to the bundle shipped inside the APK instead of showing a white screen
 * forever.
 */
object OtaBundleGuard {

    private const val LEGACY_BUNDLE_NAME = "index.android.bundle"
    private const val OTA_DIR_NAME = "ota"
    private const val BOOT_PENDING_FILE = "ota_boot_pending"
    private const val ROLLBACK_FILE = "ota_rollback"

    /** A real RN bundle is never this small; anything smaller is a truncated download. */
    private const val MIN_BUNDLE_BYTES = 100_000L

    private val HERMES_MAGIC = byteArrayOf(
        0xC6.toByte(), 0x1F, 0xBC.toByte(), 0x03,
        0xC1.toByte(), 0x03, 0x19, 0x1F,
    )

    fun resolveBundlePath(filesDir: File): String? {
        val candidate = findDownloadedBundle(filesDir) ?: return null
        val pendingMarker = File(filesDir, BOOT_PENDING_FILE)

        if (pendingMarker.exists()) {
            discardDownloadedBundles(
                filesDir,
                "Previous launch loaded the downloaded bundle but never reached JS",
            )
            return null
        }

        if (!looksLikeValidBundle(candidate)) {
            discardDownloadedBundles(
                filesDir,
                "Downloaded bundle failed integrity check (size=${candidate.length()} bytes)",
            )
            return null
        }

        return try {
            pendingMarker.writeText(candidate.absolutePath)
            candidate.absolutePath
        } catch (error: Exception) {
            // If the guard cannot be armed, never risk an unrecoverable boot.
            null
        }
    }

    /** Called from JS once the app has started successfully. */
    fun markBootSuccessful(filesDir: File) {
        try {
            File(filesDir, BOOT_PENDING_FILE).delete()
        } catch (error: Exception) {
        }
    }

    /** Returns (and clears) the reason the last downloaded bundle was rolled back. */
    fun consumeRollbackReason(filesDir: File): String? {
        return try {
            val rollback = File(filesDir, ROLLBACK_FILE)
            if (!rollback.exists()) return null
            val reason = rollback.readText()
            rollback.delete()
            reason
        } catch (error: Exception) {
            null
        }
    }

    private fun findDownloadedBundle(filesDir: File): File? {
        val legacyBundle = File(filesDir, LEGACY_BUNDLE_NAME)
        if (legacyBundle.exists()) return legacyBundle

        val otaBundle = File(filesDir, "$OTA_DIR_NAME/$LEGACY_BUNDLE_NAME")
        if (otaBundle.exists()) return otaBundle

        return null
    }

    private fun looksLikeValidBundle(bundle: File): Boolean {
        if (!bundle.isFile || bundle.length() < MIN_BUNDLE_BYTES) {
            return false
        }

        return try {
            FileInputStream(bundle).use { input ->
                val header = ByteArray(HERMES_MAGIC.size)
                if (input.read(header) != header.size) {
                    return false
                }
                // Hermes bytecode starts with a fixed magic number. A plain JS
                // bundle has no magic, so fall back to "is it readable text".
                header.contentEquals(HERMES_MAGIC) || header.none { it == 0.toByte() }
            }
        } catch (error: Exception) {
            false
        }
    }

    private fun discardDownloadedBundles(filesDir: File, reason: String) {
        try {
            File(filesDir, LEGACY_BUNDLE_NAME).delete()
            deleteRecursively(File(filesDir, OTA_DIR_NAME))
            File(filesDir, BOOT_PENDING_FILE).delete()
            File(filesDir, ROLLBACK_FILE).writeText(reason)
        } catch (error: Exception) {
        }
    }

    private fun deleteRecursively(target: File) {
        if (!target.exists()) return
        if (target.isDirectory) {
            target.listFiles()?.forEach { deleteRecursively(it) }
        }
        target.delete()
    }
}
