package com.iecapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener

/**
 * Phone notification when an IEC task is marked Not Approved.
 *
 * Runs inside LocationForegroundService (alive all duty long), so it works
 * while the app is open, in the background or swiped away. It watches
 *   IECData/IECRejectedTasks/{empId}
 * which the portal writes on every Not Approved decision, and notifies once
 * per decision:
 *   resubmissionRequired true/missing -> "please re-pick and submit again"
 *   resubmissionRequired false        -> reason, "no resubmission needed"
 * Tapping the notification opens the app (Dashboard shows the popup/card).
 *
 * Uses its own named FirebaseApp so it never touches the JS side's default
 * app. The config (empId + Firebase options) is saved by JS on login via
 * LocationTracker.setTaskAlertConfig and cleared on logout.
 */
class RejectedTaskNotifier(private val context: Context) {

    companion object {
        private const val TAG = "RejectedTaskNotifier"
        const val CONFIG_PREFS = "iec_task_alert_config"
        private const val STATE_PREFS = "iec_task_alert_state"
        private const val APP_NAME = "iec_task_alerts"
        private const val CHANNEL_ID = "iec_task_alerts"
        private const val NOTIF_ID = 3001
        private const val ROOT = "IECData/IECRejectedTasks"
        private val DATE_KEY = Regex("""\d{4}-\d{2}-\d{2}""")

        fun saveConfig(context: Context, config: Map<String, String>) {
            val edit = context.getSharedPreferences(CONFIG_PREFS, 0).edit().clear()
            config.forEach { (k, v) -> edit.putString(k, v) }
            edit.apply()
        }

        fun clearConfig(context: Context) {
            context.getSharedPreferences(CONFIG_PREFS, 0).edit().clear().apply()
        }
    }

    private var reference: DatabaseReference? = null
    private var listener: ValueEventListener? = null
    private var listeningKey = ""

