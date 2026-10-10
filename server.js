
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, game: "DISASTER CITY" });
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const MAX_PLAYERS = 12;
const ROUND_MS = 180000;
const PREP_MS = 15000;
const TICK_MS = 100;
const ARENA = 42;

const COLORS = [
  "#ff5b5b", "#4da3ff", "#ffca4a",
  "#8c6bff", "#43d19e", "#ff8bd1"
];

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from({ length: 5 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function cleanName(name) {
  const value = String(name || "Player")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16);

  return value || "Player";
}

function spawn(index) {
  const angle = index * 2.399963229728653;
  const radius = 4 + Math.floor(index / 6) * 2;

  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      color: p.color,
      alive: p.alive,
      escaped: p.escaped
    })),
    disaster: room.disaster
      ? {
          type: room.disaster.type,
          x: room.disaster.x,
          z: room.disaster.z,
          active: room.disaster.active
        }
      : null,
    remainingMs:
      room.phase === "prep"
        ? Math.max(0, room.prepEndsAt - Date.now())
        : room.phase === "playing"
          ? Math.max(0, room.endsAt - Date.now())
          : 0,
    message: room.message
  };
}

function broadcast(room) {
  io.to(room.code).emit("roomState", publicRoom(room));
}

function sendError(socket, message) {
  socket.emit("errorMessage", message);
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

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
  }

  room.message =
    reason === "disconnect"
      ? "A player disconnected."
      : "A player left the room.";

  broadcast(room);
}

function addPlayer(room, socket, name) {
  const index = room.players.size;
  const pos = spawn(index);

  room.players.set(socket.id, {
    id: socket.id,
    name: cleanName(name),
    x: pos.x,
    z: pos.z,
    color: COLORS[index % COLORS.length],
    alive: true,
    escaped: false,
    lastMoveAt: 0
  });

  socket.join(room.code);
  socket.data.roomCode = room.code;
}

function createRoom(socket, payload = {}) {
  // Avoid creating a room if the socket is not connected.
  if (!socket.connected) return;

  leaveRoom(socket);

  const code = makeCode();

  const room = {
    code,
    hostId: socket.id,
    players: new Map(),
    phase: "lobby",
    prepEndsAt: 0,
    endsAt: 0,
    disaster: null,
    message: "Waiting for players.",
    timer: null,
    roundId: 0
  };

  rooms.set(code, room);
  addPlayer(room, socket, payload.name);

  room.message = "Room created. Share the code with your friend.";

  socket.emit("roomCreated", { code });
  broadcast(room);

  console.log(`Room ${code} created by ${socket.id}`);
}

function joinRoom(socket, payload = {}) {
  const code = String(payload.code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);

  if (code.length !== 5) {
    return sendError(socket, "Enter a valid 5-character room code.");
  }

  const room = rooms.get(code);

  if (!room) {
    return sendError(socket, "Room not found. Check the code.");
  }

  // Joining the room already occupied by this socket must not
  // remove the room from the server's room map.
  if (socket.data.roomCode === code && room.players.has(socket.id)) {
    socket.emit("roomJoined", { code });
    broadcast(room);
    return;
  }

  if (room.phase !== "lobby") {
    return sendError(socket, "This round has already started.");
  }

  if (room.players.size >= MAX_PLAYERS) {
    return sendError(socket, "This room is full.");
  }

  leaveRoom(socket);

  // The room may have changed while leaving the previous room.
  if (rooms.get(code) !== room) {
    return sendError(socket, "Room no longer exists. Try another code.");
  }

  addPlayer(room, socket, payload.name);

  room.message = `${cleanName(payload.name)} joined the room.`;

  socket.emit("roomJoined", { code });
  broadcast(room);

  console.log(`Player ${socket.id} joined room ${code}`);
}

function startRound(room) {
  room.roundId++;
  room.phase = "prep";
  room.message = "Disaster warning! Prepare to survive.";
  room.prepEndsAt = Date.now() + PREP_MS;
  room.endsAt = room.prepEndsAt + ROUND_MS;

  room.disaster = {
    type: "tornado",
    x: -14,
    z: -14,
    active: false
  };

  for (const player of room.players.values()) {
    player.alive = true;
    player.escaped = false;
  }

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
    const elapsed = Math.max(
      0,
      now - (room.endsAt - ROUND_MS)
    );

    room.disaster.x = Math.sin(elapsed / 9000) * 15;
    room.disaster.z = Math.cos(elapsed / 12000) * 13;

    for (const player of room.players.values()) {
      const dx = player.x - room.disaster.x;
      const dz = player.z - room.disaster.z;

      if (player.alive && dx * dx + dz * dz < 8) {
        player.alive = false;
      }
    }

    const alive = [...room.players.values()]
      .filter(player => player.alive);

    if (alive.length <= 1 || now >= room.endsAt) {
      room.phase = "results";

      room.message =
        alive.length === 1
          ? `${alive[0].name} survived!`
          : alive.length === 0
            ? "Nobody survived this round!"
            : `${alive.length} survivors!`;

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
  socket.data.roomCode = null;
  socket.emit("connected", { ok: true });

  socket.on("createRoom", payload => {
    try {
      createRoom(socket, payload);
    } catch (error) {
      console.error("createRoom error:", error);
      sendError(socket, "Could not create room. Please try again.");
    }
  });

  socket.on("joinRoom", payload => {
    try {
      joinRoom(socket, payload);
    } catch (error) {
      console.error("joinRoom error:", error);
      sendError(socket, "Could not join room. Please try again.");
    }
  });

  socket.on("leaveRoom", () => {
    leaveRoom(socket);
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomCode);

    if (!room) {
      return sendError(socket, "Create or join a room first.");
    }

    if (room.hostId !== socket.id) {
      return sendError(socket, "Only the host can start the round.");
    }

    if (room.players.size < 2) {
      return sendError(socket, "Invite at least one friend first.");
    }

    if (room.phase === "playing" || room.phase === "prep") {
      return;
    }

    startRound(room);
  });

  socket.on("playerMove", payload => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || !["prep", "playing"].includes(room.phase)) {
      return;
    }

    const player = room.players.get(socket.id);

    if (!player || !player.alive || !payload) return;

    const now = Date.now();

    if (now - player.lastMoveAt < 45) return;

    const x = Number(payload.x);
    const z = Number(payload.z);

    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    player.lastMoveAt = now;
    player.x = Math.max(-ARENA, Math.min(ARENA, x));
    player.z = Math.max(-ARENA, Math.min(ARENA, z));
  });

  socket.on("disconnect", () => {
    leaveRoom(socket, "disconnect");
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
  }
}, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DISASTER CITY listening on port ${PORT}`);
});
