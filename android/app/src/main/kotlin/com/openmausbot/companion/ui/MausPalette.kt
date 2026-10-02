package com.openmausbot.companion.ui

/**
 * The mascot palette: `shared/mascot-colors.ts` (all but white and black), shared
 * with `ios/App/MausAvatar.swift`, with the same fallback grey. Rooms are
 * always `"blue"` (that lives in `:core`'s `Chat.RoomChat.color`).
 *
 * Plain ARGB ints rather than `Color` so the mapping is unit-testable on the JVM.
 */
object MausPalette {
    const val FALLBACK: Int = 0xFF8E8E93.toInt()

    private val hex: Map<String, Int> = mapOf(
        "green" to 0xFF009957.toInt(),
        "blue" to 0xFF377FE6.toInt(),
        "red" to 0xFFD94B52.toInt(),
        "orange" to 0xFFE78531.toInt(),
        "purple" to 0xFF8057C8.toInt(),
        "cyan" to 0xFF0EA5C6.toInt(),
        "pink" to 0xFFD84F8B.toInt(),
        "yellow" to 0xFFD8A729.toInt(),
        "teal" to 0xFF01A492.toInt(),
        "coral" to 0xFFE5634E.toInt(),
        "brown" to 0xFF8B5E3C.toInt(),
        "amber" to 0xFFF2A51A.toInt(),
        "grey" to 0xFF8E949E.toInt(),
        "blush" to 0xFFF3A5B6.toInt(),
        "peach" to 0xFFF6B897.toInt(),
        "butter" to 0xFFF1D88B.toInt(),
        "pistachio" to 0xFFC5DE98.toInt(),
        "mint" to 0xFF98DDB9.toInt(),
        "aqua" to 0xFF92DCD8.toInt(),
        "sky" to 0xFF9CC8F2.toInt(),
        "periwinkle" to 0xFFAEB4F1.toInt(),
        "lavender" to 0xFFC3AAEE.toInt(),
        "lilac" to 0xFFDDA9E3.toInt(),
        "wine" to 0xFF7A1F3A.toInt(),
        "rust" to 0xFF8E3A1E.toInt(),
        "olive" to 0xFF5F5E1F.toInt(),
        "forest" to 0xFF1E5B3B.toInt(),
        "petrol" to 0xFF0F5560.toInt(),
        "navy" to 0xFF1E3A70.toInt(),
        "midnight" to 0xFF1B2448.toInt(),
        "indigo" to 0xFF3A2F8F.toInt(),
        "plum" to 0xFF5B2A6A.toInt(),
        "berry" to 0xFF7B1F5E.toInt(),
        "scarlet" to 0xFFFF2D55.toInt(),
        "blaze" to 0xFFFF6A13.toInt(),
        "citrus" to 0xFFFFE81F.toInt(),
        "lime" to 0xFFB6FF2E.toInt(),
        "volt" to 0xFF2BFF88.toInt(),
        "laser" to 0xFF1FE5FF.toInt(),
        "electric" to 0xFF2F6BFF.toInt(),
        "ultraviolet" to 0xFF8A3BFF.toInt(),
        "magenta" to 0xFFF13BEB.toInt(),
        "hotpink" to 0xFFFF3FA4.toInt(),
        "silver" to 0xFFBFC5CD.toInt(),
        "graphite" to 0xFF4B4F58.toInt(),
        "sand" to 0xFFD9C4A1.toInt(),
        "taupe" to 0xFF8C7B6E.toInt(),
        "bronze" to 0xFFA86F38.toInt(),
        "copper" to 0xFFC2643A.toInt(),
        "brass" to 0xFFC7A13D.toInt(),
    )

    val names: Set<String> get() = hex.keys

    fun argb(name: String): Int = hex[name] ?: FALLBACK

    /**
     * Linear mix in sRGB, matching the `mix()` the desktop uses to build its
     * gradient stops. Not perceptually correct, and deliberately so: the point is
     * to land on the same colours as the other screen.
     */
    fun mix(from: Int, to: Int, amount: Double): Int {
        val t = amount.coerceIn(0.0, 1.0)
        fun channel(shift: Int): Int {
            val a = (from shr shift) and 0xFF
            val b = (to shr shift) and 0xFF
            return (a + (b - a) * t).toInt().coerceIn(0, 255)
        }
        return (0xFF shl 24) or
            (channel(16) shl 16) or
            (channel(8) shl 8) or
            channel(0)
    }

    private const val WHITE = 0xFFFFFFFF.toInt()
    private const val BLACK = 0xFF000000.toInt()

    /** The three gradient stops the desktop draws the mascot with. */
    fun gradient(name: String): List<Pair<Float, Int>> {
        val base = argb(name)
        return listOf(
            0f to mix(base, WHITE, 0.55),
            0.55f to base,
            1f to mix(base, BLACK, 0.42),
        )
    }
}
