# rtswar

A real-time strategy war simulation built with Node.js, Socket.IO, and Three.js.

A 120×120 cellular-automata grid where players place support camps, deploy unit compositions, and watch automated combat play out tick by tick in a 3D isometric view.

## Setup

```bash
npm install
```

## Running

```bash
npm start
```

Then open your browser at [http://localhost:3000](http://localhost:3000).

For development with auto-reload:

```bash
npm run dev
```

## Usage

1. **Place a camp** — Enter X/Y coordinates and click **Place Camp**. Camps supply nearby cells.
2. **Deploy units** — Enter X/Y coordinates, set infantry/tanks/artillery counts, and click **Deploy**.
3. **Start simulation** — Click **Start Simulation**. The server runs at 6 ticks per second; cell colors and heights update in real time.
4. **Request snapshot** — Click **Snapshot** at any time to resync the full grid state.

## Project Structure

```
client/      ← Browser-side Three.js renderer and Socket.IO client
server/      ← Node.js server (Express + Socket.IO) and simulation engine
package.json
```
