'use client';

/**
 * Web Bluetooth debug console — pairs with an Anboud BLE lock from the browser
 * (Chromium-only) and lets you exercise the AES-encrypted command set without
 * needing the mobile app. Useful on the production line to verify a freshly
 * flashed lock before it leaves the bench.
 *
 * Reuses the same wire format as @abd/proto/ble (mirrored at /src/lib/ble/codec.ts
 * because the @abd/proto build still uses node:Buffer).
 */

import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  SERVICE_UUID,
  NOTIFY_UUID,
  WRITE_UUID,
  parseMac,
  deriveKey1,
  deriveKey2,
  encryptRequest,
  decryptResponse,
  parseResponse,
  buildSetTime,
  buildAuthPasswd,
  buildOpenLock,
  buildCloseLock,
  buildGetStatus,
  bytesToHex,
  BleCmd,
} from '@/lib/ble/codec';

interface LogEntry {
  ts: string;
  level: 'info' | 'tx' | 'rx' | 'err';
  msg: string;
}

interface BleConnection {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  writeChar: BluetoothRemoteGATTCharacteristic;
  notifyChar: BluetoothRemoteGATTCharacteristic;
}

export default function BleDebugPage() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [conn, setConn] = useState<BleConnection | null>(null);
  const [mac, setMac] = useState('');
  const [authed, setAuthed] = useState(false);
  const [passwd, setPasswd] = useState('123456');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // We resolve the next reply on the notify char by registering a one-shot
  // handler. The handler is replaced for each TX.
  const pendingResolve = useRef<((data: DataView) => void) | null>(null);
  const pendingReject = useRef<((err: Error) => void) | null>(null);
  const pendingTimer = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setSupported(typeof navigator.bluetooth !== 'undefined');
  }, []);

  function pushLog(level: LogEntry['level'], msg: string) {
    setLogs((cur) =>
      [{ ts: new Date().toLocaleTimeString('zh-CN'), level, msg }, ...cur].slice(0, 200),
    );
  }

  function clearPending() {
    if (pendingTimer.current != null) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    pendingResolve.current = null;
    pendingReject.current = null;
  }

  function expectReply(timeoutMs = 5000): Promise<DataView> {
    return new Promise<DataView>((resolve, reject) => {
      pendingResolve.current = resolve;
      pendingReject.current = reject;
      pendingTimer.current = window.setTimeout(() => {
        clearPending();
        reject(new Error('timeout'));
      }, timeoutMs);
    });
  }

  async function connect() {
    if (!navigator.bluetooth) {
      alert('当前浏览器不支持 Web Bluetooth。请使用 Chrome/Edge 桌面版。');
      return;
    }
    try {
      pushLog('info', '请求设备…');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      pushLog('info', `已选: ${device.name ?? '(unnamed)'} ${device.id.slice(0, 12)}`);
      device.addEventListener('gattserverdisconnected', () => {
        pushLog('err', '设备已断开');
        setConn(null);
        setAuthed(false);
      });
      const server = await device.gatt!.connect();
      pushLog('info', '已连接 GATT 服务器');
      const service = await server.getPrimaryService(SERVICE_UUID);
      const writeChar = await service.getCharacteristic(WRITE_UUID);
      const notifyChar = await service.getCharacteristic(NOTIFY_UUID);
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        const target = e.target as BluetoothRemoteGATTCharacteristic;
        const value = target.value;
        if (!value) return;
        const cb = pendingResolve.current;
        if (cb) {
          clearPending();
          cb(value);
        } else {
          pushLog(
            'rx',
            `(unsolicited) ${bytesToHex(new Uint8Array(value.buffer))}`,
          );
        }
      });
      pushLog('info', '订阅 NOTIFY 完成');
      setConn({ device, server, writeChar, notifyChar });
      setAuthed(false);
    } catch (err) {
      pushLog('err', `连接失败: ${(err as Error).message}`);
    }
  }

  async function disconnect() {
    if (conn?.server.connected) conn.server.disconnect();
    setConn(null);
    setAuthed(false);
  }

  async function exchange(rawFrame: Uint8Array): Promise<Uint8Array> {
    if (!conn) throw new Error('未连接');
    if (!mac) throw new Error('请先填写设备 MAC');
    const macBytes = parseMac(mac);
    // The reference SDK uses key2 (key1 with date suffix) for OPEN/CLOSE, but
    // accepts key1 for AUTH. To keep the surface small we always derive key2
    // from the current wall clock; for AUTH commands the device tolerates the
    // wider key.
    const key1 = deriveKey1(macBytes);
    const key = authed && rawFrame[2] !== BleCmd.AUTH_PASSWD ? deriveKey2(key1) : key1;

    const enc = await encryptRequest(key, rawFrame);
    pushLog('tx', `${bytesToHex(rawFrame)}  (key${key === key1 ? '1' : '2'})`);
    const replyPromise = expectReply(6000);
    await conn.writeChar.writeValueWithoutResponse(enc as BufferSource);
    const reply = await replyPromise;
    const cipher = new Uint8Array(
      reply.buffer.slice(reply.byteOffset, reply.byteOffset + reply.byteLength),
    );
    if (cipher.length !== 16) throw new Error(`reply length ${cipher.length} ≠ 16`);
    const dec = await decryptResponse(key, cipher);
    pushLog('rx', bytesToHex(dec));
    return dec;
  }

  async function withBusy(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      pushLog('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doAuth() {
    await withBusy(async () => {
      const pw = parseInt(passwd, 10);
      if (!Number.isFinite(pw) || pw < 0 || pw > 999_999) throw new Error('密码必须是 0–999999');
      const dec = await exchange(buildAuthPasswd(pw));
      const resp = parseResponse(dec);
      if (resp.payload[0] === 0x00) {
        setAuthed(true);
        pushLog('info', '认证成功');
      } else {
        setAuthed(false);
        pushLog('err', `认证失败 0x${resp.payload[0]?.toString(16)}`);
      }
    });
  }

  async function doSetTime() {
    await withBusy(async () => {
      const dec = await exchange(buildSetTime(new Date()));
      parseResponse(dec);
      pushLog('info', '时间已同步');
    });
  }

  async function doOpen() {
    await withBusy(async () => {
      const dec = await exchange(buildOpenLock(1));
      parseResponse(dec);
      pushLog('info', '开锁指令已应答');
    });
  }

  async function doClose() {
    await withBusy(async () => {
      const dec = await exchange(buildCloseLock(1));
      parseResponse(dec);
      pushLog('info', '关锁指令已应答');
    });
  }

  async function doStatus() {
    await withBusy(async () => {
      const dec = await exchange(buildGetStatus(1));
      const resp = parseResponse(dec);
      pushLog(
        'info',
        `状态: ${bytesToHex(resp.payload)} (cmd=0x${resp.cmd.toString(16)})`,
      );
    });
  }

  if (supported === null) return null;
  if (!supported) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-700">
            当前浏览器不支持 Web Bluetooth。请使用 桌面版 Chrome / Edge / Opera 打开本页。
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">BLE 调试</h1>
        <Badge tone={conn ? 'green' : 'gray'}>
          {conn ? `已连接: ${conn.device.name ?? '(unnamed)'}` : '未连接'}
        </Badge>
      </div>

      <Card>
        <CardHeader
          title="连接 / 认证"
          description="先输入锁的 BLE MAC（用于派生 AES 密钥），再选择设备。所有指令均通过 AES-128-ECB 加密单块发送。"
        />
        <CardBody className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-600">设备 MAC</label>
              <Input
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="font-mono"
                disabled={!!conn}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">认证密码 (6 位)</label>
              <Input
                value={passwd}
                onChange={(e) => setPasswd(e.target.value)}
                placeholder="123456"
                className="font-mono"
                inputMode="numeric"
              />
            </div>
            <div className="flex items-end gap-2">
              {!conn ? (
                <Button onClick={connect} className="w-full">
                  选择并连接
                </Button>
              ) : (
                <Button variant="secondary" onClick={disconnect} className="w-full">
                  断开
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={!conn || busy} onClick={doAuth}>
              认证
            </Button>
            <Button
              variant="secondary"
              disabled={!conn || !authed || busy}
              onClick={doSetTime}
            >
              同步时间
            </Button>
            <Button
              variant="secondary"
              disabled={!conn || !authed || busy}
              onClick={doOpen}
            >
              开锁
            </Button>
            <Button
              variant="secondary"
              disabled={!conn || !authed || busy}
              onClick={doClose}
            >
              关锁
            </Button>
            <Button
              variant="ghost"
              disabled={!conn || !authed || busy}
              onClick={doStatus}
            >
              查询状态
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="日志" description="最近 200 条；最新在上。" />
        <div className="max-h-[500px] overflow-y-auto px-6 pb-6">
          {logs.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">尚无日志</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs">
              {logs.map((l, i) => (
                <li
                  key={i}
                  className={
                    l.level === 'tx'
                      ? 'text-sky-700'
                      : l.level === 'rx'
                        ? 'text-emerald-700'
                        : l.level === 'err'
                          ? 'text-red-600'
                          : 'text-slate-600'
                  }
                >
                  <span className="mr-2 text-slate-400">{l.ts}</span>
                  <span className="mr-2 inline-block w-8 text-[10px] uppercase">
                    {l.level}
                  </span>
                  {l.msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
