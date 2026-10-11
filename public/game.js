
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const $ = id => document.getElementById(id);
const socket = io({ transports: ["websocket", "polling"] });

let scene, camera, renderer, clock;
let localPlayer = null, roomCode = null, roomState = null;
let isPractice = false, jumpVelocity = 0, onGround = true;
let lastSend = 0;
let tornadoGroup = null;

let cameraYaw = 0;
let cameraPitch = 0.25;
let cameraDragging = false;
let cameraPointerId = null;
let lastPointerX = 0;
let lastPointerY = 0;

const cameraDistance = 10;
const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();

const remotes = new Map();
const keys = new Set();
const move = { x: 0, z: 0 };
const arena = 42;
const world = $("game");

init3D();
animate();

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x91c7e8);
  scene.fog = new THREE.Fog(0x91c7e8, 55, 145);

  camera = new THREE.PerspectiveCamera(
    68,
    innerWidth / innerHeight,
    0.1,
    300
  );

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.style.touchAction = "none";
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  world.appendChild(renderer.domElement);
  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x59604b, 2));

  const sun = new THREE.DirectionalLight(0xfff0d4, 2.5);
  sun.position.set(-25, 45, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  buildCity();

  window.addEventListener("resize", resize);

  window.addEventListener("keydown", e => {
    keys.add(e.code);

    if ([
      "Space", "ArrowUp", "ArrowDown",
      "ArrowLeft", "ArrowRight"
    ].includes(e.code)) {
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", e => keys.delete(e.code));

  window.addEventListener("blur", () => {
    keys.clear();
    resetStick();
    cameraDragging = false;
    cameraPointerId = null;
  });

  // CREATE ROOM
  if ($("createBtn")) {
    $("createBtn").onclick = () => {
      if (!socket.connected) {
        setNotice("السيرفر غير متصل. عاود حدّث الصفحة.");
        return;
      }

      setNotice("جاري إنشاء الغرفة...");
      socket.emit("createRoom", { name: getName() });
    };
  }

  // JOIN ROOM
  if ($("joinBtn")) {
    $("joinBtn").onclick = () => {
      const code = $("roomCode")?.value.trim().toUpperCase();

      if (!code) {
        setNotice("دخل كود الغرفة أولاً.");
        return;
      }

      if (!socket.connected) {
        setNotice("السيرفر غير متصل. عاود حدّث الصفحة.");
        return;
      }

      setNotice("جاري الدخول إلى الغرفة...");
      socket.emit("joinRoom", {
        name: getName(),
        code
      });
    };
  }

  if ($("soloBtn")) $("soloBtn").onclick = startPractice;
  if ($("leaveBtn")) $("leaveBtn").onclick = leaveGame;

  if ($("roomCode")) {
    $("roomCode").addEventListener("input", () => {
      $("roomCode").value = $("roomCode").value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5);
    });
  }

  if ($("jump")) {
    $("jump").addEventListener("pointerdown", e => {
      e.preventDefault();
      jump();
    });
  }

  setupStick();
  setupCameraDrag();
}

function mat(color, roughness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function box(w, h, d, color, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mat(color)
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (opts.parent) opts.parent.add(mesh);
  else scene.add(mesh);

  return mesh;
}

function buildCity() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    mat(0x69a96a)
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  // ROADS
  for (let i = -40; i <= 40; i += 20) {
    box(180, 0.08, 7, 0x3d4654, 0, 0, i);
    box(7, 0.08, 180, 0x3d4654, i, 0.01, 0);

    for (let j = -80; j <= 80; j += 9) {
      box(2.4, 0.03, 0.18, 0xe9dfad, j, 0.06, i);
      box(0.18, 0.03, 2.4, 0xe9dfad, i, 0.07, j);
    }
  }

  // BUILDINGS
  const colors = [
    0xf2b66d, 0xe07b70, 0x7d9ed0,
    0xc5d1db, 0xd6c17b, 0x91b7a0,
    0xb6a1d5
  ];

  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      const wx = x * 18 + ((z % 2) * 2);
      const wz = z * 18;

      if (Math.abs(wx) < 17 && Math.abs(wz) < 17) continue;

      const h = 5 + Math.random() * 13;
      const w = 6 + Math.random() * 5;
      const d = 6 + Math.random() * 5;

      box(
        w, h, d,
        colors[Math.floor(Math.random() * colors.length)],
        wx, h / 2, wz
      );

      box(w + 0.25, 0.45, d + 0.25, 0x35485a, wx, h + 0.15, wz);

      const windowMat = mat(0x9fe3ed, 0.35);

      for (let yy = 2.2; yy < h - 1; yy += 2.4) {
        for (let xx = -w / 2 + 1.2; xx < w / 2 - 0.5; xx += 2.1) {
          const win = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.9, 0.08),
            windowMat
          );

          win.position.set(wx + xx, yy, wz + d / 2 + 0.06);
          scene.add(win);
        }
      }
    }
  }

  // SAFE ZONE
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(5.5, 5.5, 0.18, 32),
    mat(0x27c994)
  );

  pad.position.set(28, 0.1, 28);
  pad.receiveShadow = true;
  scene.add(pad);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.2, 0.16, 8, 40),
    new THREE.MeshStandardMaterial({
      color: 0xb9ffe4,
      emissive: 0x146f54
    })
  );

  ring.rotation.x = Math.PI / 2;
  ring.position.set(28, 0.25, 28);
  scene.add(ring);

  addSign("SAFE ZONE", 28, 2.4, 28, 0x083e34);

  // TREES
  for (let i = 0; i < 18; i++) {
    const x = (i % 6) * 13 - 38;
    const z = Math.floor(i / 6) * 22 - 20;

    if (Math.abs(x) < 15 && Math.abs(z) < 15) continue;

    box(0.65, 2, 0.65, 0x79583d, x, 1, z);

    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 2.8, 2.8),
      mat(0x2e8758)
    );

    crown.position.set(x, 3.1, z);
    crown.castShadow = true;
    scene.add(crown);
  }

  // HOSPITAL
  box(10, 8, 8, 0xe9f1f5, -28, 4, -28);
  box(10.4, 0.5, 8.4, 0x4d9de5, -28, 8.2, -28);
  box(0.7, 3.4, 0.25, 0xe54f55, -28, 4.5, -23.85);
  box(3.4, 0.7, 0.25, 0xe54f55, -28, 4.5, -23.85);

  addSign("HOSPITAL", -28, 10, -28, 0x12345a);
}

