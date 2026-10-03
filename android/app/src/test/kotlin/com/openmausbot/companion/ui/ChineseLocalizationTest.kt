package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.openmausbot.companion.R
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Offline compositions exercise Android's actual script-qualified resources. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ChineseLocalizationTest {
    @get:Rule val compose = createComposeRule()

    @Test
    @Config(qualifiers = "zh-rCN")
    fun simplifiedChineseDensityAndFormattedCopy() {
        showCopy()
        compose.onNodeWithText("列表密度").assertIsDisplayed()
        compose.onNodeWithText("紧凑").assertIsDisplayed()
        compose.onNodeWithText("显示全部 27 行").assertIsDisplayed()
        compose.onNodeWithText("MausBot").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "zh-rTW")
    fun traditionalChineseDensityAndFormattedCopy() {
        showCopy()
        compose.onNodeWithText("列表密度").assertIsDisplayed()
        compose.onNodeWithText("緊湊").assertIsDisplayed()
        compose.onNodeWithText("顯示全部 27 行").assertIsDisplayed()
        compose.onNodeWithText("MausBot").assertIsDisplayed()
    }

    @Test
    fun bothChineseCatalogsKeepResourceNamesAndFormatArguments() {
        val root = File("src/main/res").takeIf(File::isDirectory) ?: File("app/src/main/res")
        val english = strings(File(root, "values/strings.xml"))
        val arguments = Regex("%(?:\\d+\\$)?[a-zA-Z]")
        for (folder in listOf("values-b+zh+Hans", "values-b+zh+Hant")) {
            val translated = strings(File(root, "$folder/strings.xml"))
            assertEquals(english.keys, translated.keys, folder)
            for ((name, value) in english) {
                assertEquals(
                    arguments.findAll(value).map { it.value }.sorted().toList(),
                    arguments.findAll(translated.getValue(name)).map { it.value }.sorted().toList(),
                    "$folder:$name",
                )
            }
        }
    }

    private fun showCopy() = compose.setContent {
        Column {
            Text(localizedMobileCopy("List density"))
            Text(localizedMobileCopy("Compact"))
            Text(stringResource(R.string.mobile_diff_show_all_lines, 27))
            Text(stringResource(R.string.app_name))
        }
    }

    private fun strings(file: File): Map<String, String> {
        val entries = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(file).getElementsByTagName("string")
        return (0 until entries.length).map(entries::item)
            .filter { it.attributes.getNamedItem("translatable")?.nodeValue != "false" }
            .associate { entry ->
            entry.attributes.getNamedItem("name").nodeValue to entry.textContent
        }
    }
}
