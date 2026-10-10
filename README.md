# DISASTER CITY — v1

A browser-based 3D multiplayer disaster-survival prototype.

## Included
- Three.js low-poly/blocky city and player characters
- Create a room / join with a five-character room code
- Server-hosted player positions and round state using Socket.IO
- One disaster: a moving tornado
- Keyboard controls and mobile on-screen joystick + jump
- Railway-ready Node.js server

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000 in two browser windows/devices on the same machine for a first test.

## Deploy to Railway
1. Upload the contents of this folder to your GitHub repository, preserving `public/index.html` and `public/game.js`.
2. Railway: deploy the GitHub repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Settings → Networking → Generate Domain.
6. Open the public URL in two devices/browsers.

## Important v1 limitations
- This is a prototype. It has one tornado disaster and basic block-city geometry.
- It does not yet persist accounts, stats, or cosmetics.
- Room state is stored in memory, so restarting the service clears rooms.
- Multiplayer uses server-reported positions but does not yet have full anti-cheat/authoritative movement physics.
- Three.js is loaded from a CDN, so the browser needs internet access.
