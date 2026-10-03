package com.openmausbot.companion.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.lifecycle.Lifecycle
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.Fleet
import com.openmausbot.companion.core.Frame
import com.openmausbot.companion.core.StreamFrame
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Real screen, touch mapping and HTTP, confined to a synthetic loopback computer. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BrowserControlWiringTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val fixture = bot()
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    private val executor = Executors.newCachedThreadPool()
    private val streams = ConcurrentHashMap<String, HttpExchange>()
    private val actions = ConcurrentLinkedQueue<JsonObject>()
    private val releases = AtomicInteger()
    private val resumedReady = CountDownLatch(1)
    @Volatile private var owner: String? = null
    private lateinit var scene: WiringScene

    @After fun close() {
        if (::scene.isInitialized) scene.session.disconnect()
        streams.values.forEach(HttpExchange::close)
        server.stop(0)
        executor.shutdownNow()
    }

    @Test fun watchingTakingTouchTypingHandbackAndLeavingUseTheExactViewer() {
        server.executor = executor
        server.createContext("/") { exchange ->
            if (exchange.requestMethod == "GET" && exchange.requestURI.path.endsWith("/browser/live")) {
                val viewer = "viewer-${streams.size}-${System.nanoTime()}"
                streams[viewer] = exchange
                if (streams.size > 1) resumedReady.await()
                exchange.responseHeaders.set("Content-Type", "text/event-stream")
                exchange.sendResponseHeaders(200, 0)
                event(exchange, "ready", """{"viewerId":"$viewer"}""")
                event(exchange, "status", """{"connected":true,"screencasting":true,"viewportWidth":1280,"viewportHeight":720}""")
                event(exchange, "url", """{"url":"https://fixture.test"}""")
                event(exchange, "frame", """{"seq":1,"format":"png","data":"iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAEUlEQVR4nGMIIBEwjGoYFBoAUAWHAeeubRIAAAAASUVORK5CYII=","metadata":{"deviceWidth":1280,"deviceHeight":720}}""")
                control(viewer, exchange)
            } else {
                val body = Json.parseToJsonElement(exchange.requestBody.bufferedReader().readText()).jsonObject
                actions.add(body)
                val viewer = body["viewerId"]?.jsonPrimitive?.content
                when (body["type"]?.jsonPrimitive?.content) {
                    "take" -> owner = viewer
                    "release" -> if (owner == viewer) { owner = null; releases.incrementAndGet() }
                }
                streams.forEach { (id, stream) -> runCatching { control(id, stream) } }
                val response = "{}".toByteArray()
                exchange.responseHeaders.set("Content-Type", "application/json")
                exchange.sendResponseHeaders(200, response.size.toLong())
                exchange.responseBody.use { it.write(response) }
                exchange.close()
            }
        }
        server.start()
        scene = WiringScene(
            connection = Connection(name = "Synthetic computer", host = "127.0.0.1", port = server.address.port),
            fleet = Fleet(listOf(fixture), emptyList()),
            events = { flow { emit(StreamFrame(Frame.Hello(cursor = "fixture:1", resumed = false), seq = 1)); awaitCancellation() } },
        )
        var shown by mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionTheme(darkTheme = false) {
                    val state by scene.session.state.collectAsState()
                    if (shown && state.bot(fixture.id) != null) BrowserControlScreen(fixture.id, onBack = {})
                }
            }
        }
        compose.runOnIdle { scene.session.connect() }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("https://fixture.test").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("https://fixture.test").assertIsNotEnabled()
        takeControl()
        waitForHandBack()
        compose.onNodeWithContentDescription("${fixture.name}'s browser").performTouchInput { click(center) }
        compose.waitUntil(5_000) { actions.any { it["eventType"]?.jsonPrimitive?.content == "mouseReleased" } }
        val tap = actions.first { it["eventType"]?.jsonPrimitive?.content == "mouseReleased" }
        assertEquals(640.0, tap["x"]?.jsonPrimitive?.content?.toDouble())
        assertEquals(360.0, tap["y"]?.jsonPrimitive?.content?.toDouble())
        compose.onNode(hasSetTextAction() and hasText("Type into the page")).performTextInput("Ada")
        compose.waitUntil(5_000) { actions.any { it["text"]?.jsonPrimitive?.content == "Ada" } }
        compose.onNodeWithText("Hand back").performClick()
        compose.waitUntil(5_000) { releases.get() == 1 }
        compose.onNodeWithText("https://fixture.test").assertIsNotEnabled()
        takeControl()
        waitForHandBack()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.waitUntil(5_000) { releases.get() == 2 }
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitUntil(5_000) { streams.size == 2 }
        // Resume renders the watch button before its new stream is ready.
        // A click here is ignored; wait for readiness instead of label presence.
        compose.onNodeWithText("Take control").assertIsNotEnabled()
        resumedReady.countDown()
        compose.onNodeWithText("https://fixture.test").assertIsNotEnabled()
        takeControl()
        waitForHandBack()
        val takenViewer = actions.last { it["type"]?.jsonPrimitive?.content == "take" }["viewerId"]
        compose.runOnIdle { shown = false }
        compose.waitUntil(5_000) { releases.get() == 3 }
        assertEquals(takenViewer, actions.last { it["type"]?.jsonPrimitive?.content == "release" }["viewerId"])
        assertTrue(actions.all { it["viewerId"] != null })
    }

    private fun takeControl() {
        compose.waitUntil(5_000) {
            compose.onAllNodes(hasText("Take control") and isEnabled()).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Take control").assertIsEnabled().performClick()
    }

    private fun waitForHandBack() = compose.waitUntil(5_000) {
        compose.onAllNodesWithText("Hand back").fetchSemanticsNodes().isNotEmpty()
    }

    private fun control(viewer: String, exchange: HttpExchange) = event(exchange, "control",
        """{"controlling":${owner == null || owner == viewer},"held":${owner != null},"owned":${owner == viewer}}""")

    private fun event(exchange: HttpExchange, name: String, json: String) {
        synchronized(exchange) {
            exchange.responseBody.write("event: $name\ndata: $json\n\n".toByteArray())
            exchange.responseBody.flush()
        }
    }
}
