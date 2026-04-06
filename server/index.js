'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const helmet  = require('helmet');
require('dotenv').config();

const { startTelemetryStream } = require('./services/telemetry');
const logger = require('./utils/logger');

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT       = parseInt(process.env.PORT, 10) || 4000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Domains that need to be reachable from the browser for telemetry assets /
// NASA imagery CDN — used to build the Content-Security-Policy header.
const NASA_DOMAINS = [
  'https://www.nasa.gov',
  'https://eyes.nasa.gov',
  'https://raw.githubusercontent.com',  // Three.js texture CDN used by Earth/Moon
];

// ─── Express App ──────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

// ─── Helmet — security headers ────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        connectSrc:  ["'self'", CLIENT_URL, 'wss:', ...NASA_DOMAINS],
        imgSrc:      ["'self'", 'data:', ...NASA_DOMAINS],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Prevent MIME-type sniffing
    noSniff: true,
    // Block framing from unknown origins
    frameguard: { action: 'deny' },
    // Hide Express fingerprint
    hidePoweredBy: true,
    // HSTS: enforce HTTPS for 1 year in production
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  })
);

// ─── CORS — restricted to CLIENT_URL ─────────────────────────────────────────

const corsOptions = {
  origin: (origin, cb) => {
    // Allow same-origin requests (origin === undefined) and the declared client
    if (!origin || origin === CLIENT_URL) return cb(null, true);
    logger.warn('CORS blocked request', { origin, allowed: CLIENT_URL });
    cb(new Error(`CORS policy: origin ${origin} is not allowed`));
  },
  methods: ['GET'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '64kb' }));

// ─── Socket.IO ────────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  },
  // Reduce polling overhead — prefer WebSocket
  transports: ['websocket', 'polling'],
  pingInterval: 10_000,
  pingTimeout:  5_000,
});

io.on('connection', (socket) => {
  logger.info('WebSocket client connected', { id: socket.id, ip: socket.handshake.address });

  socket.on('disconnect', (reason) => {
    logger.info('WebSocket client disconnected', { id: socket.id, reason });
  });

  socket.on('error', (err) => {
    logger.error('WebSocket socket error', { id: socket.id, error: err.message });
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'Artemis II Telemetry Server',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
  });
});

// Catch-all for undefined routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Express error handler (must have 4 params)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Express error handler', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

// Handle EADDRINUSE *before* calling listen so it never reaches uncaughtException
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      `Port ${PORT} is already in use. Kill the existing process first:\n` +
      `  Windows : netstat -ano | findstr :${PORT}  (note PID, then: taskkill /PID <PID> /F)\n` +
      `  All OSes: npx kill-port ${PORT}`,
      { code: err.code, port: PORT },
    );
  } else {
    logger.error('Server error', { code: err.code, error: err.message });
  }
  process.exit(1);
});

// Only start the telemetry polling after the TCP port is confirmed bound.
// This prevents zombie setInterval handles if listen() fails.
server.listen(PORT, () => {
  logger.info('Server listening', { port: PORT, clientUrl: CLIENT_URL, env: process.env.NODE_ENV || 'development' });
  startTelemetryStream(io);
});

// Handle any remaining uncaught errors so the process doesn't silently crash
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
