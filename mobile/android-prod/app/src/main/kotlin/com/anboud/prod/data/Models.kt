package com.anboud.prod.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val phone: String, val password: String)

@Serializable
data class LoginResponse(val accessToken: String, val user: AuthUser)

@Serializable
data class AuthUser(
    val id: String,
    val name: String,
    val role: String,
    val companyId: String?,
)

@Serializable
data class DeviceModel(
    val id: String,
    val code: String,
    val name: String,
    val category: String,
    val scene: String,
    val hasBle: Boolean,
    val has4g: Boolean,
    val hasGps: Boolean,
    val hasLora: Boolean,
)

@Serializable
data class DeviceModelsResponse(val items: List<DeviceModel>)

@Serializable
data class ProductionBatch(
    val id: String,
    val batchNo: String,
    val modelId: String,
    val modelCode: String?,
    val modelName: String?,
    val quantity: Int,
    val producedCount: Int,
    val scannedCount: Int,
    val createdAt: String,
)

@Serializable
data class BatchListResponse(
    val items: List<ProductionBatch>,
    val total: Int,
    val page: Int,
    val pageSize: Int,
)

@Serializable
data class ProductionScanRequest(
    val batchId: Long,
    val lockId: String,
    val bleMac: String,
    val imei: String? = null,
    val firmwareVersion: String? = null,
    val qcResult: String = "passed",
    val qcRemark: String? = null,
    val durationMs: Int? = null,
)

@Serializable
data class ProductionScanResponse(
    val scanId: String,
    val device: ScannedDevice,
    val firstScan: Boolean,
)

@Serializable
data class ScannedDevice(
    val id: String,
    val lockId: String,
    val bleMac: String,
    val imei: String?,
    val status: String,
    val qcStatus: String,
)

@Serializable
data class ApiError(
    val code: String,
    val message: String,
    @SerialName("details") val details: kotlinx.serialization.json.JsonElement? = null,
)
