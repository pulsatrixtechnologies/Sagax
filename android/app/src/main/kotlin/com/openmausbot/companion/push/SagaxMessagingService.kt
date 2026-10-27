package com.openmausbot.companion.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.openmausbot.companion.OpenMausApp
import com.openmausbot.companion.core.NotificationFrame

/**
 * The FCM data messages of server/push/fcm.ts: a question, an approval, a
 * message or a routine becomes the same local notification a live stream
 * posts ([com.openmausbot.companion.notifications.LocalNotificationPoster]),
 * with the bot and the conversation a tap opens. A `read` message (the
 * conversation was read elsewhere) posts nothing.
 */
class SagaxMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        FcmSetup.onToken(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val frame = frameOf(message.data) ?: return
        val app = applicationContext as? OpenMausApp ?: return
        app.notifications.deliver(frame, null)
    }

    companion object {
        /** The notification a push stands for, or null (a read, or no conversation). */
        fun frameOf(data: Map<String, String>): NotificationFrame? {
            val kind = data["kind"] ?: return null
            if (kind == "read") return null
            val threadId = data["threadId"].orEmpty()
            val title = data["title"].orEmpty()
            val body = data["body"].orEmpty()
            if (title.isBlank() && body.isBlank()) return null
            // the push says "approval" for both; the app's frames tell a question apart
            val frameKind = when {
                kind == "approval" && data["prompt"] == "question" -> "question"
                kind == "approval" -> "approval"
                kind == "routine" -> "routine-failed"
                else -> "message"
            }
            return NotificationFrame(
                kind = frameKind,
                botId = data["botId"].orEmpty(),
                botName = data["senderName"] ?: title,
                threadId = threadId,
                title = title,
                body = body,
            )
        }
    }
}
