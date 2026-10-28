'use strict';

const MAX_PAYLOAD_BYTES = 256;

/**
 * Acepta un número plano ("2048") o un objeto JSON con una de estas claves:
 * valor, value, lectura, pot, potenciometro, raw.
 * Devuelve { ok: true, value, percent } o { ok: false, reason }.
 */
function parsePotPayload(input, potMax = 4095) {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'invalid' };
  }

  const text = input.trim();
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: 'invalid' };
  }

  let candidate = text;
  if (text.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'invalid' };
    }

    const keys = ['valor', 'value', 'lectura', 'pot', 'potenciometro', 'raw'];
    let found = false;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        candidate = data[key];
        found = true;
        break;
      }
    }
    if (!found) {
      return { ok: false, reason: 'invalid' };
    }
  }

  if (typeof candidate !== 'number' && typeof candidate !== 'string') {
    return { ok: false, reason: 'invalid' };
  }

  if (typeof candidate === 'string') {
    candidate = candidate.trim().replace(',', '.');
    if (!candidate) {
      return { ok: false, reason: 'invalid' };
    }
  }

  const value = Number(candidate);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'invalid' };
  }
  if (value < 0 || value > potMax) {
    return { ok: false, reason: 'out_of_range', value };
  }

  const roundedValue = Math.round(value * 10) / 10;
  const percent = Math.round((roundedValue / potMax) * 1000) / 10;
  return { ok: true, value: roundedValue, percent };
}

/**
 * El ESP32 puede confirmar el estado con "ON"/"OFF" o con un JSON
 * como {"estado":"ON"}. La telemetría sí se acepta sin distinguir mayúsculas.
 */
function parseLedState(input) {
  if (typeof input !== 'string') {
    return null;
  }

  let text = input.trim();
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) {
    return null;
  }

  if (text.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const keys = ['estado', 'state', 'led', 'valor'];
    let found = false;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        text = String(data[key]);
        found = true;
        break;
      }
    }
    if (!found) {
      return null;
    }
  }

  const normalized = text.trim().toUpperCase();
  return normalized === 'ON' || normalized === 'OFF' ? normalized : null;
}

/**
 * Validación estricta para el endpoint de control: solo "ON" u "OFF".
 * Se permiten espacios alrededor, pero no minúsculas ni otros valores.
 */
function normalizeCommand(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === 'ON' || trimmed === 'OFF' ? trimmed : null;
}

module.exports = {
  MAX_PAYLOAD_BYTES,
  parsePotPayload,
  parseLedState,
  normalizeCommand,
};
