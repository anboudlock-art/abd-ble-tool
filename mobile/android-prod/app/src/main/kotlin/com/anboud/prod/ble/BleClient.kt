package com.anboud.prod.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

/**
 * Minimal BLE wrapper around the protocol implemented by the existing
 * BleLockSdk.kt. We only need:
 *   1. scan for devices whose name starts with "LOCK_"
 *   2. connect, discover services, enable notify on the response char
 *   3. write encrypted command on the request char and await one notify
 *
 * Keep this file pure Android — no DI, no extra libs.
 */
object BleConstants {
    val SERVICE = UUID.fromString("6E40000A-B5A3-F393-E0A9-E50E24DCCA9E")
    val NOTIFY = UUID.fromString("6E40000B-B5A3-F393-E0A9-E50E24DCCA9E")
    val WRITE = UUID.fromString("6E40000C-B5A3-F393-E0A9-E50E24DCCA9E")
    val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val NAME_PREFIX = "LOCK_"
}

data class BleScanItem(
    val name: String,
    val mac: String,
    val rssi: Int,
)

class BleNotConnected : RuntimeException("BLE not connected")
class BleTimeout(msg: String) : RuntimeException(msg)
class BleError(msg: String) : RuntimeException(msg)

class BleClient(private val context: Context) {
    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    val isReady: Boolean get() = adapter?.isEnabled == true

    @SuppressLint("MissingPermission")
    fun scanFlow(): Flow<BleScanItem> = callbackFlow {
        val scanner = adapter?.bluetoothLeScanner ?: run {
            close(); return@callbackFlow
        }
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                emit(result)
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                for (r in results) emit(r)
            }

            override fun onScanFailed(errorCode: Int) {
                close(BleError("BLE scan failed code=$errorCode"))
            }

            private fun emit(r: ScanResult) {
                val name = r.device?.name ?: r.scanRecord?.deviceName ?: return
                if (!name.startsWith(BleConstants.NAME_PREFIX)) return
                trySend(BleScanItem(name = name, mac = r.device.address, rssi = r.rssi))
            }
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        scanner.startScan(null, settings, cb)
        awaitClose { runCatching { scanner.stopScan(cb) } }
    }

    /** Connect, do service discovery, enable notify; returns a session you can write to. */
    @SuppressLint("MissingPermission")
    suspend fun connect(mac: String, timeoutMs: Long = 8_000): BleSession {
        val device = adapter?.getRemoteDevice(mac) ?: throw BleError("No adapter")
        val deferred = CompletableDeferred<BleSession>()
        var session: BleSession? = null

        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    gatt.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    session?.notifyDisconnect()
                    runCatching { gatt.close() }
                    if (!deferred.isCompleted) deferred.completeExceptionally(BleError("Disconnected before ready"))
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                val svc = gatt.getService(BleConstants.SERVICE)
                    ?: return deferred.completeExceptionally(BleError("Service not found"))
                val notifyChar = svc.getCharacteristic(BleConstants.NOTIFY)
                val writeChar = svc.getCharacteristic(BleConstants.WRITE)
                if (notifyChar == null || writeChar == null) {
                    return deferred.completeExceptionally(BleError("Char not found"))
                }
                gatt.setCharacteristicNotification(notifyChar, true)
                val cccd = notifyChar.getDescriptor(BleConstants.CCCD)
                cccd.value = BluetoothGattDescriptorEnableNotify
                gatt.writeDescriptor(cccd)
            }

            override fun onDescriptorWrite(
                gatt: BluetoothGatt,
                desc: android.bluetooth.BluetoothGattDescriptor,
                status: Int,
            ) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    val s = BleSession(gatt)
                    session = s
                    deferred.complete(s)
                } else {
                    deferred.completeExceptionally(BleError("CCCD write failed status=$status"))
                }
            }

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
            ) {
                if (characteristic.uuid == BleConstants.NOTIFY) {
                    @Suppress("DEPRECATION")
                    session?.deliverNotify(characteristic.value ?: ByteArray(0))
                }
            }
        }

        device.connectGatt(context, false, cb)
        return withTimeoutOrNull(timeoutMs) { deferred.await() }
            ?: throw BleTimeout("connect timeout")
    }
}

class BleSession(private val gatt: BluetoothGatt) {
    private var pending: CompletableDeferred<ByteArray>? = null
    private var disconnected = false

    @SuppressLint("MissingPermission")
    suspend fun writeAndAwait(payload: ByteArray, timeoutMs: Long = 4_000): ByteArray {
        if (disconnected) throw BleNotConnected()
        require(payload.size == 16) { "BLE payload must be 16 bytes (AES block)" }
        val svc = gatt.getService(BleConstants.SERVICE) ?: throw BleError("svc missing")
        val ch = svc.getCharacteristic(BleConstants.WRITE) ?: throw BleError("write char missing")
        val deferred = CompletableDeferred<ByteArray>()
        pending = deferred
        ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        @Suppress("DEPRECATION")
        ch.value = payload
        @Suppress("DEPRECATION")
        if (!gatt.writeCharacteristic(ch)) {
            pending = null
            throw BleError("writeCharacteristic returned false")
        }
        return withTimeoutOrNull(timeoutMs) { deferred.await() }
            ?: run {
                pending = null
                throw BleTimeout("notify timeout")
            }
    }

    fun deliverNotify(value: ByteArray) {
        pending?.complete(value)
        pending = null
    }

    fun notifyDisconnect() {
        disconnected = true
        pending?.completeExceptionally(BleNotConnected())
        pending = null
    }

    @SuppressLint("MissingPermission")
    fun close() {
        runCatching { gatt.disconnect() }
        runCatching { gatt.close() }
    }
}

private val BluetoothGattDescriptorEnableNotify: ByteArray =
    byteArrayOf(0x01, 0x00) // ENABLE_NOTIFICATION_VALUE
