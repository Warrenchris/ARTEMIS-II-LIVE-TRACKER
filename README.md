# Artemis II — Real-Time Mission Tracker

A production-grade NASA-style mission control dashboard that visualizes the **Artemis II Orion spacecraft** traveling from Earth to the Moon in real time.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, Framer Motion |
| 3D Visualization | Three.js, React Three Fiber, @react-three/drei |
| Backend | Node.js, Express.js, Socket.IO, Helmet |
| Telemetry | Axios, satellite.js |

---

## Project Structure

```
NASA/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── scene/       # 3D components
│   │   │   │   ├── Earth.jsx        # Textured Earth with atmosphere
│   │   │   │   ├── Moon.jsx         # Textured Moon
│   │   │   │   ├── Spacecraft.jsx   # Multi-mesh Orion capsule
│   │   │   │   ├── Trajectory.jsx   # Bezier arc trajectory
│   │   │   │   └── SpaceScene.jsx   # Canvas + scene assembly
│   │   │   ├── ui/          # Dashboard UI panels
│   │   │   │   ├── TelemetryDashboard.jsx
│   │   │   │   ├── MissionTimeline.jsx
│   │   │   │   └── MissionInfo.jsx
│   │   │   ├── ErrorBoundary.jsx    # Recoverable crash screen
│   │   │   └── LoadingScreen.jsx    # Boot animation
│   │   ├── contexts/
│   │   │   └── TelemetryContext.jsx # Socket.IO data provider
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css       # Tailwind v4 @theme tokens
│   ├── .env.example
│   └── package.json
│
└── server/                  # Node.js backend
    ├── services/
    │   └── telemetry.js     # API polling + simulation fallback
    ├── index.js             # Express + Socket.IO entry
    ├── .env.example
    └── package.json
```

---

## Quick Start

### 1. Install dependencies

```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

### 2. Configure environment

```bash
# Backend
cp server/.env.example server/.env
# Edit server/.env — add NASA_API_URL when available

# Frontend
cp client/.env.example client/.env
# VITE_API_URL defaults to http://localhost:4000
```

### 3. Run in development

**Terminal 1 — Backend:**
```bash
cd server
npm run dev       # uses nodemon for hot-reload
```

**Terminal 2 — Frontend:**
```bash
cd client
npm run dev       # starts on http://localhost:5173
```

### 4. Production build

```bash
cd client
npm run build     # outputs to client/dist/
npm run preview   # preview the production build locally
```

---

## API Integration

When your spacecraft telemetry API is ready, edit `server/.env`:

```env
NASA_API_URL=https://api.yourprovider.com/artemis2/telemetry
NASA_API_KEY=your_api_key_here
TELEMETRY_POLL_INTERVAL_MS=5000
```

The backend will automatically start polling. If the API fails 3 consecutive times, it falls back to physiсs-based simulation and sets `telemetryHealth: "DEGRADED"` so the UI can alert operators.

The normalizer in `server/services/telemetry.js` maps your API's field names to the canonical shape:
```javascript
function normaliseTelemetry(raw) { ... }
```
Customize this to match your telemetry provider's response format.

---

## Deployment

### Frontend → Vercel

```bash
# In Vercel dashboard:
# Root Directory: client
# Build Command:  npm run build
# Output Dir:     dist

# Add environment variable:
# VITE_API_URL = https://your-backend.onrender.com
```

### Backend → Render

```bash
# In Render dashboard:
# Root Directory: server
# Start Command:  npm start

# Add environment variables:
# PORT = (Render sets this automatically)
# CLIENT_URL = https://your-app.vercel.app
# NASA_API_URL = (your endpoint)
```

---

## 3D Scene Controls

| Action | Control |
|---|---|
| Rotate | Click + Drag |
| Zoom | Scroll Wheel |
| Pan | Right-click + Drag |

---

## Features

- ✅ Real-time telemetry via Socket.IO (2–5s updates)
- ✅ 3D Earth with real NASA textures, atmospheric glow
- ✅ 3D Moon with lunar surface texture
- ✅ Multi-mesh Orion spacecraft model with animated engine glow
- ✅ QuadraticBezierCurve3 translunar injection arc
- ✅ Animated telemetry counters with smooth interpolation
- ✅ Mission Timeline with 8-phase enum state machine
- ✅ Connection state machine: CONNECTING → SYNCED → OFFLINE
- ✅ NASA-style cinematic loading screen with boot sequence
- ✅ ErrorBoundary preventing blank-screen crashes
- ✅ Comms latency display (round-trip light delay)
- ✅ Helmet.js security headers
- ✅ CORS restricted to CLIENT_URL
- ✅ API fallback simulation on failure
- ✅ Production build passing (`npm run build`)
- ✅ Deployable to Vercel + Render
