import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const $ = id => document.getElementById(id);
const socket = io({ transports: ["websocket", "polling"] });
let scene, camera, renderer, clock, localPlayer = null, roomCode = null, roomState = null;
let isPractice = false, jumpVelocity = 0, onGround = true, lastSend = 0, lastToast = "";
const remotes = new Map(), keys = new Set(), move = { x: 0, z: 0 };
const arena = 42;
const world = $("game");
// Declare before animate() runs to avoid a temporal-dead-zone error.
let tornadoGroup = null;
let vehicles = [];
let activeVehicle = null;
let carSpeed = 0;
let vehicleHud = null;

init3D();
animate();

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x91c7e8);
  scene.fog = new THREE.Fog(0x91c7e8, 55, 145);
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 300);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  world.appendChild(renderer.domElement);
  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x59604b, 2.0));
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.5);
  sun.position.set(-25, 45, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  scene.add(sun);

  buildCity();
  setupVehicleControls();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", e => { keys.add(e.code); if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault(); if(e.code==="KeyE" && !activeVehicle){ const near=vehicles.filter(v=>!v.occupied).sort((a,b)=>distanceToPlayer(a)-distanceToPlayer(b))[0]; if(near && distanceToPlayer(near)<13) enterVehicle(near.type); } if(e.code==="Escape" && activeVehicle) exitVehicle(); });
  window.addEventListener("keyup", e => keys.delete(e.code));
  window.addEventListener("keydown", e => { if(e.code === "KeyE" && localPlayer && !activeVehicle){ const nearest=vehicles.slice().sort((a,b)=>distanceToPlayer(a)-distanceToPlayer(b))[0]; if(nearest && distanceToPlayer(nearest)<13) enterVehicle(nearest.type); } if(e.code === "Escape" && activeVehicle) exitVehicle(); });
  $("createBtn").onclick = () => {
    if (!socket.connected) { setNotice("Connecting to server... Please wait and try again."); socket.connect(); return; }
    setNotice("Creating room...");
    socket.emit("createRoom", { name: getName() });
  };
  $("joinBtn").onclick = () => {
    const code = $("roomCode").value.trim().toUpperCase();
    if (!code) { setNotice("Enter the room code first."); $("roomCode").focus(); return; }
    if (!socket.connected) { setNotice("Connecting to server... Please wait and try again."); socket.connect(); return; }
    setNotice("Joining room...");
    socket.emit("joinRoom", { name: getName(), code });
  };
  $("soloBtn").onclick = startPractice;
  $("leaveBtn").onclick = leaveGame;
  $("roomCode").addEventListener("input", () => { $("roomCode").value = $("roomCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,5); });
  $("jump").addEventListener("pointerdown", e => { e.preventDefault(); jump(); });
  setupStick();
}
function mat(color, roughness=0.9) { return new THREE.MeshStandardMaterial({ color, roughness }); }
function box(w,h,d,color,x,y,z, opts={}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color));
  mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true;
  if (opts.parent) opts.parent.add(mesh); else scene.add(mesh);
  return mesh;
}
function buildCity() {
  // Larger, more detailed city: asphalt, sidewalks, marked roads, blocks, parks and landmarks.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220,220), mat(0x71956b));
  ground.rotation.x=-Math.PI/2; ground.position.y=-0.12; ground.receiveShadow=true; scene.add(ground);

  // Main streets and perpendicular streets.
  const roadLines=[-60,-40,-20,0,20,40,60];
  for (const v of roadLines) {
    box(220,0.12,8,0x303943,0,0,v);
    box(8,0.12,220,0x303943,v,0.01,0);
    box(220,0.025,0.18,0xe7dfb7,0,0.075,v);
    box(0.18,0.025,220,0xe7dfb7,v,0.085,0);
    // Sidewalks alongside each road.
    for (const side of [-1,1]) {
      box(220,0.16,1.5,0xb8b9b3,0,0.02,v+side*5.1);
      box(1.5,0.16,220,0xb8b9b3,v+side*5.1,0.03,0);
    }
    // Broken centre lane markings.
    for(let j=-104;j<=104;j+=7){
      box(2.6,0.025,0.16,0xf5f2dc,j,0.09,v);
      box(0.16,0.025,2.6,0xf5f2dc,v,0.10,j);
    }
  }
  // Crosswalks at important intersections.
  for (const v of [-40,0,40]) for (const axis of [-1,1]) {
    for(let k=-3;k<=3;k++){
      box(0.75,0.035,0.34,0xf5f5ed,v+k*0.95,0.11,v+axis*5.4);
      box(0.34,0.035,0.75,0xf5f5ed,v+axis*5.4,0.12,v+k*0.95);
    }
  }

  const buildingColors=[0xd8c8ad,0xc8d5df,0xb5c2cb,0xe1b79a,0xd5d0c4,0x9eafbd,0xe4d6b8,0xbfc9b4];
  for(let gx=-4;gx<=4;gx++) for(let gz=-4;gz<=4;gz++){
    const x=gx*20+10, z=gz*20+10;
    if(Math.abs(x)<15&&Math.abs(z)<15) continue;
    // Leave some blocks for parks and landmark buildings.
    if((gx===2&&gz===-2)||(gx===-2&&gz===2)||(gx===1&&gz===1)) continue;
    const w=7+Math.random()*5, d=7+Math.random()*5, h=5+Math.random()*18;
    const color=buildingColors[Math.floor(Math.random()*buildingColors.length)];
    box(w,h,d,color,x,h/2,z);
    box(w+0.25,0.25,d+0.25,0x59636c,x,h+0.12,z);
    // Front windows and small entrance canopy.
    const winMat=new THREE.MeshStandardMaterial({color:0x8bc5d5,metalness:0.25,roughness:0.3});
    for(let yy=1.8;yy<h-0.7;yy+=2.2) for(let xx=-w/2+1;xx<w/2-0.4;xx+=1.8){
      const win=new THREE.Mesh(new THREE.BoxGeometry(0.75,0.9,0.07),winMat);
      win.position.set(x+xx,yy,z+d/2+0.045); scene.add(win);
    }
    box(Math.min(3,w*.55),0.35,1.0,0x596f83,x,h>7?1.1:0.7,z+d/2+0.55);
  }

  // Public park with paths, trees and a pond.
  const parkX=30, parkZ=-30;
  box(15,0.12,15,0x4f9a59,parkX,0.02,parkZ);
  box(12,0.08,1.4,0xd8c9a5,parkX,0.1,parkZ);
  box(1.4,0.08,12,0xd8c9a5,parkX,0.11,parkZ);
  const pond=new THREE.Mesh(new THREE.CylinderGeometry(2.8,2.8,0.12,32),new THREE.MeshStandardMaterial({color:0x39a9c9,metalness:.25,roughness:.25}));
  pond.position.set(parkX+3,0.12,parkZ+3); scene.add(pond);
  for(const [tx,tz] of [[-5,-5],[-5,5],[5,-5],[5,5],[-1,-6],[6,0]]) addTree(parkX+tx,parkZ+tz,1.0);
  addSign("CITY PARK",parkX,3,parkZ-7,0x12345a);

  // Hospital landmark.
  box(11,8,9,0xe8eef1,-30,4,-30);
  box(11.4,0.45,9.4,0x4d9de5,-30,8.2,-30);
  box(0.7,3.4,0.25,0xe54f55,-30,4.5,-25.35);
  box(3.4,0.7,0.25,0xe54f55,-30,4.5,-25.35);
  addSign("HOSPITAL",-30,10,-30,0x12345a);

  // Fuel station and police station landmarks.
  box(12,0.22,10,0xaaaead,30,0.08,10);
  box(8,0.3,4,0xe8e9e4,30,2,10);
  for(const x of [27,30,33]){
    box(0.45,1.3,0.45,0xe8e9e4,x,0.8,12.8);
    box(0.5,0.12,0.5,0xe74b48,x,1.35,12.8);
  }
  addSign("FUEL",30,4,10,0x12345a);
  box(10,5,8,0xd6dfe5,-30,2.5,30);
  box(10.3,0.35,8.3,0x263e59,-30,5.2,30);
  addSign("POLICE",-30,7,30,0x12345a);

  // Street lights and trees on selected sidewalks.
  for(const v of [-60,-40,-20,0,20,40,60]) for(const side of [-1,1]){
    addStreetLight(v+side*6.2, v===0? -14: v*0.55);
    addStreetLight(v*0.55, v+side*6.2);
  }
  for(let i=0;i<30;i++){
    const x=(i%6)*12-36, z=Math.floor(i/6)*13-26;
    if((Math.abs(x)<15&&Math.abs(z)<15)||(Math.abs(x-parkX)<10&&Math.abs(z-parkZ)<10)) continue;
    addTree(x,z,0.85);
  }

  // Safe evacuation zone.
  const pad=new THREE.Mesh(new THREE.CylinderGeometry(5.5,5.5,0.18,32),mat(0x27c994));
  pad.position.set(28,0.1,28); pad.receiveShadow=true; scene.add(pad);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(5.2,0.16,8,40),new THREE.MeshStandardMaterial({color:0xb9ffe4,emissive:0x146f54}));
  ring.rotation.x=Math.PI/2;ring.position.set(28,0.25,28);scene.add(ring);addSign("SAFE ZONE",28,2.4,28,0x083e34);

  // Drivable taxi and police cars are created directly in the game world.
  createVehicle("taxi",-4,0,Math.PI/2);
  createVehicle("police",4,0,-Math.PI/2);
  createVehicle("taxi",20,20,0);
  createVehicle("police",-20,-20,Math.PI);
}
function addTree(x,z,scale=1){
  box(0.35*scale,1.7*scale,0.35*scale,0x75543a,x,0.85*scale,z);
  const crown=new THREE.Mesh(new THREE.DodecahedronGeometry(1.15*scale,0),mat(0x2e8050));
  crown.position.set(x,2.1*scale,z);crown.castShadow=true;scene.add(crown);
}
function addStreetLight(x,z){
  box(0.16,3.4,0.16,0x424b54,x,1.7,z);
  box(0.9,0.12,0.35,0x303840,x+0.32,3.35,z);
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.48,0.12,0.3),new THREE.MeshStandardMaterial({color:0xfff1b8,emissive:0x5b4d25}));
  lamp.position.set(x+0.52,3.28,z);scene.add(lamp);
}
function createVehicle(type,x,z,rotation=0){
  const g=new THREE.Group();
  const isPolice=type==="police";
  const paint=isPolice?0xf3f5f7:0xf2c928;
  // Chunky, toy-like Roblox-inspired chassis with clear silhouette.
  box(3.8,0.72,1.72,paint,0,0.48,0,{parent:g});
  box(2.1,0.26,1.55,isPolice?0xf4f6f8:0xf2c928,0,-0.02,0,{parent:g});
  box(1.95,0.78,1.34,isPolice?0x172333:0xe5e9ec,-0.18,1.03,-0.03,{parent:g});
  box(0.12,0.72,1.40,isPolice?0x172333:0xe5e9ec,0.82,1.03,-0.03,{parent:g});
  box(0.12,0.72,1.40,isPolice?0x172333:0xe5e9ec,-1.18,1.03,-0.03,{parent:g});
  box(0.9,0.08,1.42,isPolice?0x172333:0x252b31,-0.98,0.18,0,{parent:g});
  box(0.85,0.08,1.42,isPolice?0x172333:0x252b31,1.0,0.18,0,{parent:g});
  // Windows on both sides and windshield.
  box(0.78,0.46,0.055,0x8fd1e6,-0.43,0.72,0.59,{parent:g});
  box(0.78,0.46,0.055,0x8fd1e6,0.43,0.72,0.59,{parent:g});
  box(0.06,0.44,0.78,0x8fd1e6,-0.89,0.72,0,{parent:g});
  box(0.06,0.44,0.78,0x8fd1e6,0.89,0.72,0,{parent:g});
  // Wheels.
  for(const wx of [-1.08,1.08])for(const wz of [-0.83,0.83]){
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.28,10),mat(0x17191d));
    wheel.rotation.z=Math.PI/2;wheel.position.set(wx,0.34,wz);wheel.castShadow=true;g.add(wheel);
  }
  // Thick bumpers and side panels give the cars a recognizable toy-game look.
  box(0.22,0.22,1.82,0x242b33,1.98,0.34,0,{parent:g});
  box(0.22,0.22,1.82,0x242b33,-1.98,0.34,0,{parent:g});
  if(isPolice){
    box(0.12,0.26,1.76,0x2878db,0.05,0.53,0.88,{parent:g});
    box(0.12,0.26,1.76,0x2878db,0.05,0.53,-0.88,{parent:g});
    box(0.08,0.25,1.74,0xffffff,0.05,0.78,0.89,{parent:g});
  }
  // Headlights and rear lights.
  for(const side of [-1,1]){
    box(0.18,0.18,0.08,0xfff0b3,1.76,0.08,side*0.48,{parent:g});
    box(0.18,0.18,0.08,0xe84949,-1.76,0.08,side*0.48,{parent:g});
  }
  if(isPolice){
    box(0.72,0.18,0.28,0x202a37,0,1.08,0,{parent:g});
    box(0.28,0.2,0.24,0x2585ff,-0.2,1.25,0,{parent:g});
    box(0.28,0.2,0.24,0xff3333,0.2,1.25,0,{parent:g});
    box(0.09,0.66,0.04,0x172333,-0.2,0.48,0.79,{parent:g});
    box(0.09,0.66,0.04,0x172333,0.2,0.48,0.79,{parent:g});
  } else {
    box(0.85,0.16,0.42,0xffffff,0,1.1,0,{parent:g});
    addTinyLabel(g,"TAXI",0,1.21,0,0x111111);
    box(0.65,0.3,0.05,0x111111,-0.05,0.32,0.79,{parent:g});
  }
  g.position.set(x,0,z);g.rotation.y=rotation;scene.add(g);
  const car={type,mesh:g,x,z,rotation,speed:0,occupied:false};vehicles.push(car);return car;
}
function addTinyLabel(parent,text,x,y,z,color){
  const c=document.createElement("canvas");c.width=256;c.height=64;const ctx=c.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,256,64);ctx.fillStyle="#111111";ctx.font="bold 40px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,128,34);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.DoubleSide}));m.position.set(x,y,z);parent.add(m);
}
function setupVehicleControls(){
  vehicleHud=document.createElement("div");vehicleHud.id="vehicleControls";
  vehicleHud.style.cssText="position:fixed;right:12px;bottom:138px;z-index:30;display:none;gap:8px;flex-wrap:wrap;width:min(260px,48vw);pointer-events:auto;justify-content:flex-end";
  const makeBtn=(id,label,fn)=>{const b=document.createElement("button");b.id=id;b.textContent=label;b.style.cssText="border:1px solid #ffffff66;border-radius:14px;padding:12px 13px;min-height:44px;background:#101d2df2;color:#fff;font-weight:900;font-size:11px;box-shadow:0 5px 18px #0005;touch-action:manipulation";b.onclick=fn;vehicleHud.appendChild(b);return b;};
  makeBtn("taxiBtn","DRIVE TAXI",()=>enterVehicle("taxi"));
  makeBtn("policeBtn","DRIVE POLICE",()=>enterVehicle("police"));
  const exitBtn=makeBtn("exitCarBtn","EXIT CAR",exitVehicle);
  exitBtn.style.display="none";
  document.body.appendChild(vehicleHud);
}
function enterVehicle(type){
  if(!localPlayer){showToast("Start a practice session or join a room first.");return;}
  if(activeVehicle){showToast("Exit your current car first.");return;}
  let car=vehicles.filter(v=>v.type===type&&!v.occupied).sort((a,b)=>distanceToPlayer(a)-distanceToPlayer(b))[0];
  if(!car){showToast("No available vehicle of this type.");return;}
  if(distanceToPlayer(car)>13){showToast("Move closer to the car first.");return;}
  activeVehicle=car;car.occupied=true;carSpeed=0;localPlayer.visible=false;
  vehicleHud.style.display="flex";$("exitCarBtn").style.display="block";$("jump").style.display="none";
  showToast(type==="taxi"?"Taxi entered · WASD / joystick to drive":"Police car entered · WASD / joystick to drive");
}
function distanceToPlayer(car){return localPlayer?Math.hypot(localPlayer.position.x-car.x,localPlayer.position.z-car.z):Infinity;}
function exitVehicle(){
  if(!activeVehicle)return;
  const car=activeVehicle;car.occupied=false;
  if(localPlayer){localPlayer.visible=true;localPlayer.position.set(car.x+Math.cos(car.rotation)*2,0,car.z-Math.sin(car.rotation)*2);}
  activeVehicle=null;carSpeed=0;vehicleHud.style.display="flex";$("exitCarBtn").style.display="none";$("jump").style.display="";
  showToast("You left the vehicle.");
}
function addSign(text,x,y,z,color) {
  const canvas=document.createElement("canvas");canvas.width=512;canvas.height=128;
  const c=canvas.getContext("2d");c.fillStyle="#10243b";c.fillRect(0,0,512,128);c.fillStyle="#ffffff";c.font="bold 54px sans-serif";c.textAlign="center";c.textBaseline="middle";c.fillText(text,256,66);
  const tex=new THREE.CanvasTexture(canvas);const mesh=new THREE.Mesh(new THREE.PlaneGeometry(7,1.75),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
  mesh.position.set(x,y,z);scene.add(mesh);
}
function makeCharacter(color, name) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9,1.1,0.48), mat(color));
  body.position.y=1.25; body.castShadow=true;group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.68,0.68,0.68),mat(0xffd2a3));
  head.position.y=2.15;head.castShadow=true;group.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.2,0.7),mat(0x3b2a24));hair.position.y=2.55;group.add(hair);
  const legs=[];
  for(const side of [-1,1]){
    const leg=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.78,0.38),mat(0x273b5b));
    leg.position.set(side*0.24,0.39,0);leg.castShadow=true;group.add(leg);legs.push(leg);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.82,0.32),mat(color));
    arm.position.set(side*0.62,1.35,0);arm.castShadow=true;group.add(arm);
  }
  const labelCanvas=document.createElement("canvas");labelCanvas.width=512;labelCanvas.height=96;
  const ctx=labelCanvas.getContext("2d");ctx.fillStyle="#07111ddd";ctx.fillRect(0,0,512,96);ctx.fillStyle="#ffffff";ctx.font="bold 42px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(name||"Player").slice(0,16),256,48);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(2.4,0.45),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(labelCanvas),transparent:true,side:THREE.DoubleSide,depthWrite:false}));
  label.position.y=3.0;group.add(label);
  group.userData={legs};
  return group;
}
function getName(){return $("playerName").value.trim().slice(0,16)||"Player";}
function startPractice(){
  isPractice=true; roomCode="PRACTICE"; $("lobby").style.display="none"; $("hud").style.display="block";
  if(vehicleHud) vehicleHud.style.display="flex";
  if(!localPlayer){localPlayer=makeCharacter(0xff5b5b,getName());scene.add(localPlayer);localPlayer.position.set(0,0,0);}
  $("codeBadge").textContent="PRACTICE"; if(vehicleHud) vehicleHud.style.display="flex";
  $("statusText").innerHTML="<strong>Practice mode</strong><br>Join a friend for online multiplayer.";
  showToast("Practice mode: online play requires a room.");
}
function leaveGame(){
  if(activeVehicle) exitVehicle();
  if(!isPractice) socket.emit("leaveRoom");
  isPractice=false;roomCode=null;roomState=null;
  $("hud").style.display="none";$("lobby").style.display="grid";if(vehicleHud)vehicleHud.style.display="none";
  if(localPlayer){scene.remove(localPlayer);localPlayer=null;}
  for(const [id,obj] of remotes){scene.remove(obj.mesh);remotes.delete(id);}
}
function joined(code){
  isPractice=false;roomCode=code;$("lobby").style.display="none";$("hud").style.display="block";$("codeBadge").textContent=code;
  if(vehicleHud) vehicleHud.style.display="flex";
  if(!localPlayer){localPlayer=makeCharacter(0xff5b5b,getName());scene.add(localPlayer);}
  showToast("Room "+code+" connected. Share this code with your friend.");
}
socket.on("connect",()=>setNotice("Online server connected."));
socket.on("connect_error",()=>setNotice("Could not connect to game server. Refresh and try again."));
socket.on("roomCreated",data=>{joined(data.code);$("roomCode").value=data.code;});
socket.on("roomJoined",data=>joined(data.code));
socket.on("errorMessage",msg=>setNotice(msg));
socket.on("roomState",state=>{
  roomState=state;
  if(state.code) {roomCode=state.code;$("codeBadge").textContent=state.code;}
  updateRemotePlayers(state.players||[]);
  const seconds=Math.ceil((state.remainingMs||0)/1000);
  const phaseText=state.phase==="lobby"?"Waiting for players":state.phase==="prep"?"Disaster in "+seconds+"s":state.phase==="playing"?"SURVIVE · "+seconds+"s":state.phase==="results"?"Round over":"Connected";
  $("statusText").innerHTML="<strong>"+escapeHtml(phaseText)+"</strong><br>"+escapeHtml(state.message||"");
  renderPlayers(state.players||[]);
  if(state.disaster && state.disaster.active) updateTornado(state.disaster);
  else removeTornado();
  if(state.phase==="lobby" && state.players.length>=2 && !document.getElementById("startRoundBtn")){
    const b=document.createElement("button");b.id="startRoundBtn";b.textContent="START ROUND";b.className="primary";b.style.cssText="position:absolute;left:50%;top:calc(50% + 55px);transform:translateX(-50%);pointer-events:auto;z-index:4";b.onclick=()=>socket.emit("startGame");$("hud").appendChild(b);
  }
  if(state.phase!=="lobby"){const b=$("startRoundBtn");if(b)b.remove();}
});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setNotice(msg){$("notice").textContent=msg;}
function showToast(msg){const el=$("toast");el.textContent=msg;el.style.display="block";lastToast=msg;setTimeout(()=>{if(el.textContent===msg)el.style.display="none";},3500);}
function renderPlayers(players){
  $("players").innerHTML=players.map(p=>`<div class="player-row"><span class="dot" style="background:${p.color}"></span><span>${escapeHtml(p.name)}${p.id===socket.id?" (you)":""}</span><span style="margin-left:auto;color:${p.alive?"#6ee7b7":"#ff7777"}">${p.alive?"●":"×"}</span></div>`).join("");
}
function updateRemotePlayers(players){
  const ids=new Set(players.filter(p=>p.id!==socket.id).map(p=>p.id));
  for(const [id,obj] of remotes)if(!ids.has(id)){scene.remove(obj.mesh);remotes.delete(id);}
  for(const p of players){
    if(p.id===socket.id){
      if(localPlayer){localPlayer.position.x=p.x;localPlayer.position.z=p.z;}
      continue;
    }
    let obj=remotes.get(p.id);
    if(!obj){const mesh=makeCharacter(p.color,p.name);scene.add(mesh);obj={mesh,target:new THREE.Vector3(p.x,0,p.z)};remotes.set(p.id,obj);}
    obj.target.set(p.x,0,p.z);obj.mesh.userData.alive=p.alive;
    obj.mesh.visible=true;
  }
}
function updateTornado(d){
  if(!tornadoGroup){
    tornadoGroup=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(0.5,3.2,8,12,1,true),new THREE.MeshStandardMaterial({color:0x9ca3af,transparent:true,opacity:.55,side:THREE.DoubleSide,roughness:1}));
    base.position.y=4;tornadoGroup.add(base);
    for(let i=0;i<4;i++){
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1+i*.42,.13,6,24),new THREE.MeshStandardMaterial({color:0x697586,transparent:true,opacity:.8}));
      ring.rotation.x=Math.PI/2;ring.position.y=1.1+i*1.65;tornadoGroup.add(ring);
    }
    scene.add(tornadoGroup);
  }
  tornadoGroup.position.set(d.x,0,d.z);
}
function removeTornado(){if(tornadoGroup){scene.remove(tornadoGroup);tornadoGroup=null;}}
function setupStick(){
  const stick=$("stick"),knob=$("knob");let active=false,origin=null;
  const reset=()=>{active=false;move.x=0;move.z=0;knob.style.left="34px";knob.style.top="34px";};
  stick.addEventListener("pointerdown",e=>{e.preventDefault();active=true;const r=stick.getBoundingClientRect();origin={x:r.left+r.width/2,y:r.top+r.height/2};if(stick.setPointerCapture)stick.setPointerCapture(e.pointerId);moveStick(e);});
  function moveStick(e){if(!active||!origin)return;let dx=e.clientX-origin.x,dy=e.clientY-origin.y;const len=Math.hypot(dx,dy),max=34;if(len>max){dx=dx/len*max;dy=dy/len*max;}knob.style.left=(34+dx)+"px";knob.style.top=(34+dy)+"px";move.x=dx/max;move.z=dy/max;}
  stick.addEventListener("pointermove",moveStick);
  stick.addEventListener("pointerup",reset);stick.addEventListener("pointercancel",reset);
}
function jump(){if(onGround){jumpVelocity=7.5;onGround=false;}}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),0.05);
  if(localPlayer){
    let mx=move.x, mz=move.z;
    if(keys.has("KeyA")||keys.has("ArrowLeft"))mx-=1;
    if(keys.has("KeyD")||keys.has("ArrowRight"))mx+=1;
    if(keys.has("KeyW")||keys.has("ArrowUp"))mz-=1;
    if(keys.has("KeyS")||keys.has("ArrowDown"))mz+=1;
    if(keys.has("Space"))jump();
    const len=Math.hypot(mx,mz);if(len>1){mx/=len;mz/=len;}
    if(!roomState || roomState.phase==="playing" || roomState.phase==="lobby" || roomState.phase==="prep" || isPractice){
      if(activeVehicle){
        // Vehicle steering and acceleration; the same position packets keep existing rooms compatible.
        const forwardInput=-mz;
        carSpeed += forwardInput * (activeVehicle.type==="police"?17:13) * dt;
        carSpeed *= Math.pow(0.985,dt*60);
        carSpeed=THREE.MathUtils.clamp(carSpeed,-7,activeVehicle.type==="police"?18:14);
        if(Math.abs(mx)>.05) activeVehicle.rotation += mx*dt*(0.65+Math.abs(carSpeed)*0.035)*Math.sign(carSpeed||1);
        activeVehicle.x += Math.sin(activeVehicle.rotation)*carSpeed*dt;
        activeVehicle.z += Math.cos(activeVehicle.rotation)*carSpeed*dt;
        activeVehicle.x=THREE.MathUtils.clamp(activeVehicle.x,-arena,arena);
        activeVehicle.z=THREE.MathUtils.clamp(activeVehicle.z,-arena,arena);
        activeVehicle.mesh.position.set(activeVehicle.x,0,activeVehicle.z);
        activeVehicle.mesh.rotation.y=activeVehicle.rotation;
        localPlayer.position.set(activeVehicle.x,0,activeVehicle.z);
      } else {
        localPlayer.position.x=THREE.MathUtils.clamp(localPlayer.position.x+mx*8*dt,-arena,arena);
        localPlayer.position.z=THREE.MathUtils.clamp(localPlayer.position.z+mz*8*dt,-arena,arena);
        if(len>.1)localPlayer.rotation.y=Math.atan2(mx,mz);
        jumpVelocity-=18*dt;localPlayer.position.y+=jumpVelocity*dt;
        if(localPlayer.position.y<0){localPlayer.position.y=0;jumpVelocity=0;onGround=true;}
        const t=clock.elapsedTime;if(localPlayer.userData.legs)localPlayer.userData.legs.forEach((leg,i)=>{leg.rotation.x=len>.1?Math.sin(t*11+i*Math.PI)*.55:0;});
      }
      const now=performance.now();if(!isPractice && roomCode && now-lastSend>70){socket.emit("playerMove",{x:localPlayer.position.x,z:localPlayer.position.z});lastSend=now;}
    }
    const focus=activeVehicle?activeVehicle.mesh:localPlayer;
    const camOffset=activeVehicle?new THREE.Vector3(Math.sin(activeVehicle.rotation)*-9,5.8,Math.cos(activeVehicle.rotation)*-9):new THREE.Vector3(0,7.5,11);
    const desiredCamera=new THREE.Vector3(focus.position.x+camOffset.x,focus.position.y+camOffset.y,focus.position.z+camOffset.z);
    camera.position.lerp(desiredCamera,activeVehicle?0.09:0.12);
    camera.lookAt(focus.position.x,focus.position.y+(activeVehicle?1.2:1.1),focus.position.z);
  } else {
    camera.position.lerp(new THREE.Vector3(0,26,34),0.025);camera.lookAt(0,0,0);
  }
  for(const obj of remotes.values()){
    obj.mesh.position.lerp(obj.target,0.22);
    obj.mesh.rotation.y=Math.atan2(obj.target.x-obj.mesh.position.x,obj.target.z-obj.mesh.position.z)||obj.mesh.rotation.y;
    if(obj.mesh.userData.legs)obj.mesh.userData.legs.forEach(leg=>leg.rotation.x=Math.sin(clock.elapsedTime*8)*.12);
  }
  if(tornadoGroup){tornadoGroup.rotation.y+=dt*1.7;tornadoGroup.children.slice(1).forEach((r,i)=>r.rotation.z+=dt*(i%2?1:-1)*1.5);}
  renderer.render(scene,camera);
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
