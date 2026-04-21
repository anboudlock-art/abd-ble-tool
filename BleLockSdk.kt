package com.chimpim.blelocksdk

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.chimpim.blelocksdk.HexStringUtils.bytesToHexString
import com.chimpim.blelocksdk.HexStringUtils.hexStringToBytes
import com.inuker.bluetooth.library.BluetoothClient
import com.inuker.bluetooth.library.Code
import com.inuker.bluetooth.library.Constants
import com.inuker.bluetooth.library.connect.listener.BleConnectStatusListener
import com.inuker.bluetooth.library.connect.options.BleConnectOptions
import com.inuker.bluetooth.library.connect.response.BleNotifyResponse
import com.inuker.bluetooth.library.search.SearchRequest
import com.inuker.bluetooth.library.search.SearchResult
import com.inuker.bluetooth.library.search.response.SearchResponse
import java.util.*
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

object BleLockSdk {
    private const val UUID_SERVICE = "6E40000A-B5A3-F393-E0A9-E50E24DCCA9E"
    private const val UUID_NOTIFY = "6E40000B-B5A3-F393-E0A9-E50E24DCCA9E"
    private const val UUID_WRITE = "6E40000C-B5A3-F393-E0A9-E50E24DCCA9E"

    /** 手机->设备 帧头 */
    private const val REQUEST_HEAD = 0x55.toByte()

    /** 手机<-手机 帧头*/
    private const val RESPONSE_HEAD = 0xAA.toByte()

    /** 密文帧头 */
    private const val CIPHERTEXT_HEAD = 0xFB.toByte()

    /** 密文填充 */
    private const val CIPHERTEXT_FILL = 0xFC.toByte()
    // ==============================================
    /** 时间设置指令 */
    const val CMD_SET_TIME = 0x10.toByte()

    /** 密码验证指令 */
    const val CMD_AUTH_PASSWD = 0x20.toByte()

    /** 密码设置指令 */
    const val CMD_SET_AUTH_PASSWD = 0x21.toByte()

    /** 开关锁指令 */
    const val CMD_OPEN_LOCK = 0x30.toByte()
    const val CMD_CLOSE_LOCK = 0x31.toByte()

    /** 状态查询指令 */
    const val CMD_GET_STATUS = 0x40.toByte()

    /** 强制休眠指令 */
    const val CMD_FORCE_SLEEP = 0x50.toByte()
    // ==============================================
    /** 正常休眠 */
    const val SLEEP_MODE_NORMAL = 0x01.toByte()

    /** 立刻休眠 */
    const val SLEEP_MODE_ATONCE = 0x02.toByte()

    /** 成功 */
    const val RESULT_SUCCESS = 0x00.toByte()

    /** 识别 */
    const val RESULT_FAILURE = 0x01.toByte()

    /** 上锁的、关闭的 */
    const val STATUS_CLOSED = 0x00.toByte()

    /** 未上锁的、打开的 */
    const val STATUS_OPENED = 0x01.toByte()


    private val SERVICE_UUID = UUID.fromString(UUID_SERVICE)
    private val NOTIFY_UUID = UUID.fromString(UUID_NOTIFY)
    private val WRITE_UUID = UUID.fromString(UUID_WRITE)

    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var client: BluetoothClient


    @JvmStatic
    fun setup(context: Context) {
        client = BluetoothClient(context.applicationContext)
    }

    @JvmStatic
    fun getKey1(mac: String): ByteArray {
        val macBytes = hexStringToBytes(mac.replace(":", ""))
        val key1 = ByteArray(16)
        System.arraycopy(macBytes, 0, key1, 0, 6)
        for (i in 0..9) {
            key1[i + 6] = (0x11 * (i + 1)).toByte()
        }
        return key1
    }

    @JvmStatic
    fun getKey2(key1: ByteArray, time: Date): ByteArray {
        val key2 = key1.copyOf()
        val c = Calendar.getInstance()
        c.time = time
        val year = (c.get(Calendar.YEAR) - 2000).toByte()
        val month = (c.get(Calendar.MONTH) + 1).toByte()
        val day = c.get(Calendar.DAY_OF_MONTH).toByte()
        val hour = c.get(Calendar.HOUR_OF_DAY).toByte()
        val minute = c.get(Calendar.MINUTE).toByte()
        val second = c.get(Calendar.SECOND).toByte()
        key2[key1.size - 1] = second
        key2[key1.size - 2] = minute
        key2[key1.size - 3] = hour
        key2[key1.size - 4] = day
        key2[key1.size - 5] = month
        key2[key1.size - 6] = year
        return key2
    }

