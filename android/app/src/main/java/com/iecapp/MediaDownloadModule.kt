package com.iecapp

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.app.DownloadManager
import android.location.Geocoder
import android.provider.MediaStore
import android.media.MediaScannerConnection
import java.text.SimpleDateFormat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

class MediaDownloadModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "MediaDownload"

  @ReactMethod
  fun downloadMediaToDownloads(
    mediaUrl: String,
    fileName: String,
    mimeType: String?,
    promise: Promise
  ) {
    try {
      val request = DownloadManager.Request(Uri.parse(mediaUrl)).apply {
        setTitle("Downloading")
        setDescription("Saving file to Downloads...")
        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        setDestinationInExternalPublicDir(
          Environment.DIRECTORY_DOWNLOADS,
          sanitizeFileName(fileName)
        )
        mimeType?.takeIf { it.isNotBlank() }?.let { setMimeType(it) }
        setAllowedOverMetered(true)
        setAllowedOverRoaming(true)
      }

      val manager = reactContext.getSystemService(android.content.Context.DOWNLOAD_SERVICE) as? DownloadManager
        ?: throw IllegalStateException("Download manager unavailable")

      val downloadId = manager.enqueue(request)
      promise.resolve(downloadId.toDouble())
    } catch (e: Exception) {
      promise.reject("MEDIA_DOWNLOAD_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun downloadImageWithLatLng(
    imageUrl: String,
    latitude: String,
    longitude: String,
    fileName: String,
    address: String?,
    dateText: String?,
    promise: Promise
  ) {
    Thread {
      try {
        val sourceBitmap = downloadBitmap(imageUrl)
        val resolvedAddress = resolveAddressFromLatLng(
          latitude,
          longitude,
          address.orEmpty()
        )
        val markedBitmap = addLatLngToBitmap(
          sourceBitmap,
          latitude,
          longitude,
          resolvedAddress,
          dateText.orEmpty()
        )
        val savedPath = saveBitmapToDownloads(markedBitmap, fileName)
        promise.resolve(savedPath)
      } catch (e: Exception) {
        promise.reject("MEDIA_DOWNLOAD_FAILED", e.message, e)
      }
    }.start()
  }

  private fun downloadBitmap(imageUrl: String): Bitmap {
    val connection = URL(imageUrl).openConnection() as HttpURLConnection
    connection.connectTimeout = 15000
    connection.readTimeout = 15000
    connection.instanceFollowRedirects = true
    connection.connect()

    if (connection.responseCode !in 200..299) {
      throw IllegalStateException("Download failed with status ${connection.responseCode}")
    }

    connection.inputStream.use { input ->
      return BitmapFactory.decodeStream(input)
        ?: throw IllegalStateException("Unable to decode image")
    }
  }

  private fun addLatLngToBitmap(
    original: Bitmap,
    latitude: String,
    longitude: String,
    address: String,
    dateText: String
  ): Bitmap {
    val sourceBitmap = scaleBitmapToMaxDimension(original, 1000)
    val mutableBitmap = sourceBitmap.copy(Bitmap.Config.ARGB_8888, true)
    val canvas = Canvas(mutableBitmap)

    val paddingH = 22f
    val paddingTop = 18f
    val paddingBottom = 16f
    val footerWidth = (mutableBitmap.width - (paddingH * 2)).coerceAtLeast(1f)

    val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = 15f
      typeface = android.graphics.Typeface.DEFAULT_BOLD
    }
    val bodyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = 15f
    }

    val locationText = buildString {
      append("Lat: ")
      append(latitude)
      append("  Long: ")
      append(longitude)
    }
    val formattedDateTime = formatDateTime(dateText)
    val addressText = address.ifBlank { "Unknown location" }

    val addressLayout = buildTextLayout(addressText, bodyPaint, footerWidth.toInt())
    val locationLayout = buildTextLayout(locationText, titlePaint, footerWidth.toInt())
    val timeLayout = buildTextLayout(formattedDateTime, titlePaint, footerWidth.toInt())

    val footerHeight =
      paddingTop +
        addressLayout.height +
        14f +
        locationLayout.height +
        12f +
        timeLayout.height +
        paddingBottom

    val top = maxOf(0f, mutableBitmap.height - footerHeight)
    val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(185, 0, 0, 0)
    }

    canvas.drawRect(
      0f,
      top,
      mutableBitmap.width.toFloat(),
      mutableBitmap.height.toFloat(),
      backgroundPaint
    )

    val left = paddingH
    var currentTop = top + paddingTop

    canvas.save()
    canvas.translate(left, currentTop)
    addressLayout.draw(canvas)
    canvas.restore()

    currentTop += addressLayout.height + 14f
    canvas.save()
    canvas.translate(left, currentTop)
    locationLayout.draw(canvas)
    canvas.restore()

    currentTop += locationLayout.height + 12f
    canvas.save()
    canvas.translate(left, currentTop)
    timeLayout.draw(canvas)
    canvas.restore()

    return mutableBitmap
  }

  private fun scaleBitmapToMaxDimension(bitmap: Bitmap, maxDimension: Int): Bitmap {
    val width = bitmap.width
    val height = bitmap.height
    val largestSide = maxOf(width, height)

    if (largestSide <= maxDimension) {
      return bitmap
    }

    val scale = maxDimension.toFloat() / largestSide.toFloat()
    val scaledWidth = (width * scale).toInt().coerceAtLeast(1)
    val scaledHeight = (height * scale).toInt().coerceAtLeast(1)

    return Bitmap.createScaledBitmap(bitmap, scaledWidth, scaledHeight, true)
  }

  private fun resolveAddressFromLatLng(
    latitude: String,
    longitude: String,
    fallbackAddress: String
  ): String {
    val fallback = fallbackAddress.trim()
    val lat = latitude.toDoubleOrNull()
    val lng = longitude.toDoubleOrNull()

    if (lat == null || lng == null || !Geocoder.isPresent()) {
      return fallback
    }

    return try {
      val geocoder = Geocoder(reactContext, Locale.getDefault())
      val results = geocoder.getFromLocation(lat, lng, 1)
      val first = results?.firstOrNull()
      val geocoded = buildString {
        appendNotBlank(first?.featureName)
        appendNotBlank(first?.thoroughfare)
        appendNotBlank(first?.subLocality)
        appendNotBlank(first?.locality)
        appendNotBlank(first?.subAdminArea)
        appendNotBlank(first?.adminArea)
        appendNotBlank(first?.postalCode)
        appendNotBlank(first?.countryName)
      }.trim().trim(',')

      if (geocoded.isNotBlank()) geocoded else fallback
    } catch (_: IOException) {
      fallback
    } catch (_: Exception) {
      fallback
    }
  }

  private fun buildTextLayout(text: String, paint: TextPaint, width: Int): StaticLayout {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setIncludePad(false)
        .setLineSpacing(0f, 1.0f)
        .setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY)
        .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NORMAL)
        .build()
    } else {
      @Suppress("DEPRECATION")
      StaticLayout(
        text,
        paint,
        width,
        Layout.Alignment.ALIGN_NORMAL,
        1.0f,
        0.0f,
        false
      )
    }
  }

  private fun formatDateTime(dateText: String): String {
    val input = dateText.trim()
    if (input.isBlank()) {
      return ""
    }

    val patterns = listOf(
      "yyyy-MM-dd HH:mm:ss",
      "yyyy-MM-dd HH:mm",
      "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
      "yyyy-MM-dd'T'HH:mm:ss'Z'",
      "yyyy-MM-dd"
    )

    for (pattern in patterns) {
      try {
        val parser = SimpleDateFormat(pattern, Locale.getDefault())
        parser.isLenient = true
        val parsed = parser.parse(input) ?: continue
        val formatter = SimpleDateFormat("dd MMM yyyy hh:mm a", Locale.US)
        return formatter.format(parsed)
      } catch (_: Exception) {
        // try the next format
      }
    }

    return input
  }

  private fun saveBitmapToDownloads(bitmap: Bitmap, fileName: String): String {
    val safeName = sanitizeFileName(fileName).ifBlank {
      "image_${System.currentTimeMillis()}.jpg"
    }
    val finalName = if (safeName.lowercase(Locale.US).endsWith(".jpg")) {
      safeName
    } else {
      "$safeName.jpg"
    }

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      saveToMediaStore(bitmap, finalName)
    } else {
      saveToLegacyDownloads(bitmap, finalName)
    }
  }

  private fun saveToMediaStore(bitmap: Bitmap, fileName: String): String {
    val resolver = reactContext.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
      put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
      put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
    }

    val uri: Uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Unable to create download entry")

    resolver.openOutputStream(uri)?.use { output ->
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 100, output)) {
        throw IllegalStateException("Unable to write image")
      }
    } ?: throw IllegalStateException("Unable to open output stream")

    return uri.toString()
  }

  private fun saveToLegacyDownloads(bitmap: Bitmap, fileName: String): String {
    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (!downloadsDir.exists()) {
      downloadsDir.mkdirs()
    }

    val outFile = File(downloadsDir, fileName)
    FileOutputStream(outFile).use { output ->
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 100, output)) {
        throw IllegalStateException("Unable to write image")
      }
    }

    MediaScannerConnection.scanFile(
      reactContext,
      arrayOf(outFile.absolutePath),
      arrayOf("image/jpeg"),
      null
    )

    return outFile.absolutePath
  }

  private fun sanitizeFileName(fileName: String): String {
    return fileName
      .replace(Regex("""[\\/:*?"<>|]+"""), "_")
      .replace(Regex("""\s+"""), " ")
      .trim()
  }

  private fun StringBuilder.appendNotBlank(value: String?) {
    val text = value?.trim().orEmpty()
    if (text.isNotBlank()) {
      if (isNotEmpty()) {
        append(", ")
      }
      append(text)
    }
  }
}
