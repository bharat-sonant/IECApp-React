package com.iecapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Keeps location tracking resilient across screen lock / unlock transitions.
 * This mirrors the lock-screen handling used in the older app:
 * - screen off: make sure the foreground tracking service stays alive
 * - user present: re-assert the service if the system delayed it while locked
 */
class LocationScreenStateReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_SCREEN_OFF,
            Intent.ACTION_USER_PRESENT -> {
                if (LocationModule.shouldPreventRestartForTracking(context)) return
                if (LocationModule.isPastDailyCutoff()) return
                val serviceIntent = Intent(context, LocationForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }
}
