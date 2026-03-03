// client/main.js
const socket = io();

// UI references
const playerIdEl = document.getElementById('playerId');
const phaseEl = document.getElementById('phase');
const btnSnapshot = document.getElementById('btnSnapshot');
const btnStart = document.getElementById('btnStart');
const btnPlaceCamp = document.getElementById('btnPlaceCamp');
const btnDeploy = document.getElementById('btnDeploy');

let playerId = null;
let gridSize = 120;
let phase = 'setup';
let cellsMap = new Map(); // key "x,y" => cell DTO

// THREE.js scene
let scene, camera, renderer, instancedMesh;
let tileCount;
let instanceIndexFromXY; // mapping x,y -> instance index

// color palette for owners (assign dynamically)
const ownerColors = {}; // owner -> THREE.Color
const neutralColor = new THREE.Color(0.25,0.25,0.25);

// When server welcomes us
socket.on('welcome', data => {
  playerId = data.playerId;
  playerIdEl.textContent = playerId;
  gridSize = data.gridSize || 120;
  phase = data.phase || 'setup';
  phaseEl.textContent = phase;
  initThree();
  // request snapshot
  socket.emit('requestSnapshot');
});

socket.on('snapshot', snapshot => {
  phase = snapshot.phase || 'setup';
  phaseEl.textContent = phase;
  // initialize local map
  cellsMap.clear();
  for (const c of snapshot.cells) {
    const key = `${c.x},${c.y}`;
    cellsMap.set(key, c);
  }
  // camps ignored for renderer for now
  applyFullToInstances(snapshot.cells);
});

socket.on('phase', data => {
  phase = data.phase;
  phaseEl.textContent = phase;
});

socket.on('stateDelta', data => {
  // data: {tick, deltas: [cellDTO, ...]}
  for (const c of data.deltas) {
    const key = `${c.x},${c.y}`;
    cellsMap.set(key, c);
  }
  applyDeltasToInstances(data.deltas);
});

btnSnapshot.onclick = () => socket.emit('requestSnapshot');
btnStart.onclick = () => socket.emit('startSimulation');

btnPlaceCamp.onclick = () => {
  const x = parseInt(document.getElementById('campX').value,10);
  const y = parseInt(document.getElementById('campY').value,10);
  socket.emit('placeCamp', { x, y });
};

btnDeploy.onclick = () => {
  const x = parseInt(document.getElementById('depX').value,10);
  const y = parseInt(document.getElementById('depY').value,10);
  const composition = {
    infantry: parseInt(document.getElementById('inf').value,10) || 0,
    tanks: parseInt(document.getElementById('tks').value,10) || 0,
    artillery: parseInt(document.getElementById('art').value,10) || 0
  };
  socket.emit('deploy', { x, y, composition });
};

// --- THREE.js setup ---
function initThree() {
  const container = document.getElementById('canvasContainer');
  const width = window.innerWidth;
  const height = window.innerHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  // Orthographic camera
  const aspect = width / height;
  const frustumSize = gridSize;

  camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    1000
  );

  // Good stable 2.5D position
  camera.position.set(gridSize * 0.7, gridSize * 0.8, gridSize * 0.7);
  camera.lookAt(0, 0, 0);

  // Lighting
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1, 2, 1);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x404040));

  // === GRID TILES ===

  const tileSize = 1;
  const geometry = new THREE.BoxGeometry(tileSize, 1, tileSize);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: false
  });

  tileCount = gridSize * gridSize;
  instancedMesh = new THREE.InstancedMesh(geometry, material, tileCount);

  instanceIndexFromXY = new Map();

  const dummy = new THREE.Object3D();
  const colors = new Float32Array(tileCount * 3);
  instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

  let index = 0;

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      dummy.position.set(
        x - gridSize / 2,
        0,
        y - gridSize / 2
      );
      dummy.scale.set(1, 0.1, 1); // very thin initial height
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(index, dummy.matrix);

      instancedMesh.instanceColor.setXYZ(index, 0.2, 0.2, 0.2);

      instanceIndexFromXY.set(`${x},${y}`, index);
      index++;
    }
  }

  scene.add(instancedMesh);

  animate();
}
// Convert an owner string to color
function ownerColor(owner) {
  if (!owner) return neutralColor;
  if (!ownerColors[owner]) {
    // generate color deterministically from owner id
    const hash = Array.from(owner).reduce((s,c)=>s + c.charCodeAt(0), 0);
    const r = ((hash * 97) % 200) / 255;
    const g = ((hash * 53) % 200) / 255;
    const b = ((hash * 79) % 200) / 255;
    ownerColors[owner] = new THREE.Color(r,g,b);
  }
  return ownerColors[owner];
}

function applyFullToInstances(cells) {
  // cells is array of DTOs
  const dummy = new THREE.Object3D();
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    const idx = instanceIndexFromXY.get(key);
    if (idx === undefined) continue;
    // set color by owner (use supply/morale to tint)
    const color = ownerColor(c.owner);
    instancedMesh.instanceColor.setXYZ(idx, color.r, color.g, color.b);
    // set height based on strength (map strength to 0.1..3.0)
    const height = Math.max(0.1, Math.min(3.0, c.strength / 20));
    // update matrix
    const px = c.x - gridSize / 2;
    const pz = c.y - gridSize / 2;
    dummy.position.set(px, height / 2, pz);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(idx, dummy.matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;
  instancedMesh.instanceColor.needsUpdate = true;
}

function applyDeltasToInstances(deltas) {
  const dummy = new THREE.Object3D();

  for (const c of deltas) {
    const key = `${c.x},${c.y}`;
    const idx = instanceIndexFromXY.get(key);
    if (idx === undefined) continue;

    const height = Math.max(0.05, c.strength / 20);

    dummy.position.set(
      c.x - gridSize / 2,
      height / 2,
      c.y - gridSize / 2
    );

    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();

    instancedMesh.setMatrixAt(idx, dummy.matrix);

    const color = ownerColor(c.owner);
    instancedMesh.instanceColor.setXYZ(
      idx,
      color.r,
      color.g,
      color.b
    );
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  instancedMesh.instanceColor.needsUpdate = true;
}

// simple render loop
function animate() {
  requestAnimationFrame(animate);
  // small rotation for "camera orbit" feel (optional)
  // renderer.render(scene, camera);
  renderer.render(scene, camera);
}

// handle window resize
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  const aspect = width / height;
  const frustumSize = gridSize;
  camera.left = frustumSize * aspect / -2;
  camera.right = frustumSize * aspect / 2;
  camera.top = frustumSize / 2;
  camera.bottom = frustumSize / -2;
  camera.updateProjectionMatrix();
});