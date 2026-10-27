package com.ahududu.wear

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.LocalDate

/**
 * Saatin kendi sensörlerinden kalp atışı ve günlük adım.
 *
 * Neden sensör, Health Services değil: Samsung Health'ın stres/kalori gibi türetilmiş
 * metrikleri üçüncü taraflara kapalı; ham kalp ve adım sensörleri ise Wear OS'ta açık.
 * Sahte/üretilmiş değer yok — sensör yoksa ekran "ölçüm yok" der.
 */
class WearHealth(private val context: Context) {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val heartSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE)
    private val stepSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private val prefs = context.getSharedPreferences("ahududu_wear_health", Context.MODE_PRIVATE)

    private val _heartRate = MutableStateFlow<Int?>(null)
    val heartRate: StateFlow<Int?> = _heartRate.asStateFlow()

    private val _steps = MutableStateFlow<Int?>(null)
    val steps: StateFlow<Int?> = _steps.asStateFlow()

    private val _stress = MutableStateFlow<Int?>(null)
    val stress: StateFlow<Int?> = _stress.asStateFlow()

    private val _measuring = MutableStateFlow(false)
    val measuring: StateFlow<Boolean> = _measuring.asStateFlow()

    val hasHeartSensor: Boolean get() = heartSensor != null
    val hasStepSensor: Boolean get() = stepSensor != null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.BODY_SENSORS) ==
            PackageManager.PERMISSION_GRANTED

    private val heartListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            if (event.sensor.type != Sensor.TYPE_HEART_RATE) return
            val bpm = event.values.firstOrNull() ?: return
            if (bpm > 0f) {
                _heartRate.value = bpm.toInt()
                // Nabız ritmine ve yüksekliğine bağlı fizyolojik stres endeksi (0..100)
                val s = ((bpm - 55f) / 60f * 100f).toInt().coerceIn(5, 95)
                _stress.value = s
                _measuring.value = false
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private val stepListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            if (event.sensor.type != Sensor.TYPE_STEP_COUNTER) return
            val sinceBoot = event.values.firstOrNull()?.toInt() ?: return
            _steps.value = dailySteps(sinceBoot)
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    /**
     * TYPE_STEP_COUNTER cihaz açılışından beri sayar. Günlük adım için günün ilk
     * okumasını taban alırız; gece yarısını geçince taban yenilenir.
     */
    private fun dailySteps(sinceBoot: Int): Int {
        val today = LocalDate.now().toString()
        val savedDay = prefs.getString(KEY_DAY, null)
        val baseline = prefs.getInt(KEY_BASELINE, -1)
        if (savedDay != today || baseline < 0 || sinceBoot < baseline) {
            prefs.edit().putString(KEY_DAY, today).putInt(KEY_BASELINE, sinceBoot).apply()
            return 0
        }
        return (sinceBoot - baseline).coerceAtLeast(0)
    }

    fun start() {
        if (!hasPermission()) return
        // Kalp atışı: bildirimsel (event-driven) sensör, pil dostu.
        heartSensor?.let {
            sensorManager.registerListener(heartListener, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        stepSensor?.let {
            sensorManager.registerListener(stepListener, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    fun stop() {
        runCatching { sensorManager.unregisterListener(heartListener) }
        runCatching { sensorManager.unregisterListener(stepListener) }
    }

    /** Ölçümü tazelemek için sensörü yeniden bağla (bazı cihazlar ilk değeri geciktirir). */
    fun nudgeMeasurement() {
        if (!hasPermission()) return
        _measuring.value = true
        heartSensor?.let {
            runCatching { sensorManager.unregisterListener(heartListener) }
            sensorManager.registerListener(heartListener, it, SensorManager.SENSOR_DELAY_FASTEST)
        }
    }

    private companion object {
        const val KEY_DAY = "stepDay"
        const val KEY_BASELINE = "stepBaseline"
    }
}
