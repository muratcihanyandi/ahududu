package com.ahududu.common.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

// Ktor yapılandırması common içinde kapsüllenir; uygulama modülleri Ktor'a doğrudan dokunmaz.
fun createAhududuHttpClient(): HttpClient = HttpClient(CIO) {
    install(ContentNegotiation) {
        json(
            Json {
                ignoreUnknownKeys = true
                isLenient = false
            }
        )
    }
}
