package com.iecapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts LocationForegroundService if it gets killed by the system.
 * LocationForegroundService.onDestroy() broadcasts ACTION to trigger this receiver.
 */
class LocationServiceRestarter : BroadcastReceiver() {

    companion object {
        const val ACTION = "com.iecapp.RESTART_LOCATION_SERVICE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
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
