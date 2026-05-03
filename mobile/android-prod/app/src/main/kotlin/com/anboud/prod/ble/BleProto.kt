package com.anboud.prod.ble

import java.util.Calendar
import java.util.Date
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/**
 * Pure-Kotlin port of the protocol implemented by /BleLockSdk.kt.
 * Frame format (plaintext):
 *   request:  0x55 cmdId cmd ...params bcc
 *   response: 0xAA cmdId cmd ...resp   bcc
 * Encryption: AES-128 ECB NoPadding on a 16-byte block:
 *   [0xFB, len, ...rawFrame, 0xFC ... 0xFC]
 */
object BleProto {
    const val REQ_HEAD: Byte = 0x55.toByte()
    const val RESP_HEAD: Byte = 0xAA.toByte()
    const val CIPHER_HEAD: Byte = 0xFB.toByte()
    const val CIPHER_FILL: Byte = 0xFC.toByte()

    const val CMD_SET_TIME: Byte = 0x10.toByte()
    const val CMD_AUTH_PASSWD: Byte = 0x20.toByte()
    const val CMD_SET_AUTH_PASSWD: Byte = 0x21.toByte()
    const val CMD_OPEN_LOCK: Byte = 0x30.toByte()
    const val CMD_CLOSE_LOCK: Byte = 0x31.toByte()
    const val CMD_GET_STATUS: Byte = 0x40.toByte()
    const val CMD_FORCE_SLEEP: Byte = 0x50.toByte()

    fun macHexToBytes(mac: String): ByteArray {
        val hex = mac.replace(":", "").replace("-", "")
        require(hex.length == 12) { "MAC must be 12 hex chars" }
        return ByteArray(6) { i ->
            hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    fun deriveKey1(mac: ByteArray): ByteArray {
        require(mac.size == 6)
        val k = ByteArray(16)
        System.arraycopy(mac, 0, k, 0, 6)
        for (i in 0..9) k[6 + i] = (0x11 * (i + 1)).toByte()
        return k
    }

    fun deriveKey2(key1: ByteArray, t: Date): ByteArray {
        val k = key1.copyOf()
        val c = Calendar.getInstance()
        c.time = t
        k[10] = (c.get(Calendar.YEAR) - 2000).toByte()
        k[11] = (c.get(Calendar.MONTH) + 1).toByte()
        k[12] = c.get(Calendar.DAY_OF_MONTH).toByte()
        k[13] = c.get(Calendar.HOUR_OF_DAY).toByte()
        k[14] = c.get(Calendar.MINUTE).toByte()
        k[15] = c.get(Calendar.SECOND).toByte()
        return k
    }

    private fun checksum(buf: ByteArray, start: Int, len: Int): Byte {
        var sum = 0
        for (i in start until start + len) sum = (sum + buf[i].toInt()) and 0xFF
        return sum.toByte()
    }

    private fun pack16(raw: ByteArray): ByteArray {
        require(raw.size in 1..14)
        val out = ByteArray(16) { CIPHER_FILL }
        out[0] = CIPHER_HEAD
        out[1] = raw.size.toByte()
        System.arraycopy(raw, 0, out, 2, raw.size)
        return out
    }

    private fun unpack16(block: ByteArray): ByteArray {
        require(block.size == 16)
        require(block[0] == CIPHER_HEAD) { "bad cipher head" }
        val len = block[1].toInt() and 0xFF
        require(len in 1..14) { "bad raw length $len" }
        return block.copyOfRange(2, 2 + len)
    }

    fun aesEncrypt(key: ByteArray, block: ByteArray): ByteArray {
        require(key.size == 16 && block.size == 16)
        val c = Cipher.getInstance("AES/ECB/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        return c.doFinal(block)
    }

    fun aesDecrypt(key: ByteArray, block: ByteArray): ByteArray {
        require(key.size == 16 && block.size == 16)
        val c = Cipher.getInstance("AES/ECB/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"))
        return c.doFinal(block)
    }

    fun encryptRequest(key: ByteArray, raw: ByteArray): ByteArray =
        aesEncrypt(key, pack16(raw))

    fun decryptResponse(key: ByteArray, encrypted: ByteArray): ByteArray =
        unpack16(aesDecrypt(key, encrypted))

    private var _cmdId: Int = 0
    @Synchronized
    fun nextCmdId(): Byte {
        _cmdId = (_cmdId + 1) and 0xFF
        if (_cmdId == 0) _cmdId = 1
        return _cmdId.toByte()
    }

    private fun build(cmd: Byte, params: ByteArray, cmdId: Byte = nextCmdId()): ByteArray {
        val out = ByteArray(3 + params.size + 1)
        out[0] = REQ_HEAD
        out[1] = cmdId
        out[2] = cmd
        System.arraycopy(params, 0, out, 3, params.size)
        out[out.size - 1] = checksum(out, 1, out.size - 2)
        return out
    }

    fun buildSetTime(t: Date, cmdId: Byte = nextCmdId()): ByteArray {
        val c = Calendar.getInstance().apply { time = t }
        val params = byteArrayOf(
            (c.get(Calendar.YEAR) - 2000).toByte(),
            (c.get(Calendar.MONTH) + 1).toByte(),
            c.get(Calendar.DAY_OF_MONTH).toByte(),
            c.get(Calendar.HOUR_OF_DAY).toByte(),
            c.get(Calendar.MINUTE).toByte(),
            c.get(Calendar.SECOND).toByte(),
        )
        return build(CMD_SET_TIME, params, cmdId)
    }

    fun buildAuthPasswd(passwd: Int, cmdId: Byte = nextCmdId()): ByteArray {
        require(passwd in 0..999_999)
        val p = ByteArray(6) { 0 }
        p[0] = ((passwd / 100_000) % 10).toByte()
        p[1] = ((passwd / 10_000) % 10).toByte()
        p[2] = ((passwd / 1_000) % 10).toByte()
        p[3] = ((passwd / 100) % 10).toByte()
        p[4] = ((passwd / 10) % 10).toByte()
        p[5] = (passwd % 10).toByte()
        return build(CMD_AUTH_PASSWD, p, cmdId)
    }

    fun buildGetStatus(sleepMode: Byte = 0x01, cmdId: Byte = nextCmdId()): ByteArray =
        build(CMD_GET_STATUS, byteArrayOf(sleepMode), cmdId)

    data class ParsedResponse(val cmdId: Byte, val cmd: Byte, val payload: ByteArray)

    fun parseResponse(raw: ByteArray): ParsedResponse {
        require(raw.size >= 4) { "response too short" }
        require(raw[0] == RESP_HEAD) { "bad response head" }
        val computed = checksum(raw, 1, raw.size - 2)
        require(computed == raw[raw.size - 1]) { "bad checksum" }
        return ParsedResponse(
            cmdId = raw[1],
            cmd = raw[2],
            payload = raw.copyOfRange(3, raw.size - 1),
        )
    }
}