function addSign(text, x, y, z, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;

  const c = canvas.getContext("2d");
  c.fillStyle = "#10243b";
  c.fillRect(0, 0, 512, 128);

  c.fillStyle = "#ffffff";
  c.font = "bold 54px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 256, 66);

  const tex = new THREE.CanvasTexture(canvas);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 1.75),
    new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.DoubleSide
    })
  );

  mesh.position.set(x, y, z);
  scene.add(mesh);
}

function makeCharacter(color, name) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.1, 0.48),
    mat(color)
  );

  body.position.y = 1.25;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.68, 0.68),
    mat(0xffd2a3)
  );

  head.position.y = 2.15;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.2, 0.7),
    mat(0x3b2a24)
  );

  hair.position.y = 2.55;
  group.add(hair);

  const legs = [];
  const arms = [];

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.78, 0.38),
      mat(0x273b5b)
    );

    leg.position.set(side * 0.24, 0.39, 0);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.82, 0.32),
      mat(color)
    );

    arm.position.set(side * 0.62, 1.35, 0);
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);
  }

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 96;

  const ctx = labelCanvas.getContext("2d");
  ctx.fillStyle = "#07111ddc";
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(name || "Player").slice(0, 16), 256, 48);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.45),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(labelCanvas),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );

  label.position.y = 3;
  group.add(label);
  group.userData = { legs, arms, label };

  return group;
}

function getName() {
  return $("playerName")?.value.trim().slice(0, 16) || "Player";
}

function setNotice(msg) {
  const notice = $("notice");
  if (notice) notice.textContent = msg;
  else showToast(msg);
}

function showToast(msg) {
  const el = $("toast");
  if (!el) return;

  el.textContent = msg;
  el.style.display = "block";

  setTimeout(() => {
    if (el.textContent === msg) el.style.display = "none";
  }, 3500);
}

