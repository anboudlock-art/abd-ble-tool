import net from 'node:net';
import pino from 'pino';
import { Gateway } from '@abd/proto';
import { loadConfig } from './config.js';
import { GatewaySession } from './session.js';
import { handleHeartbeat, handleLoraUplink, handleRegister } from './handlers.js';
import { subscribeDownlinks } from './pubsub.js';

const config = loadConfig();
const rootLog = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
      : undefined,
});

/** gatewayId(BigInt as string) → session */
const sessionsByGatewayId = new Map<string, GatewaySession>();

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  const log = rootLog.child({ remote });
  const session = new GatewaySession(socket, socket.remoteAddress ?? 'unknown', log);
  log.info('new connection');

  session.registerTimer = setTimeout(() => {
    if (!session.registered) {
      log.warn('register timeout');
      session.close('register timeout');
    }
  }, config.GW_REGISTER_TIMEOUT_MS);

  session.heartbeatTimer = setInterval(() => {
    if (Date.now() - session.lastActivityAt > config.GW_HEARTBEAT_TIMEOUT_MS) {
      log.warn('heartbeat timeout');
      session.close('heartbeat timeout');
    }
  }, Math.floor(config.GW_HEARTBEAT_TIMEOUT_MS / 3));

  socket.on('data', (chunk: Buffer) => {
    session.touch();
    try {
      const frames = session.parser.push(chunk);
      for (const frame of frames) {
        void dispatchFrame(session, frame);
      }
    } catch (err) {
      log.warn({ err }, 'parser error');
    }
  });

  socket.on('error', (err) => log.warn({ err }, 'socket error'));
  socket.on('close', async () => {
    if (session.gatewayId) {
      sessionsByGatewayId.delete(session.gatewayId.toString());
      try {
        const { prisma } = await import('@abd/db');
        await prisma.gateway.update({
          where: { id: session.gatewayId },
          data: { online: false },
        });
        await prisma.gatewaySession.updateMany({
          where: { gatewayId: session.gatewayId, disconnectedAt: null },
          data: { disconnectedAt: new Date() },
        });
      } catch (err) {
        log.warn({ err }, 'failed to mark offline');
      }
    }
    log.info('connection closed');
  });
});

async function dispatchFrame(session: GatewaySession, frame: Gateway.Frame) {
  const { type, payload } = frame;
  switch (type) {
    case Gateway.FrameType.REGISTER:
      await handleRegister(session, payload);
      if (session.registered && session.gatewayId) {
        sessionsByGatewayId.set(session.gatewayId.toString(), session);
      }
      break;
    case Gateway.FrameType.HEARTBEAT:
      await handleHeartbeat(session);
      break;
    case Gateway.FrameType.LORA_UPLINK:
      await handleLoraUplink(session, payload);
      break;
    default:
      session.log.warn({ type }, 'unhandled frame type');
      session.send(Gateway.encodeError(Gateway.ErrorCode.BAD_TYPE));
  }
}

subscribeDownlinks(
  rootLog,
  (gatewayId) => sessionsByGatewayId.has(gatewayId),
  (gatewayId, frame) => {
    const s = sessionsByGatewayId.get(gatewayId);
    if (s) s.send(frame);
  },
);

server.listen(config.GW_TCP_PORT, config.GW_TCP_HOST, () => {
  rootLog.info(
    { host: config.GW_TCP_HOST, port: config.GW_TCP_PORT },
    'gw-server listening',
  );
});

const shutdown = (signal: string) => {
  rootLog.info(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
