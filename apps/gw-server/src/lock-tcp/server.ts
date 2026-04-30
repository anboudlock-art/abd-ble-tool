import net from 'node:net';
import type { Logger } from 'pino';
import { LockTcp } from '@abd/proto';
import { prisma } from '@abd/db';
import { loadConfig } from '../config.js';
import { LockTcpSession } from './session.js';
import { handleAck, handleEvent, handleGps, handleHeartbeat, handleLogin } from './handlers.js';
import { getSubscriber } from '../pubsub.js';

const CHAN_LOCK_DOWNLINK = 'abd:lock-downlink';

interface DownlinkMessage {
  deviceId: string;
  /** Hex-encoded full frame (already 0xFE...0xFF) ready to write to socket. */
  frameHex: string;
}

/**
 * Boot the 4GBLE093 direct-TCP listener. Returns the net.Server so callers
 * can attach .listen / .close.
 */
export function buildLockTcpServer(rootLog: Logger): net.Server {
  const config = loadConfig();

  /** deviceId -> session, so the API can target a specific lock. */
  const sessionsByDeviceId = new Map<string, LockTcpSession>();

  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    const log = rootLog.child({ remote, proto: 'lock-tcp' });
    const session = new LockTcpSession(socket, socket.remoteAddress ?? 'unknown', log);
    log.info('new lock-tcp connection');

    const armIdle = () => {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        log.warn('lock idle timeout');
        session.close('idle timeout');
      }, config.LOCK_TCP_IDLE_TIMEOUT_MS);
    };
    armIdle();

    socket.on('data', (chunk: Buffer) => {
      session.touch();
      armIdle();
      const { frames, errors } = session.parser.push(chunk);
      for (const e of errors) log.warn({ err: e.message }, 'frame error');
      for (const frame of frames) {
        void dispatch(session, frame).catch((err) => {
          log.error({ err }, 'frame dispatch failed');
        });
      }
    });

    socket.on('error', (err) => log.warn({ err: err.message }, 'socket error'));
    socket.on('close', async () => {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (session.deviceId) {
        sessionsByDeviceId.delete(session.deviceId.toString());
        try {
          await prisma.lockEvent.create({
            data: {
              deviceId: session.deviceId,
              companyId: null,
              eventType: 'offline',
              source: 'fourg',
              createdAt: new Date(),
            },
          });
        } catch (err) {
          log.warn({ err }, 'failed to write offline event');
        }
      }
      log.info('lock-tcp connection closed');
    });
  });

  async function dispatch(session: LockTcpSession, frame: LockTcp.Frame) {
    switch (frame.sub) {
      case LockTcp.Sub.LOGIN:
        await handleLogin(session, frame);
        if (session.registered && session.deviceId) {
          sessionsByDeviceId.set(session.deviceId.toString(), session);
        }
        break;
      case LockTcp.Sub.HEARTBEAT:
        await handleHeartbeat(session, frame);
        break;
      case LockTcp.Sub.GPS:
        await handleGps(session, frame);
        break;
      case LockTcp.Sub.EVENT:
        await handleEvent(session, frame);
        break;
      case LockTcp.Sub.ACK:
        await handleAck(session, frame);
        break;
      default:
        session.log.warn({ sub: frame.sub.toString(16) }, 'unhandled sub code');
    }
  }

  // Subscribe to Redis downlinks and forward to whichever session owns
  // the target device on this process. Set LOCK_TCP_DISABLE_DOWNLINK=1 to
  // skip (e.g. unit tests with no Redis available).
  if (process.env.LOCK_TCP_DISABLE_DOWNLINK !== '1') {
    try {
      const subscriber = getSubscriber();
      subscriber.subscribe(CHAN_LOCK_DOWNLINK).catch((err: Error) =>
        rootLog.warn({ err: err.message }, 'lock-downlink subscribe failed'),
      );
      subscriber.on('error', () => {
        /* swallow connect-loop errors */
      });
      subscriber.on('message', (channel, raw) => {
        if (channel !== CHAN_LOCK_DOWNLINK) return;
        let msg: DownlinkMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        const session = sessionsByDeviceId.get(msg.deviceId);
        if (!session) return;
        const frame = Buffer.from(msg.frameHex, 'hex');
        session.send(frame);
        session.log.info(
          { bytes: frame.length, deviceId: msg.deviceId },
          'lock-tcp downlink sent',
        );
      });
    } catch (err) {
      rootLog.warn({ err }, 'failed to wire lock-tcp downlink subscriber');
    }
  }

  return server;
}

export const LOCK_TCP_DOWNLINK_CHANNEL = CHAN_LOCK_DOWNLINK;
