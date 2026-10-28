'use strict';

require('dotenv').config({ quiet: true });

const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

const express = require('express');
const helmet = require('helmet');
const mqtt = require('mqtt');
const { Server } = require('socket.io');

const { loadConfig } = require('./lib/config');
const {
  parsePotPayload,
  parseLedState,
  normalizeCommand,
} = require('./lib/payloads');
const { buildSubscriptions } = require('./lib/subscriptions');

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[config] ${error.message}`);
  process.exit(1);
}

// -------------------------------------------------------------------------
// Aplicación HTTP
// -------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 100000,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', config.isProduction);
app.set('trust proxy', config.server.trustProxy ? 1 : false);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': null,
      },
    },
    hsts: config.server.enableHsts
      ? { maxAge: 15552000, includeSubDomains: false }
      : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  })
);

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: config.isProduction ? '1h' : 0,
    index: false,
  })
);

// -------------------------------------------------------------------------
// Estado en memoria
// -------------------------------------------------------------------------
const runtime = {
  startedAt: Date.now(),
  mqtt: {
    status: 'connecting',
    since: null,
    lastError: null,
  },
  pot: {
    value: null,
    percent: null,
    at: null,
    stale: false,
    count: 0,
  },
  led: {
    state: 'UNKNOWN',
    confirmed: false,
    at: null,
    source: null,
  },
  history: [],
  events: [],
  lastReadingEventAt: 0,
  lastInvalidPotEventAt: 0,
  lastInvalidLedEventAt: 0,
  lastMqttErrorEventAt: 0,
  lastMqttErrorLogAt: 0,
};

const eventDedupe = new Map();
const numberFormat = new Intl.NumberFormat('es-PE', {
  maximumFractionDigits: 1,
});
const controlHits = new Map();

let mqttClient = null;
let ledAckTimer = null;
let staleTimer = null;
let shuttingDown = false;

// -------------------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------------------
function log(level, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function sanitizeError(error) {
  const text =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);
  return text
    .replace(/\b(mqtts?|wss?):\/\/[^@\s/]+@/gi, '$1://***@')
    .replace(/password=[^&\s]+/gi, 'password=***')
    .slice(0, 300);
}

function pushEvent(level, message, dedupeMs = 5000) {
  const key = `${level}:${message}`;
  const now = Date.now();
  const previous = eventDedupe.get(key);
  if (previous && now - previous < dedupeMs) {
    return;
  }
  eventDedupe.set(key, now);
  if (eventDedupe.size > 150) {
    for (const [entry, at] of eventDedupe) {
      if (now - at > 60000) {
        eventDedupe.delete(entry);
      }
    }
  }

  const event = {
    id: crypto.randomUUID(),
    at: now,
    level,
    message,
  };
  runtime.events.unshift(event);
  if (runtime.events.length > 50) {
    runtime.events.length = 50;
  }
  io.emit('event:log', event);
  log(level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info', message);
}

function mqttStatusPayload() {
  return {
    connected: runtime.mqtt.status === 'connected',
    status: runtime.mqtt.status,
    since: runtime.mqtt.since,
    broker: config.mqtt.displayBroker,
    tls: config.mqtt.tls,
    lastError: runtime.mqtt.lastError,
  };
}

function ledPayload() {
  return {
    state: runtime.led.state,
    confirmed: runtime.led.confirmed,
    at: runtime.led.at,
    source: runtime.led.source,
  };
}

function potPayload() {
  return {
    value: runtime.pot.value,
    percent: runtime.pot.percent,
    at: runtime.pot.at,
    stale: runtime.pot.stale,
    count: runtime.pot.count,
  };
}

function buildSnapshot() {
  return {
    serverTime: Date.now(),
    startedAt: runtime.startedAt,
    uptimeMs: Date.now() - runtime.startedAt,
    mqtt: mqttStatusPayload(),
    pot: potPayload(),
    led: ledPayload(),
    history: runtime.history.slice(),
    events: runtime.events.slice(),
    config: {
      potMax: config.pot.max,
      staleAfterMs: config.pot.staleAfterMs,
      historySize: config.historySize,
      qos: config.mqtt.qos,
      retainLed: config.mqtt.retainLed,
      topics: {
        pot: config.mqtt.potTopic,
        led: config.mqtt.ledTopic,
        ledState: config.mqtt.ledStateTopic,
      },
    },
  };
}

function setMqttStatus(status, { since = runtime.mqtt.since } = {}) {
  if (runtime.mqtt.status === status && runtime.mqtt.since === since) {
    return;
  }
  runtime.mqtt.status = status;
  runtime.mqtt.since = since;
  io.emit('mqtt:status', mqttStatusPayload());
}

function allowControlRequest(key) {
  const now = Date.now();
  const windowMs = 10000;
  const maxRequests = 15;
  const recent = (controlHits.get(key) || []).filter((at) => now - at < windowMs);
  if (recent.length >= maxRequests) {
    controlHits.set(key, recent);
    return false;
  }
  recent.push(now);
  controlHits.set(key, recent);
  if (controlHits.size > 500) {
    for (const [entry, stamps] of controlHits) {
      if (!stamps.some((at) => now - at < windowMs)) {
        controlHits.delete(entry);
      }
    }
  }
  return true;
}

// -------------------------------------------------------------------------
// MQTT
// -------------------------------------------------------------------------
function startMqtt() {
  const options = {
    clientId: config.mqtt.clientId,
    protocolVersion: 4,
    clean: true,
    keepalive: 30,
    reconnectPeriod: config.mqtt.reconnectPeriodMs,
    connectTimeout: config.mqtt.connectTimeoutMs,
    rejectUnauthorized: config.mqtt.rejectUnauthorized,
  };
  if (config.mqtt.username) {
    options.username = config.mqtt.username;
  }
  if (config.mqtt.password) {
    options.password = config.mqtt.password;
  }
  if (config.mqtt.ca) {
    options.ca = config.mqtt.ca;
  }

  mqttClient = mqtt.connect(config.mqtt.url, options);

  mqttClient.on('connect', () => {
    const wasConnected = runtime.mqtt.status === 'connected';
    runtime.mqtt.lastError = null;
    setMqttStatus('connected', { since: Date.now() });
    if (!wasConnected) {
      pushEvent('success', 'Conectado al broker MQTT.');
    }

    const topics = buildSubscriptions({
      potTopic: config.mqtt.potTopic,
      ledStateTopic: config.mqtt.ledStateTopic,
      qos: config.mqtt.qos,
    });
    const topicNames = Object.keys(topics);

    mqttClient.subscribe(topics, (error, granted) => {
      if (error) {
        pushEvent(
          'error',
          `No se pudo suscribir a los tópicos MQTT: ${sanitizeError(error)}`
        );
        return;
      }
      const rejected = (granted || []).filter((item) => item.qos === 128);
      if (rejected.length > 0) {
        pushEvent(
          'error',
          `Suscripción rechazada por el broker: ${rejected
            .map((item) => item.topic)
            .join(', ')}. Revisa la ACL.`
        );
      } else {
        pushEvent(
          'info',
          `Suscripción activa: ${topicNames.join(', ')}.`
        );
      }
    });
  });

  mqttClient.on('reconnect', () => {
    if (runtime.mqtt.status !== 'reconnecting') {
      setMqttStatus('reconnecting');
      pushEvent(
        'warn',
        'Reintentando la conexión con el broker MQTT…',
        10000
      );
    }
  });

  mqttClient.on('offline', () => {
    // Si ya estamos en una secuencia de reconexión, se mantiene ese estado
    // para evitar que el aviso parpadee en cada intento fallido.
    if (runtime.mqtt.status !== 'reconnecting' && runtime.mqtt.status !== 'disconnected') {
      setMqttStatus('disconnected');
      pushEvent('warn', 'El cliente MQTT quedó sin conexión.', 10000);
    }
  });

  mqttClient.on('close', () => {
    if (shuttingDown) {
      return;
    }
    if (runtime.mqtt.status !== 'reconnecting' && runtime.mqtt.status !== 'disconnected') {
      setMqttStatus('disconnected');
      pushEvent('warn', 'Conexión MQTT cerrada. Se intentará reconectar.', 10000);
    }
  });

  mqttClient.on('error', (error) => {
    const safeMessage = sanitizeError(error);
    runtime.mqtt.lastError = safeMessage;
    if (runtime.mqtt.status !== 'reconnecting') {
      setMqttStatus('disconnected');
    }
    const now = Date.now();
    if (now - runtime.lastMqttErrorLogAt > 30000) {
      runtime.lastMqttErrorLogAt = now;
      log('error', `Error MQTT: ${safeMessage}`);
    }
    if (now - runtime.lastMqttErrorEventAt > 15000) {
      runtime.lastMqttErrorEventAt = now;
      pushEvent(
        'error',
        `Error de conexión MQTT: ${safeMessage}`,
        15000
      );
    }
  });

  mqttClient.on('message', (topic, payload) => {
    const text = payload.toString('utf8');
    if (topic === config.mqtt.potTopic) {
      handlePotMessage(text);
      return;
    }
    if (config.mqtt.ledStateTopic && topic === config.mqtt.ledStateTopic) {
      handleLedStateMessage(text);
    }
  });
}

function handlePotMessage(text) {
  const result = parsePotPayload(text, config.pot.max);
  if (!result.ok) {
    const now = Date.now();
    if (now - runtime.lastInvalidPotEventAt > 10000) {
      runtime.lastInvalidPotEventAt = now;
      const message =
        result.reason === 'out_of_range'
          ? `Lectura fuera del rango 0-${config.pot.max} ignorada.`
          : 'Lectura ignorada: el potenciómetro envió un formato no válido.';
      pushEvent('warn', message, 10000);
    }
    return;
  }

  const now = Date.now();
  const wasStale = runtime.pot.stale;
  runtime.pot.value = result.value;
  runtime.pot.percent = result.percent;
  runtime.pot.at = now;
  runtime.pot.stale = false;
  runtime.pot.count += 1;

  runtime.history.push({
    value: result.value,
    percent: result.percent,
    at: now,
  });
  if (runtime.history.length > config.historySize) {
    runtime.history.splice(0, runtime.history.length - config.historySize);
  }

  io.emit('pot:update', potPayload());

  if (wasStale) {
    io.emit('pot:stale', { stale: false, lastAt: now });
    pushEvent('success', 'Se restablecieron las lecturas del potenciómetro.');
  }

  if (now - runtime.lastReadingEventAt >= config.readingEventIntervalMs) {
    runtime.lastReadingEventAt = now;
    pushEvent(
      'info',
      `Lectura recibida: ${numberFormat.format(result.value)} (${numberFormat.format(
        result.percent
      )} %).`,
      config.readingEventIntervalMs
    );
  }
}

function handleLedStateMessage(text) {
  const nextState = parseLedState(text);
  if (!nextState) {
    const now = Date.now();
    if (now - runtime.lastInvalidLedEventAt > 10000) {
      runtime.lastInvalidLedEventAt = now;
      pushEvent(
        'warn',
        'Estado de LED ignorado: se esperaba ON u OFF.',
        10000
      );
    }
    return;
  }

  const changed =
    runtime.led.state !== nextState || !runtime.led.confirmed;
  runtime.led.state = nextState;
  runtime.led.confirmed = true;
  runtime.led.at = Date.now();
  runtime.led.source = 'device';
  clearTimeout(ledAckTimer);
  ledAckTimer = null;

  io.emit('led:state', ledPayload());
  if (changed) {
    pushEvent('success', `El dispositivo confirmó LED ${nextState}.`);
  }
}

function publishLedCommand(command) {
  return new Promise((resolve, reject) => {
    if (!mqttClient || !mqttClient.connected) {
      const error = new Error('Broker MQTT desconectado.');
      error.code = 'MQTT_OFFLINE';
      reject(error);
      return;
    }

    const publishedAt = Date.now();
    mqttClient.publish(
      config.mqtt.ledTopic,
      command,
      { qos: config.mqtt.qos, retain: config.mqtt.retainLed },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        const alreadyConfirmed =
          runtime.led.confirmed &&
          runtime.led.state === command &&
          runtime.led.at !== null &&
          runtime.led.at >= publishedAt;

        if (!alreadyConfirmed) {
          runtime.led.state = command;
          runtime.led.confirmed = false;
          runtime.led.at = Date.now();
          runtime.led.source = 'dashboard';
          io.emit('led:state', ledPayload());
          scheduleAckTimeout(command);
        }

        pushEvent(
          'info',
          `Orden ${command} publicada en ${config.mqtt.ledTopic}.`,
          3000
        );
        resolve();
      }
    );
  });
}

function scheduleAckTimeout(command) {
  clearTimeout(ledAckTimer);
  ledAckTimer = null;
  if (!config.mqtt.ledStateTopic) {
    return;
  }

  ledAckTimer = setTimeout(() => {
    if (runtime.led.state === command && !runtime.led.confirmed) {
      io.emit('led:state', ledPayload());
      io.emit('led:ack-timeout', { command, at: Date.now() });
      pushEvent(
        'warn',
        `Sin confirmación del ESP32 para LED ${command}. Revisa el tópico ${config.mqtt.ledStateTopic}.`,
        10000
      );
    }
  }, config.mqtt.ledAckTimeoutMs);
  ledAckTimer.unref();
}

function evaluateStale() {
  const now = Date.now();
  let stale = false;

  if (runtime.pot.at !== null) {
    stale = now - runtime.pot.at > config.pot.staleAfterMs;
  } else if (runtime.mqtt.status === 'connected') {
    stale = now - runtime.startedAt > config.pot.staleAfterMs;
  }

  if (stale === runtime.pot.stale) {
    return;
  }

  runtime.pot.stale = stale;
  io.emit('pot:stale', { stale, lastAt: runtime.pot.at });
  if (stale) {
    pushEvent(
      'warn',
      runtime.pot.at === null
        ? 'Todavía no se han recibido lecturas del potenciómetro.'
        : `Sin lecturas desde hace ${Math.round(
            (now - runtime.pot.at) / 1000
          )} s.`,
      15000
    );
  }
}

// -------------------------------------------------------------------------
// Rutas HTTP
// -------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Panel IoT · Potenciómetro y LED',
    year: new Date().getFullYear(),
  });
});

app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(buildSnapshot());
});

app.post('/api/led', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!allowControlRequest(req.ip || 'desconocido')) {
    res.set('Retry-After', '10');
    res.status(429).json({
      ok: false,
      error: 'Demasiadas órdenes seguidas. Espera unos segundos e inténtalo de nuevo.',
    });
    return;
  }

  const command = normalizeCommand(req.body && req.body.command);
  if (!command) {
    res.status(400).json({
      ok: false,
      error: 'Comando inválido. El servidor solo acepta exactamente "ON" u "OFF".',
    });
    return;
  }

  if (!mqttClient || !mqttClient.connected) {
    res.status(503).json({
      ok: false,
      error: 'El broker MQTT no está conectado. La orden no se envió.',
    });
    return;
  }

  try {
    await publishLedCommand(command);
    res.json({
      ok: true,
      command,
      at: Date.now(),
      topic: config.mqtt.ledTopic,
    });
  } catch (error) {
    log('error', `No se pudo publicar la orden LED: ${sanitizeError(error)}`);
    res.status(502).json({
      ok: false,
      error: 'No se pudo publicar la orden en el broker MQTT. Revisa la conexión.',
    });
  }
});

app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: runtime.mqtt.status === 'connected' ? 'ok' : 'degraded',
    mqtt: {
      connected: runtime.mqtt.status === 'connected',
      status: runtime.mqtt.status,
    },
    pot: {
      hasReading: runtime.pot.at !== null,
      stale: runtime.pot.stale,
      lastReadingAt: runtime.pot.at,
    },
    uptimeMs: Date.now() - runtime.startedAt,
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ ok: false, error: 'Ruta no encontrada.' });
    return;
  }
  res.status(404).render('error', {
    title: 'Página no encontrada',
    status: 404,
    message: 'La página que buscas no existe o cambió de lugar.',
    year: new Date().getFullYear(),
  });
});

// -------------------------------------------------------------------------
// WebSocket
// -------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('state:init', buildSnapshot());
  socket.emit('mqtt:status', mqttStatusPayload());
});

// -------------------------------------------------------------------------
// Manejo de errores
// -------------------------------------------------------------------------
app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const isBodyError =
    error.type === 'entity.parse.failed' || error.type === 'entity.too.large';
  const status = isBodyError ? error.status || 400 : error.status || 500;
  const wantsJson =
    req.path.startsWith('/api/') ||
    (req.get('accept') || '').includes('application/json');

  if (!isBodyError && status >= 500) {
    log('error', `Error HTTP no controlado: ${sanitizeError(error)}`);
  }

  if (wantsJson) {
    res.status(status).json({
      ok: false,
      error: isBodyError
        ? 'El cuerpo de la petición no es JSON válido o es demasiado grande.'
        : 'Error interno del servidor.',
    });
    return;
  }

  res.status(status).render('error', {
    title: status === 500 ? 'Error interno' : 'Solicitud no válida',
    status,
    message:
      status === 500
        ? 'Ocurrió un error inesperado. Revisa los registros del servidor.'
        : 'La solicitud no se pudo procesar.',
    year: new Date().getFullYear(),
  });
});

// -------------------------------------------------------------------------
// Arranque y cierre ordenado
// -------------------------------------------------------------------------
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log(
      'error',
      `El puerto ${config.server.port} ya está en uso. Detén el otro proceso o cambia PORT.`
    );
  } else {
    log('error', `Error del servidor HTTP: ${sanitizeError(error)}`);
  }
  process.exit(1);
});

// HOST y PORT provienen de process.env (dotenv), validados en lib/config.js.
server.listen(config.server.port, config.server.host, () => {
  log(
    'info',
    `Panel IoT disponible en http://${config.server.host}:${config.server.port}`
  );
  log(
    'info',
    `Broker MQTT: ${config.mqtt.tls ? 'mqtts' : 'mqtt'}://${config.mqtt.displayBroker} · autenticación: ${
      config.mqtt.username ? 'habilitada' : 'deshabilitada (solo desarrollo)'
    }`
  );
  log(
    'info',
    `Tópicos: lecturas=${config.mqtt.potTopic} · control=${config.mqtt.ledTopic}${
      config.mqtt.ledStateTopic
        ? ` · estado=${config.mqtt.ledStateTopic}`
        : ' · confirmación desactivada'
    }`
  );
  for (const warning of config.warnings) {
    log('warn', warning);
  }
  if (!config.mqtt.username) {
    log(
      'warn',
      'MQTT sin usuario configurado. En el servidor público usa autenticación y ACL.'
    );
  }

  startMqtt();
  staleTimer = setInterval(evaluateStale, 2000);
  staleTimer.unref();
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log('info', `Señal ${signal} recibida. Cerrando el panel…`);

  clearInterval(staleTimer);
  clearTimeout(ledAckTimer);
  io.emit('server:shutdown', {
    message: 'El servidor se está deteniendo. Reconectando…',
  });

  const forceTimer = setTimeout(() => {
    log('warn', 'Cierre forzado tras esperar 10 segundos.');
    process.exit(1);
  }, 10000);

  io.close(() => {
    if (!mqttClient) {
      clearTimeout(forceTimer);
      process.exit(0);
      return;
    }
    mqttClient.end(false, {}, () => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
    setTimeout(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    }, 4000).unref();
  });

  // Libera conexiones HTTP keep-alive que no son de Socket.IO.
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log('error', `Promesa rechazada sin manejar: ${sanitizeError(reason)}`);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (error) => {
  log('error', `Excepción no controlada: ${sanitizeError(error)}`);
  shutdown('uncaughtException');
});

module.exports = { app, server, io };
