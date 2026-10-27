package com.ahududu.app

import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.File

/**
 * Sesli not kaydı — m4a (AAC) üretir, sunucunun kabul ettiği `audio/mp4` türüyle yüklenir.
 * Kayıt yalnızca kullanıcı düğmeye bastığında başlar; gizli kayıt yoktur.
 */
class AudioNoteRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var target: File? = null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    fun start(): Boolean {
        if (recorder != null) return true
        val dir = File(context.cacheDir, "audio-notes").apply { mkdirs() }
        val file = File(dir, "note-${System.currentTimeMillis()}.m4a")
        val mr = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        return runCatching {
            mr.setAudioSource(MediaRecorder.AudioSource.MIC)
            mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            mr.setAudioEncodingBitRate(96_000)
            mr.setAudioSamplingRate(44_100)
            mr.setOutputFile(file.absolutePath)
            mr.prepare()
            mr.start()
            recorder = mr
            target = file
            true
        }.getOrElse {
            runCatching { mr.release() }
            recorder = null
            target = null
            false
        }
    }

    /** Kaydı bitirir ve dosyayı döner. */
    fun stop(): File? {
        val mr = recorder ?: return null
        recorder = null
        val file = target
        target = null

        // Çok kısa kayıtlar MediaRecorder'da boş dosya üretebilir; hatayı yut ama dosyayı doğrula.
        runCatching { mr.stop() }
        runCatching { mr.release() }
        return file?.takeIf { it.exists() && it.length() > 1024 }
    }

    fun cancel() {
        val mr = recorder
        recorder = null
        runCatching { mr?.stop() }
        runCatching { mr?.release() }
        target?.delete()
        target = null
    }
}
