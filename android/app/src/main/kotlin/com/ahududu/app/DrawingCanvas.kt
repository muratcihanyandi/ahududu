package com.ahududu.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.ahududu.common.api.StrokeDto

/**
 * S Pen / parmak çizim tuvali.
 *
 * - Basınç duyarlı: pointer.pressure 0..1 aralığında kalınlığı ölçekler (S Pen basınç destekli).
 * - Vektörel model: her çizgi = StrokeDto(tool, color, width, points[x,y,pressure]).
 *   Raster'e çevrilmez → orijinal kalite korunur, yeniden düzenlenebilir.
 * - Geri al / yinele, silgi, renk ve kalınlık.
 * - Noktalar 0..1000 normalize koordinatta saklanır (cihazdan bağımsız).
 */
@Composable
fun DrawingCanvas(
    strokes: MutableList<StrokeDto>,
    onStrokesChanged: () -> Unit,
    paperStyle: String,
    modifier: Modifier = Modifier,
) {
    var current by remember { mutableStateOf<StrokeDto?>(null) }
    var tool by remember { mutableStateOf("pen") }
    var strokeColor by remember { mutableStateOf(Color(0xFF3E2B31)) }
    var strokeWidth by remember { mutableStateOf(3.5f) }

    val redoStack = remember { mutableStateListOf<StrokeDto>() }
    val pressureEnabled = remember { mutableStateOf(true) }

    Column(modifier.fillMaxSize()) {
        // Araç çubuğu
        Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ToolChip("Kalem", tool == "pen") { tool = "pen" }
                    ToolChip("Fosforlu", tool == "highlighter") { tool = "highlighter" }
                    ToolChip("Silgi", tool == "eraser") { tool = "eraser" }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    PenColor(Color(0xFF3E2B31)) { strokeColor = it; if (tool == "eraser") tool = "pen" }
                    PenColor(Color(0xFFC4536B)) { strokeColor = it; if (tool == "eraser") tool = "pen" }
                    PenColor(Color(0xFF8E4A66)) { strokeColor = it; if (tool == "eraser") tool = "pen" }
                    PenColor(Color(0xFF4A6FA5)) { strokeColor = it; if (tool == "eraser") tool = "pen" }
                    PenColor(Color(0xFF6B8E5A)) { strokeColor = it; if (tool == "eraser") tool = "pen" }
                    Spacer(Modifier.width(8.dp))
                    ToolChip("İnce", strokeWidth == 2f) { strokeWidth = 2f }
                    ToolChip("Orta", strokeWidth == 3.5f) { strokeWidth = 3.5f }
                    ToolChip("Kalın", strokeWidth == 6f) { strokeWidth = 6f }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                    ToolChip("Geri al", false) {
                        if (strokes.isNotEmpty()) {
                            redoStack.add(strokes.removeAt(strokes.lastIndex))
                            onStrokesChanged()
                        }
                    }
                    ToolChip("Yinele", false) {
                        if (redoStack.isNotEmpty()) {
                            strokes.add(redoStack.removeAt(redoStack.lastIndex))
                            onStrokesChanged()
                        }
                    }
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "${strokes.size} çizgi",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        // Çizim alanı — kâğıt
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(paperColor(paperStyle))
                .pointerInput(tool, strokeColor, strokeWidth) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            val normalized = normalize(offset, size.width.toFloat(), size.height.toFloat())
                            current = StrokeDto(
                                tool = tool,
                                color = if (tool == "eraser") "#000000" else hex(strokeColor),
                                width = if (tool == "eraser") 26f else strokeWidth,
                                points = mutableListOf(
                                    listOf(normalized.x, normalized.y, 1f),
                                ),
                            )
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            val s = current ?: return@detectDragGestures
                            val p = normalize(change.position, size.width.toFloat(), size.height.toFloat())
                            val last = s.points.lastOrNull()
                            // Aşırı sık nokta kaydetme: 1.5 birimden yakın noktaları atla (dosya boyutu).
                            val farEnough = last == null ||
                                kotlin.math.hypot(p.x - last[0], p.y - last[1]) > 1.5f
                            if (farEnough) {
                                val newPoints = s.points + listOf(
                                    listOf(p.x, p.y, if (pressureEnabled.value) change.pressure else 1f),
                                )
                                current = s.copy(points = newPoints)
                            }
                        },
                        onDragEnd = {
                            current?.let {
                                if (it.points.isNotEmpty()) {
                                    strokes.add(it)
                                    redoStack.clear()
                                    onStrokesChanged()
                                }
                            }
                            current = null
                        },                        onDragCancel = { current = null },
                    )
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                // Kâğıt çizgileri
                when (paperStyle) {
                    "lined" -> {
                        val gap = size.height / 22f
                        var y = gap
                        while (y < size.height) {
                            drawLine(
                                color = Color(0x228E7A82),
                                start = Offset(0f, y),
                                end = Offset(size.width, y),
                                strokeWidth = 1f,
                            )
                            y += gap
                        }
                    }
                    "dotted" -> {
                        val gap = size.height / 26f
                        var y = gap
                        while (y < size.height) {
                            var x = 12f
                            while (x < size.width) {
                                drawCircle(Color(0x338E7A82), radius = 1.2f, center = Offset(x, y))
                                x += 22f
                            }
                            y += gap
                        }
                    }
                    "grid" -> {
                        val gap = size.height / 22f
                        var y = gap
                        while (y < size.height) {
                            drawLine(Color(0x1A8E7A82), Offset(0f, y), Offset(size.width, y), 1f)
                            y += gap
                        }
                        var x = gap
                        while (x < size.width) {
                            drawLine(Color(0x1A8E7A82), Offset(x, 0f), Offset(x, size.height), 1f)
                            x += gap
                        }
                    }
                }

                // Kaydedilmiş + aktif çizimler
                val all = if (current != null) strokes + current!! else strokes.toList()
                for (s in all) {
                    drawStroke(s, size.width, size.height)
                }
            }
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawStroke(
    stroke: StrokeDto,
    width: Float,
    height: Float,
) {
    if (stroke.points.isEmpty()) return
    val color = parseColor(stroke.color)
    val isEraser = stroke.tool == "eraser"
    val path = Path()
    var prevPressure = stroke.points[0].getOrElse(2) { 1f }
    val first = stroke.points[0]
    path.moveTo(first[0] / 1000f * width, first[1] / 1000f * height)
    for (i in 1 until stroke.points.size) {
        val p = stroke.points[i]
        path.lineTo(p[0] / 1000f * width, p[1] / 1000f * height)
        prevPressure = p.getOrElse(2) { prevPressure }
    }
    val pressureScale = if (isEraser) 1f else (0.55f + 0.75f * prevPressure.coerceIn(0f, 1f))
    val strokeWidthPx = stroke.width * pressureScale * (density / 2.5f).coerceAtLeast(0.8f)
    drawPath(
        path = path,
        color = if (isEraser) Color(0xFFFDF8F3) else color.copy(alpha = if (stroke.tool == "highlighter") 0.35f else 1f),
        style = Stroke(width = strokeWidthPx, cap = StrokeCap.Round, join = StrokeJoin.Round),
    )
}

