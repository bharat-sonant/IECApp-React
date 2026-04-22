package com.iecapp

import android.content.Intent
import android.location.Geocoder
import android.os.Build
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

class LocationModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "LocationTracker"

    override fun initialize() {
        super.initialize()
        // Keep reactContext in sync whenever JS bridge reconnects (e.g. after MIUI process restart)
        reactContext.addLifecycleEventListener(object : LifecycleEventListener {
            override fun onHostResume() {
                LocationForegroundService.reactContext = reactContext
            }
            override fun onHostPause()  {}
            override fun onHostDestroy() {}
        })
    }

    /**
     * Save tracking config to SharedPreferences.
     * Call this BEFORE startTracking() so the service picks up the values on start.
     *   gpsIntervalMs       — GPS polling interval in ms       (default: 5000)
     *   accuracyThresholdM  — max accuracy for snapshot points (default: 50)
     *   minDistanceM       — minimum movement in meters      (default: 10)
     *   snapshotIntervalMs  — how often to flush snapshot      (default: 60000)
     */
    @ReactMethod
    fun setTrackingConfig(config: ReadableMap) {
        val prefs = reactContext.applicationContext
            .getSharedPreferences("d2d_tracking_config", 0).edit()
        if (config.hasKey("gpsIntervalMs"))
            prefs.putLong("gpsIntervalMs",      config.getDouble("gpsIntervalMs").toLong())
        if (config.hasKey("accuracyThresholdM"))
            prefs.putFloat("accuracyThresholdM", config.getDouble("accuracyThresholdM").toFloat())
        if (config.hasKey("minDistanceM"))
            prefs.putFloat("minDistanceM",      config.getDouble("minDistanceM").toFloat())
        if (config.hasKey("snapshotIntervalMs"))
            prefs.putLong("snapshotIntervalMs", config.getDouble("snapshotIntervalMs").toLong())
        prefs.apply()
    }

    /** Start foreground service — location tracking begins */
    @ReactMethod
    fun startTracking() {
        LocationForegroundService.reactContext = reactContext
        val intent = Intent(reactContext, LocationForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    /** Stop foreground service — location tracking ends */
    @ReactMethod
    fun stopTracking() {
        val intent = Intent(reactContext, LocationForegroundService::class.java)
        reactContext.stopService(intent)
        LocationForegroundService.reactContext = null
    }

    /**
     * Opens the system battery-optimization exemption flow for this app.
     * Returns true if the flow was launched, false if already ignored or unavailable.
     */
    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val context = reactContext.applicationContext
            val pm = context.getSystemService(android.os.PowerManager::class.java)
            val packageName = context.packageName

            if (pm?.isIgnoringBatteryOptimizations(packageName) == true) {
                promise.resolve(true)
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
                return
            }

            promise.resolve(false)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Reads location snapshots buffered in SharedPreferences while JS bridge was dead
     * (app was killed). Clears the buffer immediately after reading.
     * Returns array of { path, distanceInMeters, time, date }.
     */
    @ReactMethod
    fun getPendingSnapshots(promise: Promise) {
        try {
            val prefs = reactContext.applicationContext
                .getSharedPreferences("d2d_loc_buffer", 0)
            val json = prefs.getString("snapshots", "[]")!!

            val arr    = org.json.JSONArray(json)
            val result = Arguments.createArray()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val map = Arguments.createMap()
                map.putString("path",              obj.getString("path"))
                map.putDouble("distanceInMeters",  obj.getDouble("distanceInMeters"))
                map.putString("time",              obj.optString("time", ""))
                map.putString("date",              obj.optString("date", ""))
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.resolve(Arguments.createArray())
        }
    }

    /**
     * Clears the native location buffer after JS has successfully saved to Firebase.
     */
    @ReactMethod
    fun clearPendingSnapshots() {
        try {
            reactContext.applicationContext
                .getSharedPreferences("d2d_loc_buffer", 0)
                .edit().putString("snapshots", "[]").commit()
        } catch (_: Exception) {}
    }

    /**
     * Reverse geocodes lat/lng and returns locality text.
     */
    @ReactMethod
    fun getLocalityFromLatLng(lat: Double, lng: Double, promise: Promise) {
        try {
            val geocoder = Geocoder(reactContext.applicationContext, Locale.ENGLISH)
            @Suppress("DEPRECATION")
            val addresses = geocoder.getFromLocation(lat, lng, 1)
            val full = addresses?.firstOrNull()?.getAddressLine(0)?.trim().orEmpty()
            if (full.isEmpty()) {
                promise.resolve("")
                return
            }

            val locality = when {
                full.contains(", Rajasthan") -> full.substringBefore(", Rajasthan").trim()
                full.contains(", India") -> full.substringBefore(", India").trim()
                else -> full
            }
            promise.resolve(locality)
        } catch (_: Exception) {
            promise.resolve("")
        }
    }

    // Required by React Native NativeEventEmitter
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
