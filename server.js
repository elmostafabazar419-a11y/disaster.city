const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true, game: "DISASTER CITY" }));

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MAX_PLAYERS = 12;
const ROUND_MS = 180000;
const PREP_MS = 15000;
const TICK_MS = 100;
const ARENA = 42;

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function cleanName(name) {
  const value = String(name || "Player").replace(/[<>]/g, "").trim().slice(0, 16);
  return value || "Player";
}
function spawn(index) {
  const angle = index * 2.399963229728653;
  const radius = 4 + Math.floor(index / 6) * 2;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, z: p.z, color: p.color,
      alive: p.alive, escaped: p.escaped
    })),
    disaster: room.disaster ? { type: room.disaster.type, x: room.disaster.x, z: room.disaster.z, active: room.disaster.active } : null,
    remainingMs: room.phase === "prep" ? Math.max(0, room.prepEndsAt - Date.now()) :
      room.phase === "playing" ? Math.max(0, room.endsAt - Date.now()) : 0,
    message: room.message
  };
}
function broadcast(room) {
  io.to(room.code).emit("roomState", publicRoom(room));
}
function leaveRoom(socket, reason = "left") {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players.delete(socket.id);
  if (room.players.size === 0) {
    clearInterval(room.timer);
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  room.message = reason === "disconnect" ? "A player disconnected." : "A player left.";
  broadcast(room);
}
function createRoom(socket, payload) {
  leaveRoom(socket);
  const code = makeCode();
  const room = {
    code, hostId: socket.id, players: new Map(), phase: "lobby",
    prepEndsAt: 0, endsAt: 0, disaster: null, message: "Waiting for players.",
    timer: null, roundId: 0
  };
  rooms.set(code, room);
  socket.join(code);
  socket.data.roomCode = code;
  addPlayer(room, socket, payload?.name);
  room.message = "Room created. Share the code with your friend.";
  broadcast(room);
  socket.emit("roomCreated", { code });
}
function addPlayer(room, socket, name) {
  const index = room.players.size;
  const pos = spawn(index);
  const colors = ["#ff5b5b", "#4da3ff", "#ffca4a", "#8c6bff", "#43d19e", "#ff8bd1"];
  room.players.set(socket.id, {
    id: socket.id, name: cleanName(name), x: pos.x, z: pos.z,
    color: colors[index % colors.length], alive: true, escaped: false, lastMoveAt: 0
  });
  socket.join(room.code);
  socket.data.roomCode = room.code;
}
function joinRoom(socket, payload) {
  const code = String(payload?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const room = rooms.get(code);
  if (!room) return socket.emit("errorMessage", "Room not found. Check the code.");
  if (room.players.size >= MAX_PLAYERS) return socket.emit("errorMessage", "This room is full.");
  if (room.phase === "playing") return socket.emit("errorMessage", "This round has started. Wait for the next round.");
  leaveRoom(socket);
  addPlayer(room, socket, payload?.name);
  room.message = `${cleanName(payload?.name)} joined the room.`;
  broadcast(room);
  socket.emit("roomJoined", { code });
}
function startRound(room) {
  if (!room || room.players.size < 1) return;
  room.roundId++;
  room.phase = "prep";
  room.message = "Disaster warning! Prepare to survive.";
  room.prepEndsAt = Date.now() + PREP_MS;
  room.endsAt = room.prepEndsAt + ROUND_MS;
  room.disaster = { type: "tornado", x: -14, z: -14, active: false };
  for (const p of room.players.values()) { p.alive = true; p.escaped = false; }
  broadcast(room);
}
function tickRoom(room) {
  const now = Date.now();
  if (room.phase === "prep" && now >= room.prepEndsAt) {
    room.phase = "playing";
    room.disaster.active = true;
    room.message = "TORNADO! Keep moving and avoid the danger zone.";
    broadcast(room);
  }
  if (room.phase === "playing") {
    const elapsed = Math.max(0, now - (room.endsAt - ROUND_MS));
    // Move the tornado along a broad looping path. The server owns its position.
    room.disaster.x = Math.sin(elapsed / 9000) * 15;
    room.disaster.z = Math.cos(elapsed / 12000) * 13;
    for (const p of room.players.values()) {
      const dx = p.x - room.disaster.x, dz = p.z - room.disaster.z;
      if (p.alive && dx * dx + dz * dz < 8) p.alive = false;
    }
    const alive = [...room.players.values()].filter(p => p.alive);
    if (alive.length <= 1 || now >= room.endsAt) {
      room.phase = "results";
      room.message = alive.length === 1 ? `${alive[0].name} survived!` : alive.length === 0 ? "Nobody survived this round!" : `${alive.length} survivors!`;
      broadcast(room);
      return;
    }
    broadcast(room);
  }
  if (room.phase === "results" && now > room.endsAt + 8000) {
    room.phase = "lobby";
    room.message = "Ready for another round.";
    room.disaster = null;
    broadcast(room);
  }
}
io.on("connection", socket => {
  socket.emit("connected", { ok: true });
  socket.on("createRoom", payload => createRoom(socket, payload));
  socket.on("joinRoom", payload => joinRoom(socket, payload));
  socket.on("leaveRoom", () => leaveRoom(socket));
  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return socket.emit("errorMessage", "Create or join a room first.");
    if (room.hostId !== socket.id) return socket.emit("errorMessage", "Only the room host can start the round.");
    if (room.players.size < 2) return socket.emit("errorMessage", "Invite at least one friend before starting.");
    if (room.phase === "playing" || room.phase === "prep") return;
    startRound(room);
  });
  socket.on("playerMove", payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase === "lobby" || room.phase === "results") return;
    const p = room.players.get(socket.id);
    if (!p || !p.alive || !payload) return;
    const now = Date.now();
    if (now - p.lastMoveAt < 45) return;
    p.lastMoveAt = now;
    const x = Number(payload.x), z = Number(payload.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    p.x = Math.max(-ARENA, Math.min(ARENA, x));
    p.z = Math.max(-ARENA, Math.min(ARENA, z));
  });
  socket.on("disconnect", () => leaveRoom(socket, "disconnect"));
});
setInterval(() => {
  for (const room of rooms.values()) tickRoom(room);
}, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DISASTER CITY listening on ${PORT}`);
});