function setHudVisible(visible) {
  const hud = $("hud");
  const lobby = $("lobby");

  if (hud) {
    hud.classList.toggle("hidden", !visible);
  }

  if (lobby) {
    lobby.classList.toggle("hidden", visible);
  }
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function startPractice() {
  isPractice = true;
  roomCode = "PRACTICE";
  roomState = { phase: "playing" };

  setHudVisible(true);

  if (!localPlayer) {
    localPlayer = makeCharacter(0xff5b5b, getName());
    scene.add(localPlayer);
  }

  localPlayer.position.set(0, 0, 0);
  jumpVelocity = 0;
  onGround = true;

  setText("codeBadge", "PRACTICE");
  setText("roomInfo", "PRACTICE");
  setText("statusText", "Practice mode");
  showToast("Practice mode started.");
}

function leaveGame() {
  if (!isPractice && roomCode) socket.emit("leaveRoom");

  isPractice = false;
  roomCode = null;
  roomState = null;
  jumpVelocity = 0;
  onGround = true;

  setHudVisible(false);

  if (localPlayer) {
    scene.remove(localPlayer);
    disposeCharacter(localPlayer);
    localPlayer = null;
  }

  for (const [id, obj] of remotes) {
    scene.remove(obj.mesh);
    disposeCharacter(obj.mesh);
    remotes.delete(id);
  }

  removeTornado();
}

function disposeCharacter(character) {
  character.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();

    if (obj.material) {
      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];

      materials.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function joined(code) {
  isPractice = false;
  roomCode = String(code || "").toUpperCase();

  setHudVisible(true);

  setText("roomInfo", "ROOM CODE: " + roomCode);
  setText("statusText", "Connected to room: " + roomCode);

  if (!localPlayer) {
    localPlayer = makeCharacter(0xff5b5b, getName());
    scene.add(localPlayer);
  }

  localPlayer.position.set(0, 0, 0);
  jumpVelocity = 0;
  onGround = true;

  showToast("Room code: " + roomCode);
}

// SOCKET EVENTS
socket.on("connect", () => {
  setNotice("Online server connected.");
});

socket.on("connect_error", () => {
  setNotice("Could not connect to game server. Refresh and try again.");
});

socket.on("roomCreated", data => {
  if (!data || !data.code) {
    setNotice("السيرفر ما صيفطش كود الغرفة.");
    return;
  }

  joined(data.code);

  if ($("roomCode")) $("roomCode").value = data.code;
});

socket.on("roomJoined", data => {
  if (!data || !data.code) {
    setNotice("السيرفر ما صيفطش كود الغرفة.");
    return;
  }

  joined(data.code);
});

socket.on("errorMessage", msg => {
  setNotice(typeof msg === "string" ? msg : "وقع خطأ فالغرفة.");
});

socket.on("roomState", state => {
  if (!state) return;

  roomState = state;

  if (state.code) {
    roomCode = state.code;
    setText("codeBadge", state.code);
    setText("roomInfo", "ROOM " + state.code);
  }

  const players = state.players || [];
  updateRemotePlayers(players);

  const seconds = Math.ceil((state.remainingMs || 0) / 1000);

  const phaseText =
    state.phase === "lobby" ? "Waiting for players" :
    state.phase === "prep" ? "Disaster in " + seconds + "s" :
    state.phase === "playing" ? "SURVIVE · " + seconds + "s" :
    state.phase === "results" ? "Round over" :
    "Connected";

  setText("statusText", phaseText + "\n" + (state.message || ""));

  renderPlayers(players);

  if (state.disaster && state.disaster.active) {
    updateTornado(state.disaster);
  } else {
    removeTornado();
  }

  if (
    state.phase === "lobby" &&
    players.length >= 2 &&
    $("hud") &&
    !$("startRoundBtn")
  ) {
    const b = document.createElement("button");
    b.id = "startRoundBtn";
    b.textContent = "START ROUND";
    b.className = "primary";

    b.style.cssText =
      "position:absolute;left:50%;top:calc(50% + 55px);" +
      "transform:translateX(-50%);pointer-events:auto;z-index:10";

    b.onclick = () => socket.emit("startGame");
    $("hud").appendChild(b);
  }

  if (state.phase !== "lobby") {
    $("startRoundBtn")?.remove();
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function renderPlayers(players) {
  const el = $("players") || $("playerList");
  if (!el) return;

  el.innerHTML = players.map(p => `
    <div class="player-row">
      <span class="dot" style="background:${escapeHtml(p.color || "#fff")}"></span>
      <span>${escapeHtml(p.name || "Player")}${p.id === socket.id ? " (you)" : ""}</span>
      <span style="margin-left:auto;color:${p.alive ? "#6ee7b7" : "#ff7777"}">
        ${p.alive ? "●" : "×"}
      </span>
    </div>
  `).join("");
}

function updateRemotePlayers(players) {
  const ids = new Set(
    players.filter(p => p.id !== socket.id).map(p => p.id)
  );

  for (const [id, obj] of remotes) {
    if (!ids.has(id)) {
      scene.remove(obj.mesh);
      disposeCharacter(obj.mesh);
      remotes.delete(id);
    }
  }

  for (const p of players) {
    if (p.id === socket.id) {
      // لا نبدلوش موقع الشخصية المحلية من تحديثات الشبكة باستمرار.
      continue;
    }

    let obj = remotes.get(p.id);

    if (!obj) {
      const mesh = makeCharacter(p.color || 0x5599ff, p.name);
      scene.add(mesh);

      obj = {
        mesh,
        target: new THREE.Vector3(
          Number(p.x) || 0,
          0,
          Number(p.z) || 0
        )
      };

      remotes.set(p.id, obj);
    }

    obj.target.set(
      Number(p.x) || 0,
      0,
      Number(p.z) || 0
    );

    obj.mesh.userData.alive = p.alive;
    obj.mesh.visible = p.alive !== false;
  }
}

// TORNADO
function updateTornado(d) {
  if (!tornadoGroup) {
    tornadoGroup = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 3.2, 8, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x9ca3af,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        roughness: 1
      })
    );

    base.position.y = 4;
    tornadoGroup.add(base);

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1 + i * 0.42, 0.13, 6, 24),
        new THREE.MeshStandardMaterial({
          color: 0x697586,
          transparent: true,
          opacity: 0.8
        })
      );

      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.1 + i * 1.65;
      tornadoGroup.add(ring);
    }

    scene.add(tornadoGroup);
  }

  tornadoGroup.position.set(
    Number(d.x) || 0,
    0,
    Number(d.z) || 0
  );
}