    /** Starts (or keeps) listening for the logged-in executive. Idempotent. */
    fun start() {
        try {
            val cfg = context.getSharedPreferences(CONFIG_PREFS, 0)
            val empId = cfg.getString("empId", "").orEmpty()
            val dbUrl = cfg.getString("databaseURL", "").orEmpty()
            if (empId.isEmpty() || dbUrl.isEmpty()) {
                stop()
                return
            }
            val key = "$dbUrl|$empId"
            if (listener != null && key == listeningKey) return
            stop()

            val app = firebaseApp(cfg, dbUrl) ?: return
            val ref = FirebaseDatabase.getInstance(app, dbUrl).getReference("$ROOT/$empId")
            val l = object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) = onEntries(empId, snapshot)
                override fun onCancelled(error: DatabaseError) {
                    Log.w(TAG, "listener cancelled: ${error.message}")
                }
            }
            ref.addValueEventListener(l)
            reference = ref
            listener = l
            listeningKey = key
        } catch (error: Exception) {
            Log.w(TAG, "start failed: ${error.message}")
        }
    }

    fun stop() {
        try {
            listener?.let { reference?.removeEventListener(it) }
        } catch (_: Exception) {}
        listener = null
        reference = null
        listeningKey = ""
    }

    // Own named app, re-created if the city (database) changed.
    private fun firebaseApp(
        cfg: android.content.SharedPreferences,
        dbUrl: String,
    ): FirebaseApp? {
        val existing = FirebaseApp.getApps(context).firstOrNull { it.name == APP_NAME }
        if (existing != null) {
            if (existing.options.databaseUrl == dbUrl) return existing
            try { existing.delete() } catch (_: Exception) {}
        }
        val apiKey = cfg.getString("apiKey", "").orEmpty()
        val appId = cfg.getString("appId", "").orEmpty()
        if (apiKey.isEmpty() || appId.isEmpty()) return null
        val options = FirebaseOptions.Builder()
            .setApiKey(apiKey)
            .setApplicationId(appId)
            .setProjectId(cfg.getString("projectId", "").orEmpty())
            .setDatabaseUrl(dbUrl)
            .build()
        return FirebaseApp.initializeApp(context, options, APP_NAME)
    }

    private data class Alert(
        val signature: String,
        val taskName: String,
        val remark: String,
        val sendBack: Boolean,
    )

    private fun onEntries(empId: String, snapshot: DataSnapshot) {
        // Entries that still need the executive's attention. The signature
        // includes rejectedAt, so a new decision on the same task notifies again.
        // Layout: {date}/{taskId}/{key}/{entry}. Anything whose top level is
        // not a date (old flat test entries) is skipped.
        val open = mutableListOf<Alert>()
        for (dateNode in snapshot.children) {
            val date = dateNode.key ?: continue
            if (!DATE_KEY.matches(date)) continue
            for (taskNode in dateNode.children) {
                for (entry in taskNode.children) {
                    val sendBack =
                        entry.child("resubmissionRequired").getValue(Boolean::class.java) != false
                    val done = if (sendBack) {
                        entry.child("resubmitted").getValue(Boolean::class.java) == true
                    } else {
                        entry.child("acknowledged").getValue(Boolean::class.java) == true
                    }
                    if (done) continue
                    val rejectedAt = entry.child("rejectedAt").value?.toString().orEmpty()
                    open.add(
                        Alert(
                            signature = "$date/${taskNode.key}/${entry.key}|$rejectedAt",
                            taskName = entry.child("taskName").value?.toString().orEmpty()
                                .ifEmpty { "Task" },
                            remark = entry.child("remark").value?.toString().orEmpty(),
                            sendBack = sendBack,
                        ),
                    )
                }
            }
        }

        val state = context.getSharedPreferences(STATE_PREFS, 0)
        val notifiedKey = "notified_$empId"
        val baselineKey = "baseline_$empId"
        val notified = state.getStringSet(notifiedKey, emptySet()).orEmpty()
        val openSignatures = open.map { it.signature }.toSet()

        // First sync for this executive on this phone: whatever is already
        // there is shown by the Dashboard — only later decisions notify.
        if (!state.getBoolean(baselineKey, false)) {
            state.edit()
                .putStringSet(notifiedKey, openSignatures)
                .putBoolean(baselineKey, true)
                .apply()
            return
        }

        val fresh = open.filter { it.signature !in notified }
        // Keep only still-open signatures so the set never grows unbounded.
        state.edit().putStringSet(notifiedKey, openSignatures).apply()
        if (fresh.isNotEmpty()) notify(fresh)
    }

    private fun notify(alerts: List<Alert>) {
        try {
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) return
            createChannel()

            val title: String
            val text: String
            if (alerts.size == 1) {
                val a = alerts.first()
                title = "Task Not Approved"
                text = if (a.sendBack) {
                    "${a.taskName} — please re-pick it and submit again."
                } else {
                    val reason = if (a.remark.isNotEmpty()) ": ${a.remark}" else ""
                    "${a.taskName}$reason. No resubmission needed — tap to view the task."
                }
            } else {
                title = "${alerts.size} tasks not approved"
                text = alerts.joinToString("\n") { a ->
                    if (a.sendBack) "• ${a.taskName} — re-pick required"
                    else "• ${a.taskName} — no resubmission needed"
                }
            }

            val launch = context.packageManager
                .getLaunchIntentForPackage(context.packageName)
                ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP) }
            val pending = launch?.let {
                PendingIntent.getActivity(
                    context,
                    NOTIF_ID,
                    it,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            // Status bar: one-colour IEC logo (Android only uses its shape).
            // Inside the notification: the full-colour app icon.
            val appIcon = try {
                ContextCompat.getDrawable(context, R.mipmap.ic_launcher)?.toBitmap()
            } catch (_: Exception) { null }

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFF123B4A.toInt())
                .apply { if (appIcon != null) setLargeIcon(appIcon) }
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .apply { if (pending != null) setContentIntent(pending) }
                .build()
            manager.notify(NOTIF_ID, notification)
        } catch (error: SecurityException) {
            Log.w(TAG, "notification permission missing: ${error.message}")
        } catch (error: Exception) {
            Log.w(TAG, "notify failed: ${error.message}")
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Task Approvals",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Alerts when a submitted task is not approved"
        }
        context.getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }
}
