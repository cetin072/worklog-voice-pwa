package expo.modules.worklogmeetingaudio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.roundToInt

/**
 * Local-only M4A/AAC -> 16kHz mono PCM16 WAV preparation.
 *
 * MediaExtractor/MediaCodec stream a few KB at a time. No full 30-60 minute
 * recording or decoded audio is loaded into JS/RAM. Source files are immutable.
 * The output WAV is a disposable, separately named app-cache artifact.
 */
class WorklogMeetingAudioModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WorklogMeetingAudio")
    AsyncFunction("prepareM4a") { sourceUri: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("업무수첩 Android 오디오 환경을 확인하지 못했습니다.")
      prepare(sourceUri, context.filesDir, context.cacheDir)
    }
  }

  private fun prepare(uri: String, documents: File, cache: File): Map<String, Any> {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "회의 녹음은 기기 내부 파일만 허용합니다." }
    val source = File(parsed.path ?: "").canonicalFile
    val root = documents.canonicalFile
    require(source.path.startsWith(root.path + File.separator) &&
      Regex("^recording-[0-9a-fA-F-]{36}\\.m4a$").matches(source.name)) {
      "업무수첩에서 저장한 M4A 녹음만 변환할 수 있습니다."
    }
    require(source.isFile && source.length() > 0L && source.length() <= 512L * 1024L * 1024L) {
      "녹음 파일을 찾지 못했거나 길이가 허용 범위를 벗어났습니다."
    }

    val output = File(cache, "meeting-stt-" + UUID.randomUUID() + ".wav")
    val pending = File(cache, output.name + ".pending")
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    var decoderStarted = false
    try {
      extractor.setDataSource(source.absolutePath)
      var track = -1
      var trackFormat: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        if (mime.startsWith("audio/")) {
          track = i
          trackFormat = format
          break
        }
      }
      require(track >= 0 && trackFormat != null) { "M4A 오디오 트랙을 찾지 못했습니다." }
      val mime = trackFormat.getString(MediaFormat.KEY_MIME)
        ?: throw IllegalArgumentException("오디오 형식이 없습니다.")
      extractor.selectTrack(track)
      decoder = MediaCodec.createDecoderByType(mime)
      decoder.configure(trackFormat, null, null, 0)
      decoder.start()
      decoderStarted = true

      val startedAt = SystemClock.elapsedRealtime()
      val maxProcessingMs = 15L * 60L * 1000L
      val info = MediaCodec.BufferInfo()
      var sentEos = false
      var receivedEos = false
      var idleCycles = 0
      var sampleRate = 0
      var channels = 0

      RandomAccessFile(pending, "rw").use { wav ->
        wav.setLength(0L)
        // Reserve the 44-byte RIFF header. It is finalized only on success.
        wav.write(ByteArray(44))
        val writer = PcmWavWriter(wav)
        val resampler = StreamingMonoResampler(writer)

        while (!receivedEos) {
          check(SystemClock.elapsedRealtime() - startedAt < maxProcessingMs) {
            "장시간 전사 준비가 제한 시간을 초과했습니다."
          }
          var progressed = false
          if (!sentEos) {
            val inputIndex = decoder.dequeueInputBuffer(10_000)
            if (inputIndex >= 0) {
              val input = decoder.getInputBuffer(inputIndex)
                ?: throw IllegalStateException("오디오 입력 버퍼가 없습니다.")
              input.clear()
              val size = extractor.readSampleData(input, 0)
              if (size < 0) {
                decoder.queueInputBuffer(inputIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                sentEos = true
              } else {
                decoder.queueInputBuffer(inputIndex, 0, size,
                  extractor.sampleTime.coerceAtLeast(0L), 0)
                extractor.advance()
              }
              progressed = true
            }
          }

          val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)
          when {
            outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              val out = decoder.outputFormat
              val encoding = if (out.containsKey(MediaFormat.KEY_PCM_ENCODING))
                out.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
              require(encoding == AudioFormat.ENCODING_PCM_16BIT) {
                "이 기기의 오디오 디코더가 PCM16을 반환하지 않습니다."
              }
              val newRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              val newChannels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              require(newRate in 8000..192000 && newChannels in 1..8) {
                "지원되지 않는 샘플레이트 또는 채널 수입니다."
              }
              require(sampleRate == 0 || (sampleRate == newRate && channels == newChannels)) {
                "전사 준비 중 오디오 형식이 변경됐습니다."
              }
              sampleRate = newRate
              channels = newChannels
              progressed = true
            }
            outputIndex >= 0 -> {
              try {
                if (info.size > 0) {
                  val outFormat = decoder.outputFormat
                  val encoding = if (outFormat.containsKey(MediaFormat.KEY_PCM_ENCODING))
                    outFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                  require(encoding == AudioFormat.ENCODING_PCM_16BIT) {
                    "PCM16이 아닌 오디오 출력은 변환하지 않습니다."
                  }
                  val rate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                  val count = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                  require(rate in 8000..192000 && count in 1..8 &&
                    (sampleRate == 0 || (sampleRate == rate && channels == count))) {
                    "오디오 출력 형식이 올바르지 않습니다."
                  }
                  sampleRate = rate
                  channels = count
                  require(info.size % (2 * count) == 0) {
                    "디코딩된 PCM 프레임이 잘렸습니다."
                  }
                  val audio = decoder.getOutputBuffer(outputIndex)
                    ?: throw IllegalStateException("오디오 출력 버퍼가 없습니다.")
                  audio.order(ByteOrder.LITTLE_ENDIAN)
                  audio.position(info.offset)
                  audio.limit(info.offset + info.size)
                  // One frame at a time; no full-file ByteArray or AudioBuffer.
                  while (audio.remaining() >= count * 2) {
                    var sum = 0.0
                    repeat(count) { sum += audio.short.toDouble() }
                    resampler.accept(sum / count, rate)
                  }
                }
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) receivedEos = true
              } finally {
                decoder.releaseOutputBuffer(outputIndex, false)
              }
              progressed = true
            }
          }
          if (progressed) idleCycles = 0 else idleCycles++
          check(idleCycles <= 500) { "오디오 디코더가 응답하지 않습니다." }
        }

        writer.finish()
        require(writer.samples > 0 && writer.dataBytes > 0L) {
          "전사 가능한 음성 샘플이 없습니다."
        }
        writeWavHeader(wav, writer.dataBytes)
        wav.fd.sync()
        require(pending.length() == writer.dataBytes + 44L) {
          "WAV 출력 크기를 검증하지 못했습니다."
        }
        require(!output.exists() && pending.renameTo(output)) {
          "전사 WAV 파일을 최종 위치에 저장하지 못했습니다."
        }
        return mapOf(
          "uri" to Uri.fromFile(output).toString(),
          "sampleRate" to 16000,
          "channels" to 1,
          "durationMs" to ((writer.samples * 1000L) / 16000L).toInt()
        )
      }
    } finally {
      try { if (decoderStarted) decoder?.stop() } catch (_: Exception) { }
      try { decoder?.release() } catch (_: Exception) { }
      extractor.release()
      if (pending.exists()) pending.delete()
      // The output is deliberately retained on success for transcription.
      // On exception before promotion no completed output can exist.
    }
  }

  private class PcmWavWriter(private val file: RandomAccessFile) {
    private val buffer = ByteArray(8192)
    private var buffered = 0
    var dataBytes: Long = 0L
      private set
    var samples: Long = 0L
      private set

    fun sample(value: Double) {
      check(dataBytes + buffered + 2L <= 256L * 1024L * 1024L) {
        "전사용 WAV 최대 크기를 초과했습니다."
      }
      val v = value.roundToInt().coerceIn(-32768, 32767)
      buffer[buffered++] = (v and 255).toByte()
      buffer[buffered++] = ((v shr 8) and 255).toByte()
      samples++
      if (buffered == buffer.size) flush()
    }
    private fun flush() {
      if (buffered > 0) {
        file.write(buffer, 0, buffered)
        dataBytes += buffered
        buffered = 0
      }
    }
    fun finish() = flush()
  }

  /** Continuous linear interpolation preserves transitions between codec output buffers. */
  private class StreamingMonoResampler(private val output: PcmWavWriter) {
    private var inputRate = 0
    private var previous = 0.0
    private var frames = 0L
    private var nextOutputPosition = 0.0

    fun accept(mono: Double, rate: Int) {
      if (inputRate == 0) inputRate = rate
      require(inputRate == rate) { "오디오 샘플레이트가 중간에 변경됐습니다." }
      if (frames == 0L) {
        output.sample(mono)
        nextOutputPosition = rate.toDouble() / 16000.0
      } else {
        val from = (frames - 1L).toDouble()
        while (nextOutputPosition <= frames.toDouble()) {
          val mix = nextOutputPosition - from
          output.sample(previous + (mono - previous) * mix)
          nextOutputPosition += rate.toDouble() / 16000.0
        }
      }
      previous = mono
      frames++
    }
  }

  private fun le32(file: RandomAccessFile, value: Long) {
    file.write(byteArrayOf(
      (value and 255L).toByte(),
      ((value shr 8) and 255L).toByte(),
      ((value shr 16) and 255L).toByte(),
      ((value shr 24) and 255L).toByte()
    ))
  }
  private fun le16(file: RandomAccessFile, value: Int) {
    file.write(byteArrayOf((value and 255).toByte(), ((value shr 8) and 255).toByte()))
  }
  private fun writeWavHeader(file: RandomAccessFile, pcmBytes: Long) {
    check(pcmBytes in 2L..(0xffffffffL - 36L))
    file.seek(0L)
    file.writeBytes("RIFF")
    le32(file, 36L + pcmBytes)
    file.writeBytes("WAVE")
    file.writeBytes("fmt ")
    le32(file, 16)
    le16(file, 1) // Signed integer PCM
    le16(file, 1) // mono
    le32(file, 16000)
    le32(file, 16000 * 2L)
    le16(file, 2) // block align
    le16(file, 16)
    file.writeBytes("data")
    le32(file, pcmBytes)
  }
}
