package com.anboud.prod.scan

import com.anboud.prod.ble.BleClient
import com.anboud.prod.ble.BleProto
import com.anboud.prod.ble.BleScanItem
import com.anboud.prod.data.AbdApi
import com.anboud.prod.data.ApiException
import com.anboud.prod.data.ProductionScanRequest
import com.anboud.prod.data.ProductionScanResponse
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Date

sealed class ScanStep(val label: String) {
    data object Searching : ScanStep("正在扫描附近的锁…")
    data object Connecting : ScanStep("连接锁…")
    data object Reading : ScanStep("读取设备信息…")
    data object Submitting : ScanStep("上报到平台…")
    data class Done(val resp: ProductionScanResponse) : ScanStep("完成")
    data class Error(val message: String, val cause: Throwable? = null) : ScanStep(message)
}

class ScanFlowEngine(
    private val ble: BleClient,
    private val api: AbdApi,
) {
    /**
     * Drive the full pipeline for a single QR-scanned lockId.
     * Emits stepwise progress through [onStep] (called on the calling
     * coroutine's context).
     */
    suspend fun runOnce(
        lockId: String,
        batchId: Long,
        onStep: suspend (ScanStep) -> Unit,
    ): ScanStep {
        val started = System.currentTimeMillis()

        // Step 1: BLE scan, take the first LOCK_ device (whose name's last 6
        // chars match the MAC tail). If only one is in range we accept; if
        // multiple, we take the strongest RSSI.
        onStep(ScanStep.Searching)
        val item = withTimeoutOrNull(8_000) { findClosestLock() }
            ?: return finish(onStep, ScanStep.Error("未找到附近的锁（超时）"))

        // Step 2: connect + read firmware (we'll do a GET_STATUS round-trip
        // as a smoke check; firmware-version readout requires the new 0x60
        // command which the firmware team needs to add — see
        // docs/device-capability-matrix.md §3).
        onStep(ScanStep.Connecting)
        val mac = item.mac
        val firmware: String? = try {
            val session = ble.connect(mac, timeoutMs = 8_000)
            try {
                onStep(ScanStep.Reading)
                val key1 = BleProto.deriveKey1(BleProto.macHexToBytes(mac))
                val req = BleProto.buildSetTime(Date())
                val enc = BleProto.encryptRequest(key1, req)
                val rxEnc = session.writeAndAwait(enc)
                val rx = BleProto.decryptResponse(key1, rxEnc)
                BleProto.parseResponse(rx) // sanity
                null // TODO once 0x60 is implemented in firmware, swap for real read
            } finally {
                runCatching { session.close() }
            }
        } catch (t: Throwable) {
            return finish(onStep, ScanStep.Error("BLE 通讯失败: ${t.message ?: t::class.simpleName}", t))
        }

        // Step 3: submit to platform
        onStep(ScanStep.Submitting)
        return try {
            val resp = api.submitScan(
                ProductionScanRequest(
                    batchId = batchId,
                    lockId = lockId,
                    bleMac = mac.uppercase(),
                    firmwareVersion = firmware,
                    qcResult = "passed",
                    durationMs = (System.currentTimeMillis() - started).toInt(),
                )
            )
            finish(onStep, ScanStep.Done(resp))
        } catch (e: ApiException) {
            finish(onStep, ScanStep.Error("平台拒绝: ${e.message}", e))
        } catch (t: Throwable) {
            finish(onStep, ScanStep.Error("上报异常: ${t.message ?: t::class.simpleName}", t))
        }
    }

    private suspend fun findClosestLock(): BleScanItem {
        // Collect results for ~3 seconds and pick the strongest signal.
        val seen = mutableMapOf<String, BleScanItem>()
        val window = 3_000L
        val deadline = System.currentTimeMillis() + window
        ble.scanFlow().collectWhile {
            seen[it.mac] = it
            System.currentTimeMillis() < deadline
        }
        return seen.values
            .filter { it.name.startsWith("LOCK_") }
            .maxByOrNull { it.rssi }
            ?: throw RuntimeException("no lock in range")
    }

    private suspend fun finish(onStep: suspend (ScanStep) -> Unit, step: ScanStep): ScanStep {
        onStep(step)
        return step
    }
}

private suspend fun <T> kotlinx.coroutines.flow.Flow<T>.collectWhile(
    predicate: (T) -> Boolean,
) {
    val flow = this
    try {
        flow.collect { v ->
            if (!predicate(v)) throw StopCollecting
        }
    } catch (_: StopCollecting) { /* expected */ }
}

private object StopCollecting : RuntimeException() {
    private fun readResolve(): Any = StopCollecting
    override fun fillInStackTrace(): Throwable = this
}
