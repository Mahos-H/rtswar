// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Simulation = require('./simulation');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve client files
app.use(express.static(path.join(__dirname, '..', 'client')));

const PORT = process.env.PORT || 3000;

// Create simulation
const sim = new Simulation({
  gridSize: 120,      // 120x120 grid
  tickRate: 6         // ticks per second; adjust for perf (6 TPS default)
});

// Simple in-memory players map
let nextPlayerId = 1;

// Socket events
io.on('connection', socket => {
  const playerId = 'P' + nextPlayerId++;
  console.log('connect', playerId);

  // Send initial info
  socket.emit('welcome', { playerId, gridSize: sim.gridSize, phase: sim.phase });

  // New players get the full snapshot
  socket.on('requestSnapshot', () => {
    socket.emit('snapshot', sim.getSnapshot());
  });

  // Place support camp during setup
  socket.on('placeCamp', data => {
    // data: {x, y}
    if (sim.phase !== 'setup') return;
    const x = parseInt(data.x, 10);
    const y = parseInt(data.y, 10);
    if (isNaN(x) || isNaN(y) || x < 0 || y < 0 || x >= sim.gridSize || y >= sim.gridSize) return;
    sim.addCamp({ owner: playerId, x, y });
    io.emit('snapshot', sim.getSnapshot()); // broadcast the updated snapshot
  });

  // Deploy composition to a cell during setup
  socket.on('deploy', data => {
    // data: {x, y, composition: {infantry, tanks, artillery}}
    if (sim.phase !== 'setup') return;
    const x = parseInt(data.x, 10);
    const y = parseInt(data.y, 10);
    if (isNaN(x) || isNaN(y) || x < 0 || y < 0 || x >= sim.gridSize || y >= sim.gridSize) return;
    const comp = data.composition || {};
    const infantry = Number(comp.infantry);
    const tanks = Number(comp.tanks);
    const artillery = Number(comp.artillery);
    if (isNaN(infantry) || isNaN(tanks) || isNaN(artillery)) return;
    if (infantry < 0 || tanks < 0 || artillery < 0) return;
    sim.deployComposition(playerId, x, y, { infantry, tanks, artillery });
    io.emit('snapshot', sim.getSnapshot());
  });

  // Host starts simulation (any player can call it in this prototype)
  socket.on('startSimulation', () => {
    if (sim.phase === 'setup') {
      sim.start();
      io.emit('phase', { phase: sim.phase });
    }
  });

  // Client asks for phase change
  socket.on('getPhase', () => {
    socket.emit('phase', { phase: sim.phase });
  });

  // Sync tick deltas to clients
  const deltaListener = (delta) => {
    socket.emit('stateDelta', delta);
  };

  sim.on('delta', deltaListener);

  socket.on('disconnect', () => {
    sim.off('delta',deltaListener);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Open the web client and place camps, deploy, then start simulation.');
});