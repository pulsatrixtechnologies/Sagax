package com.openmausbot.companion.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.openmausbot.companion.BuildConfig
import com.openmausbot.companion.OpenMausApp
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/**
 * Closed-app pushes through Firebase Cloud Messaging (2026-10-26, "Me
 * joindre"). The server sends a data message (server/push/fcm.ts) when a
 * question or an approval waits on the person; [SagaxMessagingService] turns
 * it into the same local notification a live stream would post.
 *
 * Firebase starts only when the build carries the four identifiers (see
 * app/build.gradle.kts, no google-services.json in the repository). Without
 * them nothing here runs and the app keeps its local notifications only.
 */
object FcmSetup {
    @Volatile
    private var lastToken: String? = null

    fun options(): FirebaseOptions? {
        val appId = BuildConfig.SAGAX_FCM_APP_ID
        val apiKey = BuildConfig.SAGAX_FCM_API_KEY
        val projectId = BuildConfig.SAGAX_FCM_PROJECT_ID
        val senderId = BuildConfig.SAGAX_FCM_SENDER_ID
        if (appId.isBlank() || apiKey.isBlank() || projectId.isBlank() || senderId.isBlank()) return null
        return FirebaseOptions.Builder()
            .setApplicationId(appId)
            .setApiKey(apiKey)
            .setProjectId(projectId)
            .setGcmSenderId(senderId)
            .build()
    }

    /** Whether this build can get pushes at all. */
    fun available(): Boolean = options() != null

    /** Starts Firebase and hands the token to the server whenever the session is live. */
    fun start(app: OpenMausApp) {
        val options = options() ?: return
        try {
            if (FirebaseApp.getApps(app).isEmpty()) FirebaseApp.initializeApp(app, options)
            FirebaseMessaging.getInstance().isAutoInitEnabled = true
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> onToken(app, token) }
        } catch (_: Throwable) {
            // A broken Firebase setup costs closed-app pushes, never the app.
            return
        }
        app.appScope.launch {
            app.session.status
                .filter { it is Session.Status.Live }
                .distinctUntilChanged()
                .collect { lastToken?.let { token -> register(app, token) } }
        }
    }

    fun onToken(context: Context, token: String) {
        lastToken = token
        val app = context.applicationContext as? OpenMausApp ?: return
        app.appScope.launch { register(app, token) }
    }

    private suspend fun register(app: OpenMausApp, token: String) {
        app.session.registerPushToken(token, BuildConfig.VERSION_NAME)
    }
}
