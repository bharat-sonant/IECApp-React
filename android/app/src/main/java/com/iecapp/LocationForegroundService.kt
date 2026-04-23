package com.iecapp

import android.app.*
import android.content.pm.ServiceInfo
import android.content.Intent
import android.location.Location
import android.os.*
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.*
import java.text.SimpleDateFormat
import java.util.*

class LocationForegroundService : Service() {

    companion object {
        var reactContext: ReactApplicationContext? = null
        var isJsActive: Boolean = true
        private const val CHANNEL_ID = "iec_location_channel"
        private const val NOTIF_ID   = 2001

        // Defaults
        private const val DEFAULT_GPS_INTERVAL_MS      = 10_000L
        private const val DEFAULT_ACCURACY_THRESHOLD_M = 50f
        private const val DEFAULT_SNAPSHOT_INTERVAL_MS = 60_000L
        private const val DEFAULT_MIN_DISTANCE_M       = 10f
        private const val DEFAULT_STILL_INTERVAL_MS    = 30_000L
        private const val DEFAULT_STILL_SPEED_KMH      = 3.0f
        private const val DEFAULT_STILL_FIX_COUNT      = 3
        private const val DEFAULT_MOVE_FIX_COUNT       = 2
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var wakeLock: PowerManager.WakeLock? = null

    // Config
    private var gpsIntervalMs      = DEFAULT_GPS_INTERVAL_MS
    private var accuracyThresholdM = DEFAULT_ACCURACY_THRESHOLD_M
    private var snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS
    private var minDistanceM       = DEFAULT_MIN_DISTANCE_M
    private var stillIntervalMs    = DEFAULT_STILL_INTERVAL_MS
    private var stillSpeedKmh      = DEFAULT_STILL_SPEED_KMH
    private var stillFixCount      = DEFAULT_STILL_FIX_COUNT
    private var moveFixCount       = DEFAULT_MOVE_FIX_COUNT

    // Adaptive State
    private var isLowPowerMode     = false
    private var stillStreak        = 0
    private var movingStreak       = 0
    private var lastAdaptiveLoc: Location? = null

    // Minute buffer
    private val minutePoints   = mutableListOf<Location>()
    private var minuteDistance = 0f
    private var lastPoint: Location? = null
    private var firstPointAdded = false

    private val handler = Handler(Looper.getMainLooper())
    private val minuteTick = object : Runnable {
        override fun run() {
            flushMinuteSnapshot()
            handler.postDelayed(this, snapshotIntervalMs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
        buildLocationCallback()
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IEC:LocationTracking").apply {
            acquire(12 * 60 * 60 * 1000L)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Reset state for new tracking session
        firstPointAdded = false
        minutePoints.clear()
        minuteDistance = 0f
        lastPoint = null

        val prefs = applicationContext.getSharedPreferences("d2d_tracking_config", 0)
        gpsIntervalMs      = prefs.getLong("gpsIntervalMs",      DEFAULT_GPS_INTERVAL_MS)
        accuracyThresholdM = prefs.getFloat("accuracyThresholdM", DEFAULT_ACCURACY_THRESHOLD_M)
        snapshotIntervalMs = prefs.getLong("snapshotIntervalMs", DEFAULT_SNAPSHOT_INTERVAL_MS)
        minDistanceM       = prefs.getFloat("minDistanceM",       DEFAULT_MIN_DISTANCE_M)
        stillIntervalMs    = prefs.getLong("stillIntervalMs",     DEFAULT_STILL_INTERVAL_MS)
        stillSpeedKmh      = prefs.getFloat("stillSpeedKmh",      DEFAULT_STILL_SPEED_KMH)
        stillFixCount      = prefs.getInt("stillFixCount",        DEFAULT_STILL_FIX_COUNT).coerceAtLeast(1)
        moveFixCount       = prefs.getInt("moveFixCount",         DEFAULT_MOVE_FIX_COUNT).coerceAtLeast(1)

        isLowPowerMode = false
        stillStreak = 0
        movingStreak = 0
        lastAdaptiveLoc = null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIF_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(NOTIF_ID, buildNotification())
        }
        startLocationUpdates(highAccuracy = true)
        handler.postDelayed(minuteTick, snapshotIntervalMs)
        return START_STICKY
    }

    override fun onDestroy() {
        fusedClient.removeLocationUpdates(locationCallback)
        handler.removeCallbacks(minuteTick)
        flushMinuteSnapshot()
        wakeLock?.let { if (it.isHeld) it.release() }
        sendBroadcast(Intent(LocationServiceRestarter.ACTION).setPackage(packageName))
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = null

    private fun buildLocationCallback() {
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return

                // First point always accepted (no accuracy filter), subsequent points filtered
                val isFirstPoint = minutePoints.isEmpty()
                if (!isFirstPoint && loc.accuracy > accuracyThresholdM) {
                    return
                }

                emitCurrentLocation(loc)
                evaluatePowerMode(loc)

                // If we already have points in this minute's buffer, apply distance filter
                if (minutePoints.isNotEmpty()) {
                    val moved = lastPoint?.distanceTo(loc) ?: return
                    if (moved < minDistanceM) {
                        lastPoint = loc
                        return
                    }
                    minuteDistance += moved
                }

                minutePoints.add(loc)
                lastPoint = loc

                // Flush immediately for the first valid point to ensure first GPS fix is saved
                if (!firstPointAdded) {
                    firstPointAdded = true
                    flushMinuteSnapshot()
                }
            }
        }
    }

    private fun startLocationUpdates(highAccuracy: Boolean) {
        val interval = if (highAccuracy) gpsIntervalMs else stillIntervalMs
        val priority = if (highAccuracy) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        isLowPowerMode = !highAccuracy

        val request = LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(interval)
            .build()

        try {
            fusedClient.removeLocationUpdates(locationCallback)
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            fusedClient.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    // Use cached location only if recent (within 2 minutes)
                    val ageMs = System.currentTimeMillis() - loc.time
                    if (ageMs <= 120_000) {
                        lastPoint = loc
                        minutePoints.add(loc)
                        minuteDistance = 0f
                        // Immediate flush (JS listeners already attached)
                        flushMinuteSnapshot()
                        firstPointAdded = true
                        emitCurrentLocation(loc)
                    }
                }
            }
        } catch (_: SecurityException) { /* permission not granted */ }
    }

    private fun evaluatePowerMode(loc: Location) {
        if (loc.accuracy > accuracyThresholdM * 1.5f) {
            lastAdaptiveLoc = loc
            return
        }

        val previous = lastAdaptiveLoc
        val speedKmh = if (loc.hasSpeed()) {
            (loc.speed * 3.6f).coerceAtLeast(0f)
        } else if (previous != null) {
            val dtSec = ((loc.time - previous.time).coerceAtLeast(1L)).toFloat() / 1000f
            val movedM = previous.distanceTo(loc)
            ((movedM / dtSec) * 3.6f).coerceAtLeast(0f)
        } else {
            0f
        }

        val movedM = previous?.distanceTo(loc) ?: 0f
        val isStillFix = speedKmh < stillSpeedKmh && movedM < minDistanceM

        if (isStillFix) {
            stillStreak += 1
            movingStreak = 0
            if (!isLowPowerMode && stillStreak >= stillFixCount) {
                startLocationUpdates(highAccuracy = false)
                stillStreak = 0
            }
        } else {
            movingStreak += 1
            stillStreak = 0
            if (isLowPowerMode && movingStreak >= moveFixCount) {
                startLocationUpdates(highAccuracy = true)
                movingStreak = 0
            }
        }

        lastAdaptiveLoc = loc
    }

    private fun emitCurrentLocation(loc: Location) {
        val ctx = reactContext ?: return
        val map = Arguments.createMap().apply {
            putDouble("latitude", loc.latitude)
            putDouble("longitude", loc.longitude)
            putDouble("accuracy", loc.accuracy.toDouble())
            putDouble("speed",   if (loc.hasSpeed()) loc.speed.toDouble() else 0.0)
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onLocationUpdate", map)
    }

    private fun flushMinuteSnapshot() {
        if (minutePoints.isEmpty()) return

        val path = minutePoints.joinToString("~") { "(${it.latitude},${it.longitude})" }
        val dist = minuteDistance.toDouble()
        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

        val ctx = reactContext
        if (ctx == null) {
            val saved = bufferSnapshotToPrefs(path, dist, time, date)
            if (saved) {
                minutePoints.clear()
                minuteDistance = 0f
                lastPoint = null
            }
            return
        }

        minutePoints.clear()
        minuteDistance = 0f
        lastPoint = null

        val map = Arguments.createMap().apply {
            putString("path", path)
            putDouble("distanceInMeters", dist)
            putString("time", time)
            putString("date", date)
            putDouble("timestamp", Date().time.toDouble())
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onMinuteSnapshot", map)
    }

    private fun bufferSnapshotToPrefs(path: String, dist: Double, time: String, date: String): Boolean {
        return try {
            val prefs    = applicationContext.getSharedPreferences("d2d_loc_buffer", MODE_PRIVATE)
            val existing = prefs.getString("snapshots", "[]")!!
            val arr      = org.json.JSONArray(existing)
            arr.put(org.json.JSONObject().apply {
                put("path", path)
                put("distanceInMeters", dist)
                put("time", time)
                put("date", date)
            })
            prefs.edit().putString("snapshots", arr.toString()).commit()
        } catch (_: Exception) { false }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "IEC Location Tracking",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Tracks user location during duty"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("IEC - Active")
            .setContentText("Location tracking in progress")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
}
