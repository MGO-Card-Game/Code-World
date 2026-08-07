import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  decode,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "../src/net/protocol";
import { RoomStore, ROOM_TTL_MS, type Connection } from "./roomStore";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.cwd(), "dist");
const SWEEP_INTERVAL_MS = 60_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * 生产模式下顺带把构建产物发出去，这样 npm start 就是一个完整可部署的服务。
 * 开发时前端跑在 vite，这里只处理 WebSocket。
 */
function serveStatic(urlPath: string, respond: (status: number, headers: Record<string, string>, file?: string) => void) {
  if (!existsSync(DIST)) {
    respond(404, { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  // 归一化后再校验前缀，挡住 ../ 穿越
  const requested = normalize(join(DIST, decodeURIComponent(urlPath)));
  const safe = requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile()
    ? requested
    : join(DIST, "index.html");

  if (!existsSync(safe)) {
    respond(404, { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  respond(200, { "content-type": MIME[extname(safe)] ?? "application/octet-stream" }, safe);
}

const rooms = new RoomStore();

const http = createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  serveStatic(url.split("?")[0], (status, headers, file) => {
    response.writeHead(status, headers);
    if (file) createReadStream(file).pipe(response);
    else response.end("Not found");
  });
});

const wss = new WebSocketServer({ server: http });

function makeConnection(socket: WebSocket): Connection {
  return {
    send(message: ServerMessage) {
      if (socket.readyState === socket.OPEN) socket.send(encode(message));
    },
    close() {
      socket.close();
    },
  };
}

wss.on("connection", (socket) => {
  const connection = makeConnection(socket);

  socket.on("message", (raw) => {
    const message = decode<ClientMessage>(raw.toString());
    if (!message || typeof message.type !== "string") {
      connection.send({ type: "error", message: "无法解析的消息" });
      return;
    }

    switch (message.type) {
      case "createRoom": {
        const result = rooms.createRoom(
          connection,
          message.playerName,
          message.playerToken,
          message.capacity,
        );
        connection.send(
          result.ok
            ? { type: "ack", requestId: message.requestId, roomCode: result.roomCode, seat: result.seat }
            : { type: "error", requestId: message.requestId, message: result.message },
        );
        return;
      }
      case "joinRoom": {
        const result = rooms.joinRoom(
          connection,
          message.roomCode,
          message.playerName,
          message.playerToken,
        );
        connection.send(
          result.ok
            ? { type: "ack", requestId: message.requestId, roomCode: result.roomCode, seat: result.seat }
            : { type: "error", requestId: message.requestId, message: result.message },
        );
        return;
      }
      case "leaveRoom": {
        rooms.leave(connection);
        return;
      }
      case "startGame": {
        const result = rooms.startGame(connection);
        if (!result.ok) {
          connection.send({ type: "error", requestId: message.requestId, message: result.message });
        }
        return;
      }
      case "action": {
        const result = rooms.applyAction(connection, message.action);
        if (!result.ok) {
          connection.send({ type: "error", requestId: message.requestId, message: result.message });
        }
        return;
      }
      default:
        connection.send({ type: "error", message: "未知的消息类型" });
    }
  });

  socket.on("close", () => rooms.disconnect(connection));
  socket.on("error", () => rooms.disconnect(connection));
});

// 全员掉线且超时的房间不会自己消失，需要定时回收
const sweeper = setInterval(() => rooms.sweep(ROOM_TTL_MS), SWEEP_INTERVAL_MS);
sweeper.unref?.();

http.listen(PORT, () => {
  console.log(`骰境登峰 服务已启动: http://localhost:${PORT}`);
});
