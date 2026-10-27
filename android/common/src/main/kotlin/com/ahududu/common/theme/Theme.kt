package com.ahududu.common.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val Kirec = Color(0xFFB3402F) // hata rengi — sıcak kiremit

private val AhududuColors = lightColorScheme(
    primary = Pudra,
    onPrimary = KremKagit,
    primaryContainer = PudraAcik,
    onPrimaryContainer = PudraKoyu,
    secondary = Murdum,
    onSecondary = KremKagit,
    secondaryContainer = MurdumAcik,
    onSecondaryContainer = Murekkep,
    tertiary = KremKoyu,
    onTertiary = Murekkep,
    background = Krem,
    onBackground = Murekkep,
    surface = KremKagit,
    onSurface = Murekkep,
    surfaceVariant = Krem,
    onSurfaceVariant = MurekkepSoluk,
    outline = Cizgi,
    error = Kirec,
)

private val AhududuShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
)

@Composable
fun AhududuTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AhududuColors,
        typography = AhududuTypography,
        shapes = AhududuShapes,
        content = content,
    )
}