function removeTornado() {
  if (tornadoGroup) {
    scene.remove(tornadoGroup);

    tornadoGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();

      if (obj.material) {
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];

        materials.forEach(m => m.dispose());
      }
    });

    tornadoGroup = null;
  }
}

// MOBILE JOYSTICK
let stickPointerId = null;

function setupStick() {
  const stick = $("stick");
  const knob = $("knob");

  if (!stick || !knob) return;

  stick.style.touchAction = "none";
  knob.style.touchAction = "none";

  stick.addEventListener("pointerdown", e => {
    e.preventDefault();

    stickPointerId = e.pointerId;

    const rect = stick.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;

    stick.dataset.originX = originX;
    stick.dataset.originY = originY;

    try {
      stick.setPointerCapture(e.pointerId);
    } catch {}

    updateStick(e);
  });

  stick.addEventListener("pointermove", e => {
    if (e.pointerId !== stickPointerId) return;
    updateStick(e);
  });

  stick.addEventListener("pointerup", e => {
    if (e.pointerId !== stickPointerId) return;
    resetStick();
  });

  stick.addEventListener("pointercancel", resetStick);
  stick.addEventListener("lostpointercapture", resetStick);

  function updateStick(e) {
    const rect = stick.getBoundingClientRect();
    const originX = Number(stick.dataset.originX);
    const originY = Number(stick.dataset.originY);

    let dx = e.clientX - originX;
    let dy = e.clientY - originY;

    const radius = Math.max(20, rect.width / 2 - 25);
    const length = Math.hypot(dx, dy);

    if (length > radius) {
      dx = dx / length * radius;
      dy = dy / length * radius;
    }

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    knob.style.left = (centerX + dx - knob.offsetWidth / 2) + "px";
    knob.style.top = (centerY + dy - knob.offsetHeight / 2) + "px";

    move.x = dx / radius;
    move.z = dy / radius;
  }
}

function resetStick() {
  stickPointerId = null;
  move.x = 0;
  move.z = 0;

  const stick = $("stick");
  const knob = $("knob");

  if (stick && knob) {
    knob.style.left = ((stick.clientWidth - knob.offsetWidth) / 2) + "px";
    knob.style.top = ((stick.clientHeight - knob.offsetHeight) / 2) + "px";
  }
}