    // ===================== Scan
    @JvmStatic
    fun startScan(timeout: Int, callback: ScanCallback) {
        val request = SearchRequest.Builder()
            .searchBluetoothLeDevice(timeout, 1)   // 先扫BLE设备3次，每次3s
            .build()
        client.search(request, object : SearchResponse {
            override fun onSearchStarted() {
            }

            override fun onSearchStopped() {
                callback.onStopScan()
            }

            override fun onDeviceFounded(device: SearchResult?) {
                device ?: return
                log("onDeviceFounded# device: ${device.name} - ${device.address}")
                if (!device.name.startsWith("LOCK_")) return
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    callback.onLeScan(device.device, device.rssi, device.scanRecord)
                } else {
                    mainHandler.post {
                        callback.onLeScan(device.device, device.rssi, device.scanRecord)
                    }
                }
            }

            override fun onSearchCanceled() {
                callback.onStopScan()
            }
        })
    }

    @JvmStatic
    fun stopScan() {
        client.stopSearch()
    }
    // ===================== Connect

    @JvmStatic
    fun connect(mac: String, listener: ConnectListener, notifyCallback: NotifyCallback = {}) {
        val options = BleConnectOptions.Builder()
            .setConnectRetry(2)   // 连接如果失败重试2次
            .setConnectTimeout(8000)   // 连接超时8s
            .setServiceDiscoverRetry(3)  // 发现服务如果失败重试3次
            .setServiceDiscoverTimeout(5000)  // 发现服务超时5s
            .build()
        client.connect(mac, options) { connectCode, _ ->
            if (connectCode == Constants.REQUEST_SUCCESS) {
                client.notify(mac, SERVICE_UUID, NOTIFY_UUID, object : BleNotifyResponse {
                    override fun onNotify(service: UUID?, character: UUID?, value: ByteArray?) {
                        value ?: return
                        log("onNotify# ${bytesToHexString(value)}")
                        notifyCallback(value)
                    }

                    override fun onResponse(code: Int) {
                        if (code == Constants.REQUEST_SUCCESS) {
                            // 打开Notify成功
                            log("$mac 打开Notify成功")
                            // 注册连接状态监听
                            client.registerConnectStatusListener(mac, object :
                                BleConnectStatusListener() {
                                override fun onConnectStatusChanged(mac: String, status: Int) {
                                    if (status == Constants.STATUS_DISCONNECTED) {
                                        listener.onDisconnect(mac)
                                        client.unregisterConnectStatusListener(mac, this)
                                    }
                                }
                            })
                            listener.onConnected(mac)
                        } else {
                            // 打开Notify失败
                            log("$mac 打开Notify失败")
                            listener.onConnectFailed(mac, "打开Notify失败")
                            disconnect(mac)
                        }
                    }

                })
            } else {
                listener.onConnectFailed(mac, "连接失败，代码：$connectCode")
            }
        }
    }

    @JvmStatic
    fun disconnect(mac: String) {
        client.disconnect(mac)
    }

    // ===================== Request
    @JvmStatic
    fun sendRequest(
        mac: String, key: ByteArray, request: ByteArray,
        resultReceiver: ResultReceiver = { _, _ -> }
    ): ByteArray {
        // 计算校验码
        request[request.size - 1] = ProtoUtil.checkCode(request)
        // 加密数据
        val encryptedRequest = ProtoUtil.encryptRequest(key, request)
        log("sendRequest# 原始请求: ${bytesToHexString(request)}")
        log("sendRequest# 加密Key: ${bytesToHexString(key)}")
        log("sendRequest# 加密请求: ${bytesToHexString(encryptedRequest)}")
        client.write(mac, SERVICE_UUID, WRITE_UUID, encryptedRequest) {
            resultReceiver(it == Constants.REQUEST_SUCCESS, Code.toString(it))
        }
        return encryptedRequest
    }


    @Suppress("ObjectPropertyName")
    @Volatile
    private var _cmdId = 0x01.toByte()
    private val cmdId: Byte
        get() {
            if (_cmdId > 0xFF) _cmdId = 0x00
            return ++_cmdId
        }

    @JvmStatic
    fun setTimeRequest(time: Date): ByteArray {
        val c = Calendar.getInstance()
        c.time = time
        val year = (c.get(Calendar.YEAR) - 2000).toByte()
        val month = (c.get(Calendar.MONTH) + 1).toByte()
        val day = c.get(Calendar.DAY_OF_MONTH).toByte()
        val hour = c.get(Calendar.HOUR_OF_DAY).toByte()
        val minute = c.get(Calendar.MINUTE).toByte()
        val second = c.get(Calendar.SECOND).toByte()
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_SET_TIME,
            year, month, day, hour, minute, second,
            0x00
        )
    }

    @JvmStatic
    fun authPasswdRequest(passwd: Int): ByteArray {
        require(passwd in 0..999_999) { "密码范围错误" }
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_AUTH_PASSWD,
            (passwd / 1_00000 % 10).toByte(),
            (passwd / 1_0000 % 10).toByte(),
            (passwd / 1_000 % 10).toByte(),
            (passwd / 1_00 % 10).toByte(),
            (passwd / 1_0 % 10).toByte(),
            (passwd / 1 % 10).toByte(),
            0x00
        )
    }

    @JvmStatic
    fun setAuthPasswdRequest(passwd: Int): ByteArray {
        require(passwd in 0..999_999) { "密码范围错误" }
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_SET_AUTH_PASSWD,
            (passwd / 1_00000 % 10).toByte(),
            (passwd / 1_0000 % 10).toByte(),
            (passwd / 1_000 % 10).toByte(),
            (passwd / 1_00 % 10).toByte(),
            (passwd / 1_0 % 10).toByte(),
            (passwd / 1 % 10).toByte(),
            0x00
        )
    }

    @JvmStatic
    fun openLockRequest(sleepMode: Byte): ByteArray {
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_OPEN_LOCK,
            sleepMode,
            0x00
        )
    }

    @JvmStatic
    fun closeLockRequest(sleepMode: Byte): ByteArray {
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_CLOSE_LOCK,
            sleepMode,
            0x00
        )
    }

    @JvmStatic
    fun getStatusRequest(sleepMode: Byte): ByteArray {
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_GET_STATUS,
            sleepMode,
            0x00
        )
    }

    @JvmStatic
    fun forceSleepRequest(): ByteArray {
        return byteArrayOf(
            REQUEST_HEAD, cmdId, CMD_FORCE_SLEEP,
            0x00
        )
    }

    // ===================== Response
    @JvmStatic
    fun obtionResponse(key: ByteArray, encryptedResponse: ByteArray): Response {
        log("obtionResponse# 加密响应: ${bytesToHexString(encryptedResponse)}")
        log("obtionResponse# 解密Key: ${bytesToHexString(key)}")
        val data = try {
            ProtoUtil.decryptResponse(key, encryptedResponse).also {
                log("obtionResponse# 解密响应: ${bytesToHexString(it)}")
            }
        } catch (e: Exception) {
            log("obtionResponse# 解密响应失败: ${e.message}")
            return Response(success = false, error = "数据解密异常，${e.message}")
        }
        if (data.size < 3) {
            return Response(success = false, error = "响应数据长度不足")
        }
        if (data[0] != RESPONSE_HEAD) {
            return Response(success = false, error = "响应帧头错误")
        }
        if (ProtoUtil.checkCode(data) != data[data.size - 1]) {
            return Response(success = false, error = "响应校验码错误")
        }
        val cmdId = data[1]
        val cmd = data[2]
        val len = data.size - 4
        val payload = if (len > 0) {
            val bytes = ByteArray(len)
            System.arraycopy(data, 3, bytes, 0, bytes.size)
            bytes
        } else {
            EMPTY_BYTES
        }
        return Response(success = true, data = data, cmdId = cmdId, cmd = cmd, payload = payload)
    }

    class Response internal constructor(
        val success: Boolean = true,
        val error: String = "",
        val data: ByteArray = EMPTY_BYTES,
        val cmdId: Byte = 0x00,
        val cmd: Byte = 0x00,
        val payload: ByteArray = EMPTY_BYTES
    ) {
        /** 验证密码结果 */
        val authPasswdResult: Byte?
            get() = if (cmd == CMD_AUTH_PASSWD && payload.size == 1) {
                if (payload[0] == 0x00.toByte()) RESULT_SUCCESS else RESULT_FAILURE
            } else {
                null
            }

        /** 设置密码结果 */
        val setAuthPasswdResult: Byte?
            get() = if (cmd == CMD_SET_AUTH_PASSWD && payload.size == 1) {
                if (payload[0] == 0x00.toByte()) RESULT_SUCCESS else RESULT_FAILURE
            } else {
                null
            }

        /** 开锁结果 */
        val openLockResult: Byte?
            get() = if (cmd == CMD_OPEN_LOCK && payload.size == 4) {
                if (payload[0] == 0x00.toByte()) RESULT_SUCCESS else RESULT_FAILURE
            } else {
                null
            }

        /** 关锁结果 */
        val closeLockResult: Byte?
            get() = if (cmd == CMD_CLOSE_LOCK && payload.size == 4) {
                if (payload[0] == 0x00.toByte()) RESULT_SUCCESS else RESULT_FAILURE
            } else {
                null
            }

        /** 电量 */
        val battery: Int?
            get() = if ((cmd == CMD_OPEN_LOCK || cmd == CMD_CLOSE_LOCK) && payload.size == 4) {
                payload[1].toInt() and 0xFF
            } else if (cmd == CMD_GET_STATUS || cmd == CMD_FORCE_SLEEP && payload.size == 3) {
                payload[0].toInt() and 0xFF
            } else {
                null
            }

        /** 锁杆状态 */
        val lockStatus: Byte?
            get() = if ((cmd == CMD_OPEN_LOCK || cmd == CMD_CLOSE_LOCK) && payload.size == 4) {
                if (payload[2] == 0x00.toByte()) STATUS_CLOSED else STATUS_OPENED
            } else if (cmd == CMD_GET_STATUS || cmd == CMD_FORCE_SLEEP && payload.size == 3) {
                if (payload[1] == 0x00.toByte()) STATUS_CLOSED else STATUS_OPENED
            } else {
                null
            }


        /** 电池盒状态 */
        val batteryBoxStatus: Byte?
            get() = if ((cmd == CMD_OPEN_LOCK || cmd == CMD_CLOSE_LOCK) && payload.size == 4) {
                if (payload[3] == 0x00.toByte()) STATUS_CLOSED else STATUS_OPENED
            } else if (cmd == CMD_GET_STATUS || cmd == CMD_FORCE_SLEEP && payload.size == 3) {
                if (payload[2] == 0x00.toByte()) STATUS_CLOSED else STATUS_OPENED
            } else {
                null
            }

        override fun toString(): String {
            return "success=$success, data=${bytesToHexString(data)}, payload=${
                bytesToHexString(
                    payload
                )
            }"
        }
    }


    interface ConnectListener {
        fun onConnected(mac: String)
        fun onConnectFailed(mac: String, message: String)
        fun onDisconnect(mac: String)
    }

    interface ScanCallback {
        fun onLeScan(device: BluetoothDevice, rssi: Int, scanRecord: ByteArray?)
        fun onStopScan()
    }


    //加密/解密
    private object ProtoUtil {
        fun checkCode(protoData: ByteArray) = checkSum(protoData, 1, protoData.size - 2)

        @Throws(Exception::class)
        fun encryptRequest(key: ByteArray, request: ByteArray): ByteArray {
            require(key.size == 16) { "key.size != 16" }
            require(request.size <= 14) { "request.length > 14" }
            val data = ByteArray(16)
            Arrays.fill(data, CIPHERTEXT_FILL)
            data[0] = CIPHERTEXT_HEAD
            data[1] = request.size.toByte()
            System.arraycopy(request, 0, data, 2, request.size)
            return aes128Encrypt(key, data)
        }

        @Throws(Exception::class)
        fun decryptResponse(key: ByteArray, encryptedResponse: ByteArray): ByteArray {
            require(key.size == 16) { "key.size != 16" }
            require(encryptedResponse.size == 16) { "encryptedData.size != 16" }
            val data = aes128Decrypt(key, encryptedResponse)
            check(data.size == 16) { "解密数据长度错误, ${data.size}" }
            check(data[0] == CIPHERTEXT_HEAD) { String.format("帧头错误,%X", data[0]) }
            val len = data[1].toInt() and 0xFF
            check(len > 0) { "解密数据错误" }
            val rawResponse = ByteArray(len)
            System.arraycopy(data, 2, rawResponse, 0, len)
            return rawResponse
        }
    }

    private const val TAG = "BleLockSdk"

    internal fun log(message: String) = Log.d(TAG, message)

    internal val EMPTY_BYTES = ByteArray(0)

    internal fun checkSum(src: ByteArray, start: Int, len: Int): Byte {
        var checkSum = 0
        for (i in start until (start + len)) {
            checkSum += src[i]
        }
        return checkSum.toByte()
    }

    @SuppressLint("GetInstance")
    @Throws(Exception::class)
    internal fun aes128Encrypt(key: ByteArray, data: ByteArray): ByteArray {
        require(key.size == 16) { "key.size != 16" }
        require(data.size == 16) { "data.size != 16" }
        val sKeySpec = SecretKeySpec(key, "AES")
        val cipher = Cipher.getInstance("AES/ECB/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, sKeySpec)
        return cipher.doFinal(data)
    }

    @SuppressLint("GetInstance")
    @Throws(Exception::class)
    internal fun aes128Decrypt(key: ByteArray, encrypted: ByteArray): ByteArray {
        require(key.size == 16) { "key.size != 16" }
        require(encrypted.size == 16) { "encrypted.size != 16" }
        val sKeySpec = SecretKeySpec(key, "AES")
        val cipher = Cipher.getInstance("AES/ECB/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, sKeySpec)
        return cipher.doFinal(encrypted)
    }

}