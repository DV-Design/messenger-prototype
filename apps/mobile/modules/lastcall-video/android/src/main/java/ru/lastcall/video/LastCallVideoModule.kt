package ru.lastcall.video

import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking
import java.io.File

@androidx.media3.common.util.UnstableApi
class LastCallVideoModule : Module() {
  private var merging = false

  override fun definition() = ModuleDefinition {
    Name("LastCallVideo")

    AsyncFunction("concatMp4") { inputs: List<String>, output: String ->
      val context = appContext.reactContext
        ?: throw CodedException("E_CONCAT_CONTEXT", "The app context is unavailable.", null)
      if (merging) throw CodedException("E_CONCAT_BUSY", "A video is already being processed.", null)
      merging = true
      try {
        runBlocking { CircleMerger.merge(context, inputs.map(::toFile), toFile(output)) }.toDouble()
      } catch (error: CircleMerger.MergeException) {
        throw CodedException(error.errorCode, error.message, error.cause)
      } finally {
        merging = false
      }
    }
  }

  /** Accepts the absolute paths and file:// URIs produced by expo-camera. */
  private fun toFile(value: String): File {
    val uri = Uri.parse(value)
    val path = when (uri.scheme) {
      null, "" -> value
      "file" -> uri.path
      else -> null
    }
    if (path.isNullOrBlank()) {
      throw CodedException("E_CONCAT_PATH", "Only local recorded files can be processed.", null)
    }
    return File(path)
  }
}
