// server/simulation.js
const EventEmitter = require('events');

class Simulation extends EventEmitter {
  constructor({ gridSize = 120, tickRate = 6 } = {}) {
    super();

    this.gridSize = gridSize;
    this.tickRate = tickRate;
    this.phase = 'setup';

    this.cells = [];
    this.camps = [];
    this.nextCampId = 1;

    this.params = {
      unitWeights: { infantry: 1, tanks: 4, artillery: 6 },
      supplyDecayPerCell: 2,
      baseCampSupply: 80,
      reinforcementShare: 0.05,
      attritionPerTick: 0.002,
      moraleLossPerNoSupply: 0.5,
      moraleGainPerSupply: 0.1,
      collapseThreshold: 5,
      minStrengthAfterFlip: 5,
      maxSupply: 100,
      maxMorale: 200
    };

    this._initGrid();
  }

  _initGrid() {
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        this.cells.push({
          x,
          y,
          owner: null,
          composition: { infantry: 0, tanks: 0, artillery: 0 },
          strength: 0,
          morale: 100,
          supply: 0,
          terrain: 'plains'
        });
      }
    }
  }

  _index(x, y) {
    return y * this.gridSize + x;
  }

  getCell(x, y) {
    if (x < 0 || y < 0 || x >= this.gridSize || y >= this.gridSize)
      return null;
    return this.cells[this._index(x, y)];
  }

  _computeStrength(comp) {
    const w = this.params.unitWeights;
    return (
      comp.infantry * w.infantry +
      comp.tanks * w.tanks +
      comp.artillery * w.artillery
    );
  }

  addCamp({ owner, x, y }) {
    this.camps.push({
      id: this.nextCampId++,
      owner,
      x,
      y,
      supplyRate: this.params.baseCampSupply,
      radius: 30
    });
  }

  deployComposition(owner, x, y, comp) {
    const cell = this.getCell(x, y);
    if (!cell) return;

    cell.owner = owner;
    cell.composition = {
      infantry: comp.infantry || 0,
      tanks: comp.tanks || 0,
      artillery: comp.artillery || 0
    };

    cell.strength = this._computeStrength(cell.composition);
    cell.morale = 100;
    cell.supply = 100;
  }

  start() {
    if (this.phase !== 'setup') return;
    this.phase = 'running';
    this.interval = setInterval(() => this._tick(), 1000 / this.tickRate);
  }

  _tick() {
    const newCells = JSON.parse(JSON.stringify(this.cells));

    // === SUPPLY CALCULATION ===
    for (const cell of newCells) {
      cell.supply = 0;
    }

    for (const camp of this.camps) {
      for (const cell of newCells) {
        const dist =
          Math.abs(cell.x - camp.x) +
          Math.abs(cell.y - camp.y);

        if (dist <= camp.radius) {
          const supply =
            camp.supplyRate -
            dist * this.params.supplyDecayPerCell;

          if (
            cell.owner === camp.owner &&
            supply > cell.supply
          ) {
            cell.supply = Math.min(
              this.params.maxSupply,
              supply
            );
          }
        }
      }
    }

    // === COMBAT PHASE ===
    for (const cell of newCells) {
      if (!cell.owner) continue;

      const neighbors = [
        this.getCell(cell.x + 1, cell.y),
        this.getCell(cell.x - 1, cell.y),
        this.getCell(cell.x, cell.y + 1),
        this.getCell(cell.x, cell.y - 1)
      ].filter(Boolean);

      const enemies = neighbors.filter(
        n => n.owner && n.owner !== cell.owner
      );

      if (enemies.length === 0) continue;

      const supplyFactor = cell.supply / 100;
      const moraleFactor = cell.morale / 100;

      const attack =
        this._computeStrength(cell.composition) *
        0.3 *
        supplyFactor *
        moraleFactor;

      for (const enemy of enemies) {
        const idx = this._index(enemy.x, enemy.y);
        newCells[idx].strength -= attack / enemies.length;
      }
    }

    // === MORALE + COLLAPSE ===
    for (const cell of newCells) {
      if (cell.supply <= 0)
        cell.morale -= this.params.moraleLossPerNoSupply;
      else
        cell.morale +=
          cell.supply * this.params.moraleGainPerSupply * 0.001;

      cell.morale = Math.max(
        0,
        Math.min(this.params.maxMorale, cell.morale)
      );

      if (cell.strength <= this.params.collapseThreshold) {
        cell.owner = null;
        cell.composition = { infantry: 0, tanks: 0, artillery: 0 };
        cell.strength = 0;
      }
    }

    this.cells = newCells;
    this.emit('delta', {
      deltas: this.cells
    });
  }

  getSnapshot() {
    return {
      gridSize: this.gridSize,
      phase: this.phase,
      cells: this.cells,
      camps: this.camps
    };
  }
}

module.exports = Simulation;