// CAMERA DRAG
function setupCameraDrag() {
  const canvas = renderer.domElement;

  canvas.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // الجهة اليسرى مخصصة للـ joystick
    if (e.clientX < innerWidth * 0.42) return;

    cameraDragging = true;
    cameraPointerId = e.pointerId;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });

  canvas.addEventListener("pointermove", e => {
    if (!cameraDragging || e.pointerId !== cameraPointerId) return;

    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    cameraYaw -= dx * 0.006;
    cameraPitch = THREE.MathUtils.clamp(
      cameraPitch + dy * 0.004,
      -0.15,
      0.9
    );
  });

  const stop = e => {
    if (e.pointerId !== cameraPointerId) return;

    cameraDragging = false;
    cameraPointerId = null;
  };

  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("lostpointercapture", stop);
}

function jump() {
  if (!localPlayer || !onGround) return;

  jumpVelocity = 7.5;
  onGround = false;
}

// GAME LOOP
function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (localPlayer) {
    let inputX = move.x;
    let inputZ = move.z;

    if (keys.has("KeyA") || keys.has("ArrowLeft")) inputX -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) inputX += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) inputZ -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) inputZ += 1;

    if (keys.has("Space")) jump();

    const inputLength = Math.hypot(inputX, inputZ);

    if (inputLength > 1) {
      inputX /= inputLength;
      inputZ /= inputLength;
    }

    const canMove =
      isPractice ||
      !roomState ||
      roomState.phase === "playing";

    if (canMove) {
      // اتجاه الحركة تابع لاتجاه الكاميرا
      const forwardX = -Math.sin(cameraYaw);
      const forwardZ = -Math.cos(cameraYaw);

      const rightX = Math.cos(cameraYaw);
      const rightZ = -Math.sin(cameraYaw);

      const worldX = rightX * inputX - forwardX * inputZ;
      const worldZ = rightZ * inputX - forwardZ * inputZ;

      localPlayer.position.x = THREE.MathUtils.clamp(
        localPlayer.position.x + worldX * 8 * dt,
        -arena,
        arena
      );

      localPlayer.position.z = THREE.MathUtils.clamp(
        localPlayer.position.z + worldZ * 8 * dt,
        -arena,
        arena
      );

      if (inputLength > 0.1) {
        localPlayer.rotation.y = Math.atan2(worldX, worldZ);
      }

      // Gravity and jumping
      jumpVelocity -= 18 * dt;
      localPlayer.position.y += jumpVelocity * dt;

      if (localPlayer.position.y <= 0) {
        localPlayer.position.y = 0;
        jumpVelocity = 0;
        onGround = true;
      }

      const t = clock.elapsedTime;

      localPlayer.userData.legs.forEach((leg, i) => {
        leg.rotation.x = inputLength > 0.1
          ? Math.sin(t * 11 + i * Math.PI) * 0.55
          : 0;
      });

      const now = performance.now();

      if (!isPractice && roomCode && now - lastSend > 70) {
        socket.emit("playerMove", {
          x: localPlayer.position.x,
          z: localPlayer.position.z
        });

        lastSend = now;
      }
    }

    // Third-person camera
    const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
    const verticalDistance = cameraDistance * Math.sin(cameraPitch);

    cameraDesired.set(
      localPlayer.position.x + Math.sin(cameraYaw) * horizontalDistance,
      localPlayer.position.y + 2.3 + verticalDistance,
      localPlayer.position.z + Math.cos(cameraYaw) * horizontalDistance
    );

    camera.position.lerp(
      cameraDesired,
      1 - Math.exp(-8 * dt)
    );

    cameraTarget.set(
      localPlayer.position.x,
      localPlayer.position.y + 1.35,
      localPlayer.position.z
    );

    camera.lookAt(cameraTarget);
  } else {
    camera.position.lerp(new THREE.Vector3(0, 26, 34), 0.025);
    camera.lookAt(0, 0, 0);
  }

  // Smooth remote player movement
  for (const obj of remotes.values()) {
    obj.mesh.position.lerp(obj.target, 0.22);

    if (obj.mesh.userData.legs) {
      obj.mesh.userData.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(
          clock.elapsedTime * 8 + i * Math.PI
        ) * 0.12;
      });
    }
  }

  if (tornadoGroup) {
    tornadoGroup.rotation.y += dt * 1.7;

    tornadoGroup.children.slice(1).forEach((ring, i) => {
      ring.rotation.z += dt * (i % 2 ? 1 : -1) * 1.5;
    });
  }

  renderer.render(scene, camera);
}

function resize() {
  if (!camera || !renderer) return;

  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