private fun normalize(offset: Offset, width: Float, height: Float): Offset =
    Offset(
        (offset.x / width * 1000f).coerceIn(0f, 1000f),
        (offset.y / height * 1000f).coerceIn(0f, 1000f),
    )

private fun hex(color: Color): String {
    val argb = color.toArgb()
    return "#%06X".format(argb and 0xFFFFFF)
}

private fun parseColor(hex: String): Color = runCatching {
    Color(android.graphics.Color.parseColor(hex))
}.getOrElse { Color(0xFF3E2B31) }

private fun paperColor(style: String): Color = when (style) {
    "lined" -> Color(0xFFFFFEFA)
    "minimal" -> Color(0xFFFAF6EF)
    "ozelgun" -> Color(0xFFFDEEF2)
    else -> Color(0xFFFDF8F3)
}

@Composable
private fun ToolChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(Modifier.padding(end = 6.dp)) {
        FilterChip(
            selected = selected,
            onClick = onClick,
            label = { Text(label, style = MaterialTheme.typography.bodyMedium) },
        )
    }
}

@Composable
private fun PenColor(color: Color, onClick: (Color) -> Unit) {
    Box(
        Modifier
            .padding(end = 10.dp)
            .size(26.dp)
            .background(color, CircleShape)
            .pointerInput(Unit) {
                detectDragGestures(onDragStart = { onClick(color) }, onDrag = { _, _ -> })
            }
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        if (event.type == androidx.compose.ui.input.pointer.PointerEventType.Press) {
                            onClick(color)
                        }
                    }
                }
            },
    )
}
