package com.openmausbot.companion.core

import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy

@OptIn(ExperimentalCoroutinesApi::class)
class BrowserLiveTransportTest {
    @Test
    fun acknowledgesOnlyOneActiveAndTheLatestPendingFrame() = runTest {
        val first = CompletableDeferred<Unit>()
        val sent = mutableListOf<Int>()
        val acks = BrowserFrameAcks(this) { sequence ->
            sent.add(sequence)
            if (sequence == 1) first.await()
        }
        acks.enqueue(1)
        runCurrent()
        for (sequence in 2..100) acks.enqueue(sequence)
        first.complete(Unit)
        runCurrent()
        assertEquals(listOf(1, 100), sent)
        acks.stop()
        acks.enqueue(101)
        runCurrent()
        assertEquals(listOf(1, 100), sent)
    }

    @Test
    fun realStreamPreservesOwnershipAndRefusesAnOversizeLine() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "event: ready\ndata: {\"viewerId\":\"fixture\"}\n\n" +
                    "event: control\ndata: {\"controlling\":true,\"owned\":false,\"held\":false}\n\n",
            ))
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("data: " + "a".repeat(4 * 1024 * 1024)))
            server.start()
            val live = assertNotNull(CompanionClient(Connection(name = "Synthetic computer", host = "127.0.0.1", port = server.port), "fixture").browserLive())
            val messages = live.live("fixture").toList()
            assertEquals(BrowserLiveMessage.Ready("fixture"), messages[0])
            assertEquals(BrowserLiveMessage.Control(true, false, false), messages[1])
            val error = runCatching { live.live("fixture").toList() }.exceptionOrNull()
            assertIs<APIError.Transport>(error)
        }
        Unit
    }

    @Test
    fun cancellationClosesAnActionInsteadOfLeavingTheRequestRunning() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            server.start()
            val live = assertNotNull(CompanionClient(Connection(name = "Synthetic computer", host = "127.0.0.1", port = server.port), "fixture").browserLive())
            val action = launch(Dispatchers.IO) { live.action("fixture", "viewer", buildJsonObject { put("type", "take") }) }
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            val started = System.nanoTime()
            action.cancelAndJoin()
            assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(1))
        }
    }

    @Test
    fun browserCannotSendABearerToAnotherServerEnvironment() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"environmentId":"other","label":"Fixture","platform":"linux","version":"1"}"""))
            server.start()
            val connection = Connection(name = "Synthetic computer", host = "127.0.0.1", port = server.port, serverEnvironmentId = "expected")
            val live = assertNotNull(CompanionClient(connection, "fixture-secret").browserLive())
            val refused = runCatching { live.action("fixture", "viewer", buildJsonObject { put("type", "take") }) }.exceptionOrNull()
            assertEquals(401, assertIs<APIError.Status>(refused).code)
            val probe = assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            assertEquals("/.well-known/openmausbot/environment", probe.path)
            assertEquals(null, probe.getHeader("Authorization"))
            assertEquals(1, server.requestCount)
        }
    }
}
