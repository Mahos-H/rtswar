// client/main.js
const socket = io();

// UI references
const playerIdEl = document.getElementById('playerId');
const phaseEl = document.getElementById('phase');
const tickEl = document.getElementById('tick');
const btnSnapshot = document.getElementById('btnSnapshot');
const btnStart = document.getElementById('btnStart');
const btnPlaceCamp = document.getElementById('btnPlaceCamp');
const btnDeploy = document.getElementById('btnDeploy');

let playerId = null;
let gridSize = 120;
let phase = 'setup';
let cellsMap = new Map(); // key "x,y" => cell DTO

// THREE.js scene
let scene, camera, renderer, instancedMesh, controls;
let tileCount;
let instanceIndexFromXY; // mapping x,y -> instance index

// color palette for owners (assign dynamically)
const ownerColors = {}; // owner -> THREE.Color
const neutralColor = new THREE.Color(0.35, 0.35, 0.38);

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
  applyFullToInstances(snapshot.cells);
  if (snapshot.camps) renderCamps(snapshot.camps);
});

socket.on('phase', data => {
  phase = data.phase;
  phaseEl.textContent = phase;
});

socket.on('stateDelta', data => {
  // data: {tick, deltas: [cellDTO, ...]}
  if (data.tick !== undefined) tickEl.textContent = data.tick;
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
  const frustumSize = gridSize * 1.2;

  camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    2000
  );

  // Good stable 2.5D position
  camera.position.set(gridSize * 0.7, gridSize * 0.8, gridSize * 0.7);
  camera.lookAt(0, 0, 0);

  // OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.target.set(0, 0, 0);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  };
  controls.update();

  // Lighting
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(gridSize * 0.5, gridSize, gridSize * 0.3);
  scene.add(light);
  scene.add(new THREE.HemisphereLight(0xccccff, 0x444422, 0.6));
  scene.add(new THREE.AmbientLight(0x808080));

  // === GRID TILES ===

  const tileSize = 1;
  const geometry = new THREE.BoxGeometry(tileSize, 1, tileSize);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.1
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

      instancedMesh.instanceColor.setXYZ(index, 0.3, 0.3, 0.33);

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
    const hash = Array.from(owner).reduce((s, c) => s + c.charCodeAt(0), 0);
    const hue = (hash * 137.508) % 360; // golden angle for well-distributed hues
    const color = new THREE.Color();
    color.setHSL(hue / 360, 0.8, 0.55);
    ownerColors[owner] = color;
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
    const color = ownerColor(c.owner);
    instancedMesh.instanceColor.setXYZ(idx, color.r, color.g, color.b);
    const height = Math.max(0.1, Math.min(3.0, c.strength / 20));
    dummy.position.set(c.x - gridSize / 2, height / 2, c.y - gridSize / 2);
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
  if (controls) controls.update();
  renderer.render(scene, camera);
}

// Camp markers
let campMarkers = [];
const campMarkerGeo = new THREE.ConeGeometry(0.8, 2.5, 6);

function renderCamps(camps) {
  for (const m of campMarkers) scene.remove(m);
  campMarkers = [];
  for (const camp of camps) {
    const color = ownerColor(camp.owner);
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5
    });
    const marker = new THREE.Mesh(campMarkerGeo, mat);
    marker.position.set(camp.x - gridSize / 2, 3, camp.y - gridSize / 2);
    scene.add(marker);
    campMarkers.push(marker);
  }
}

// handle window resize
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  const aspect = width / height;
  const frustumSize = gridSize * 1.2;
  camera.left = frustumSize * aspect / -2;
  camera.right = frustumSize * aspect / 2;
  camera.top = frustumSize / 2;
  camera.bottom = frustumSize / -2;
  camera.updateProjectionMatrix();
});