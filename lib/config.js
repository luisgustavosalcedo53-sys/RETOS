'use strict';

const fs = require('node:fs');
const os = require('node:os');

/**
 * Convierte variables de entorno en una configuración validada.
 * No se leen credenciales desde la URL de MQTT: usuario y contraseña
 * deben llegar por MQTT_USERNAME y MQTT_PASSWORD.
 */
function loadConfig(env = process.env) {
  const warnings = [];
  const nodeEnv = (env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';

  const port = readInt(env, 'PORT', 3000, 1, 65535);
  const host = readString(env, 'HOST', '0.0.0.0');
  if (!host) {
    fail('HOST no puede estar vacío.');
  }
  if (isProduction && host === '0.0.0.0') {
    warnings.push(
      'HOST=0.0.0.0 expone Express en todas las interfaces. Restringe el puerto 3000 en el Security Group a tu IP o usa Nginx con HOST=127.0.0.1.'
    );
  }

  const trustProxy = readBool(env, 'TRUST_PROXY', false);
  const enableHsts = readBool(env, 'ENABLE_HSTS', false);
  if (enableHsts && !trustProxy) {
    warnings.push(
      'ENABLE_HSTS está activo pero TRUST_PROXY está desactivado. Actívalo solo detrás de Nginx con HTTPS.'
    );
  }

  // ---------------------------------------------------------
  // Broker MQTT
  // ---------------------------------------------------------
  const mqttUrlRaw = readString(env, 'MQTT_URL', 'mqtt://127.0.0.1:1883');
  let mqttUrl;
  try {
    mqttUrl = new URL(mqttUrlRaw);
  } catch {
    fail('MQTT_URL no es una URL válida. Ejemplo: mqtt://127.0.0.1:1883');
  }

  if (!['mqtt:', 'mqtts:'].includes(mqttUrl.protocol)) {
    fail('MQTT_URL debe usar mqtt:// (1883) o mqtts:// (8883).');
  }
  if (mqttUrl.username || mqttUrl.password) {
    fail(
      'MQTT_URL no debe incluir usuario ni contraseña. Usa MQTT_USERNAME y MQTT_PASSWORD.'
    );
  }
  if (!mqttUrl.hostname) {
    fail('MQTT_URL debe incluir un host, por ejemplo mqtt://127.0.0.1:1883');
  }
  if ((mqttUrl.pathname && mqttUrl.pathname !== '/') || mqttUrl.search || mqttUrl.hash) {
    fail('MQTT_URL no debe incluir ruta, parámetros ni fragmentos.');
  }

  const mqttTls = mqttUrl.protocol === 'mqtts:';
  const mqttPort = mqttUrl.port || (mqttTls ? '8883' : '1883');
  const displayHost = mqttUrl.hostname.startsWith('[')
    ? mqttUrl.hostname
    : mqttUrl.hostname.includes(':')
      ? `[${mqttUrl.hostname}]`
      : mqttUrl.hostname;

  const mqttUsername = readString(env, 'MQTT_USERNAME', '');
  const mqttPassword = env.MQTT_PASSWORD === undefined ? '' : String(env.MQTT_PASSWORD);
  if ((mqttUsername && !mqttPassword) || (!mqttUsername && mqttPassword)) {
    fail('MQTT_USERNAME y MQTT_PASSWORD deben configurarse juntos.');
  }
  if (isProduction && !mqttUsername) {
    fail(
      'En producción MQTT_USERNAME y MQTT_PASSWORD son obligatorios. El broker no debe permitir acceso anónimo.'
    );
  }
  if (mqttUsername && mqttPassword.length < 12) {
    warnings.push(
      'La contraseña MQTT tiene menos de 12 caracteres. Usa una contraseña larga y única.'
    );
  }

  const mqttClientId =
    readString(env, 'MQTT_CLIENT_ID', '') || defaultClientId();
  if (mqttClientId.length > 128 || mqttClientId.includes('\u0000')) {
    fail('MQTT_CLIENT_ID no es válido (máximo 128 caracteres, sin nulos).');
  }

  const potTopic = readTopic(
    env,
    'MQTT_TOPIC_POT',
    'casa/potenciometro'
  );
  const ledTopic = readTopic(env, 'MQTT_TOPIC_LED', 'casa/led');

  // Un valor vacío desactiva la suscripción al estado confirmado del LED.
  const ledStateTopicRaw =
    env.MQTT_TOPIC_LED_STATE === undefined
      ? 'casa/led/estado'
      : String(env.MQTT_TOPIC_LED_STATE).trim();
  const ledStateTopic =
    ledStateTopicRaw === ''
      ? null
      : readTopic(env, 'MQTT_TOPIC_LED_STATE', 'casa/led/estado');

  if (potTopic === ledTopic) {
    fail('MQTT_TOPIC_POT y MQTT_TOPIC_LED deben ser tópicos distintos.');
  }
  if (ledStateTopic && (ledStateTopic === potTopic || ledStateTopic === ledTopic)) {
    fail(
      'MQTT_TOPIC_LED_STATE debe ser distinto de los tópicos de lectura y control.'
    );
  }

  const mqttQos = readInt(env, 'MQTT_QOS', 1, 0, 2);
  const mqttRetainLed = readBool(env, 'MQTT_RETAIN_LED', true);
  const mqttReconnectPeriodMs = readInt(
    env,
    'MQTT_RECONNECT_PERIOD_MS',
    5000,
    1000,
    60000
  );
  const mqttConnectTimeoutMs = readInt(
    env,
    'MQTT_CONNECT_TIMEOUT_MS',
    10000,
    1000,
    60000
  );
  const mqttRejectUnauthorized = readBool(
    env,
    'MQTT_REJECT_UNAUTHORIZED',
    true
  );
  if (mqttTls && !mqttRejectUnauthorized) {
    warnings.push(
      'MQTT_REJECT_UNAUTHORIZED=false desactiva la validación del certificado TLS. No lo uses en producción.'
    );
  }

  const caFile = readString(env, 'MQTT_CA_FILE', '');
  let mqttCa = null;
  if (caFile) {
    if (!mqttTls) {
      fail('MQTT_CA_FILE solo se puede usar con MQTT_URL=mqtts://...');
    }
    try {
      mqttCa = fs.readFileSync(caFile);
    } catch (error) {
      fail(
        `No se pudo leer MQTT_CA_FILE (${error.code || 'error'}). Revisa la ruta y los permisos.`
      );
    }
    if (mqttCa.length > 1024 * 1024) {
      fail('MQTT_CA_FILE es demasiado grande (máximo 1 MB).');
    }
  }

  const ledAckTimeoutMs = readInt(
    env,
    'MQTT_LED_ACK_TIMEOUT_MS',
    8000,
    2000,
    60000
  );

  // ---------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------
  const potMax = readInt(env, 'POT_MAX', 4095, 1, 1000000);
  const staleAfterMs = readInt(env, 'STALE_AFTER_MS', 15000, 2000, 3600000);
  const historySize = readInt(env, 'HISTORY_SIZE', 60, 10, 500);
  const readingEventIntervalMs = readInt(
    env,
    'READING_EVENT_INTERVAL_MS',
    30000,
    5000,
    600000
  );

  return {
    nodeEnv,
    isProduction,
    warnings,
    server: {
      host,
      port,
      trustProxy,
      enableHsts,
    },
    mqtt: {
      url: mqttUrlRaw,
      displayBroker: `${displayHost}:${mqttPort}`,
      tls: mqttTls,
      username: mqttUsername,
      password: mqttPassword,
      clientId: mqttClientId,
      potTopic,
      ledTopic,
      ledStateTopic,
      qos: mqttQos,
      retainLed: mqttRetainLed,
      reconnectPeriodMs: mqttReconnectPeriodMs,
      connectTimeoutMs: mqttConnectTimeoutMs,
      rejectUnauthorized: mqttRejectUnauthorized,
      ca: mqttCa,
      ledAckTimeoutMs,
    },
    pot: {
      max: potMax,
      staleAfterMs,
    },
    historySize,
    readingEventIntervalMs,
  };
}

function defaultClientId() {
  const host =
    os
      .hostname()
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 24) || 'host';
  return `iot-dash-${host}-${process.pid}`.slice(0, 64);
}

function readString(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
}

function readInt(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function readBool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') {
    return fallback;
  }
  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí'].includes(value)) {
    return true;
  }
  if (['false', '0', 'no'].includes(value)) {
    return false;
  }
  fail(`${name} debe ser true o false.`);
}

function readTopic(env, name, fallback) {
  const value = readString(env, name, fallback);
  if (!value) {
    fail(`${name} no puede estar vacío.`);
  }
  if (value.length > 65535) {
    fail(`${name} supera el máximo de 65535 caracteres.`);
  }
  if (value.includes('\u0000')) {
    fail(`${name} no puede contener caracteres nulos.`);
  }
  if (/[+#]/.test(value)) {
    fail(
      `${name} no puede contener comodines + o #. Debe ser un tópico concreto.`
    );
  }
  return value;
}

function fail(message) {
  throw new Error(message);
}

module.exports = { loadConfig };
