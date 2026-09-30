package com.openmausbot.companion.core

import java.net.URI
import java.net.URLEncoder
import kotlin.test.*

/**
 * "Sign in with Pulsatrix" from the phone (slice 2): the descriptor says the
 * server returns to native apps, the Custom Tab opens `?client=phone`, and the
 * server's answer is the invite link the app already accepts from a QR code.
 */
class PulsatrixSignInTest {
    private val credential = "omb_pair_" + "A1b2_C3d4-".repeat(4) + "xyz"

    @Test
    fun descriptorWithoutIdentityDecodesAndOffersNothing() {
        val environment = CompanionJson.decodeFromString<ServerEnvironment>(
            """{"environmentId":"e1","label":"Home","platform":"linux","capabilities":{"emailSignIn":false}}""",
        )
        assertNull(environment.identity)
        assertFalse(environment.offersPulsatrixSignIn)
    }

    @Test
    fun descriptorWithANativeReturnOffersTheSignIn() {
        val environment = CompanionJson.decodeFromString<ServerEnvironment>(
            """{"environmentId":"e1","label":"Acme","identity":{"kind":"perspicax","protocol":"oidc","issuer":"https://px.acme.test","loginPath":"/auth/oidc/start","nativeReturn":true}}""",
        )
        assertEquals("https://px.acme.test", environment.identity?.issuer)
        assertTrue(environment.offersPulsatrixSignIn)
        val older = CompanionJson.decodeFromString<ServerEnvironment>(
            """{"environmentId":"e1","label":"Acme","identity":{"kind":"perspicax","protocol":"oidc","issuer":"https://px.acme.test","loginPath":"/auth/oidc/start"}}""",
        )
        assertFalse(older.offersPulsatrixSignIn)
    }

    @Test
    fun startUrlAsksForThePhoneReturn() {
        assertEquals("https://bot.acme.test/auth/oidc/start?client=phone", PulsatrixSignIn.startUrl(URI("https://bot.acme.test"))?.toString())
        assertEquals("http://127.0.0.1:18788/auth/oidc/start?client=phone", PulsatrixSignIn.startUrl(URI("http://127.0.0.1:18788/pair?x=1#y"))?.toString())
        assertNull(PulsatrixSignIn.startUrl(URI("openmausbot://pair")))
    }

    @Test
    fun theServersReturnLinkIsAnInvite() {
        val address = URLEncoder.encode("https://bot.acme.test", "UTF-8")
        val link = URI("openmausbot://pair?address=$address&token=$credential&name=Acme%20%26%20Co")
        val invite = assertNotNull(PairingInvite.parse(link))
        assertEquals(credential, invite.credential)
        assertEquals("Acme & Co", invite.connection.name)
        assertNotNull(PulsatrixSignIn.invite(link, URI("https://bot.acme.test")))
        assertNull(PulsatrixSignIn.invite(link, URI("https://other.acme.test")))
        val companion = URI("openmausbot://pair?address=$address&code=123456")
        assertNull(PulsatrixSignIn.invite(companion, URI("https://bot.acme.test")))
    }
}
