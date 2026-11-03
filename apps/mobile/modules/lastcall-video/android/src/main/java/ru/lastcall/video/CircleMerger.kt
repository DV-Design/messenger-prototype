package ru.lastcall.video

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.google.common.collect.ImmutableSet
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Joins camera segments into one MP4. Segments may come from different lenses
 * and therefore different frame sizes; Media3 normalizes rotation and scales
 * each item into one consistent output, which a raw MediaMuxer copy cannot do.
 */
@UnstableApi
object CircleMerger {
  class MergeException(val errorCode: String, message: String, cause: Throwable? = null) : Exception(message, cause)

  suspend fun merge(context: Context, inputs: List<File>, output: File): Long = withContext(Dispatchers.Main.immediate) {
    if (inputs.size < 2 || inputs.size > 8) {
      throw MergeException("E_CONCAT_INPUTS", "Expected 2 to 8 recorded segments.")
    }
    var totalBytes = 0L
    for (input in inputs) {
      if (!input.isFile || input.length() <= 0L) {
        throw MergeException("E_CONCAT_INPUTS", "A recorded segment is missing.")
      }
      totalBytes += input.length()
      if (totalBytes > 40L * 1024L * 1024L) {
        throw MergeException("E_CONCAT_INPUTS", "The recorded segments are too large.")
      }
      if (input.canonicalPath == output.canonicalPath) {
        throw MergeException("E_CONCAT_INPUTS", "The output cannot replace a recorded segment.")
      }
    }
    output.parentFile?.mkdirs()
    if (output.exists() && !output.delete()) {
      throw MergeException("E_CONCAT_OUTPUT", "The output file cannot be replaced.")
    }

    suspendCancellableCoroutine { continuation ->
      val items = inputs.map { file ->
        EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(file))).build()
      }
      val sequence = EditedMediaItemSequence.Builder(
        ImmutableSet.of(C.TRACK_TYPE_VIDEO, C.TRACK_TYPE_AUDIO)
      ).apply {
        items.forEach(::addItem)
      }.build()
      val composition = Composition.Builder(sequence).build()
      val encoderFactory = DefaultEncoderFactory.Builder(context)
        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(600_000).build())
        .setRequestedAudioEncoderSettings(AudioEncoderSettings.Builder().setBitrate(64_000).build())
        .build()
      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(encoderFactory)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            if (continuation.isActive) continuation.resume(exportResult.durationMs)
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException
          ) {
            output.delete()
            if (continuation.isActive) {
              continuation.resumeWithException(
                MergeException("E_CONCAT_FAILED", exportException.message ?: "The video could not be processed.", exportException)
              )
            }
          }
        })
        .build()
      transformer.start(composition, output.absolutePath)
      continuation.invokeOnCancellation {
        transformer.cancel()
        output.delete()
      }
    }
  }
}
