package ru.lastcall.video

import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class CircleMergerTest {
  @Test
  fun mergesDifferentLensSegmentsIntoOnePlayableFile() = runBlocking {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val dir = File(context.cacheDir, "circle-merge-test").apply {
      deleteRecursively()
      mkdirs()
    }
    val assets = instrumentation.context.assets
    val inputs = listOf("segment-front.mp4", "segment-back.mp4").map { name ->
      File(dir, name).also { file ->
        assets.open(name).use { input -> file.outputStream().use(input::copyTo) }
      }
    }
    val output = File(dir, "merged.mp4")

    val reportedMs = CircleMerger.merge(context, inputs, output)

    assertTrue(output.isFile)
    assertTrue(output.length() > 0L)
    assertTrue(reportedMs > 1_500L)
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(output.absolutePath)
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
      assertTrue(duration > 1_500L)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)!!.toInt()
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)!!.toInt()
      assertTrue(width in setOf(480, 640))
      assertTrue(height in setOf(480, 640))
    } finally {
      retriever.release()
    }
  }
}
