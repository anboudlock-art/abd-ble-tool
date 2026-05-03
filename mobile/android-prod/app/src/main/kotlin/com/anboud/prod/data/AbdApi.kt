package com.anboud.prod.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpResponseValidator
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

class ApiException(val statusCode: Int, val code: String, message: String) : RuntimeException(message)

class AbdApi(initialBaseUrl: String) {
    @Volatile var baseUrlValue: String = initialBaseUrl
    @Volatile var tokenValue: String? = null
    private fun baseUrl(): String = baseUrlValue
    private fun token(): String? = tokenValue

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        install(Logging) { level = LogLevel.NONE }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
        HttpResponseValidator {
            handleResponseExceptionWithRequest { _, _ -> /* handled per-call */ }
        }
        expectSuccess = false
    }

    private suspend inline fun <reified T> handle(resp: HttpResponse): T {
        if (resp.status.isSuccess()) return resp.body()
        val text = runCatching { resp.bodyAsText() }.getOrDefault("")
        val parsed: ApiError? = try {
            if (text.isNotBlank()) json.decodeFromString<ApiError>(text) else null
        } catch (_: SerializationException) {
            null
        }
        throw ApiException(
            resp.status.value,
            parsed?.code ?: "HTTP_${resp.status.value}",
            parsed?.message ?: text.ifBlank { resp.status.description },
        )
    }

    suspend fun login(phone: String, password: String): LoginResponse {
        val resp = client.post("${baseUrl()}/api/v1/auth/login") {
            setBody(LoginRequest(phone, password))
        }
        return handle(resp)
    }

    suspend fun listDeviceModels(): DeviceModelsResponse {
        val resp = client.get("${baseUrl()}/api/v1/device-models") {
            token()?.let { bearerAuth(it) }
        }
        return handle(resp)
    }

    suspend fun listBatches(page: Int = 1, pageSize: Int = 50): BatchListResponse {
        val resp = client.get("${baseUrl()}/api/v1/production/batches") {
            token()?.let { bearerAuth(it) }
            parameter("page", page)
            parameter("pageSize", pageSize)
        }
        return handle(resp)
    }

    suspend fun submitScan(req: ProductionScanRequest): ProductionScanResponse {
        val resp = client.post("${baseUrl()}/api/v1/production/scans") {
            token()?.let { bearerAuth(it) }
            setBody(req)
        }
        return handle(resp)
    }

    fun close() = client.close()
}
