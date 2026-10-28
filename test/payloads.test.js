'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePotPayload,
  parseLedState,
  normalizeCommand,
} = require('../lib/payloads');

test('parsePotPayload acepta un número plano y calcula el porcentaje', () => {
  assert.deepEqual(parsePotPayload('2048', 4095), {
    ok: true,
    value: 2048,
    percent: 50,
  });
});

test('parsePotPayload acepta el máximo del ADC', () => {
  assert.deepEqual(parsePotPayload('4095', 4095), {
    ok: true,
    value: 4095,
    percent: 100,
  });
});

test('parsePotPayload acepta JSON con la clave valor', () => {
  assert.deepEqual(parsePotPayload('{"valor":1024}', 4095), {
    ok: true,
    value: 1024,
    percent: 25,
  });
});

test('parsePotPayload acepta JSON con valor numérico en texto', () => {
  assert.deepEqual(parsePotPayload('{"value":"2048"}', 4095), {
    ok: true,
    value: 2048,
    percent: 50,
  });
});

test('parsePotPayload acepta coma decimal', () => {
  assert.equal(parsePotPayload('2048,5', 4095).ok, true);
  assert.equal(parsePotPayload('2048,5', 4095).value, 2048.5);
});

test('parsePotPayload rechaza valores fuera de rango', () => {
  assert.deepEqual(parsePotPayload('5000', 4095), {
    ok: false,
    reason: 'out_of_range',
    value: 5000,
  });
  assert.equal(parsePotPayload('-1', 4095).reason, 'out_of_range');
});

test('parsePotPayload rechaza formatos no válidos', () => {
  for (const payload of ['', '   ', 'abc', '{}', '{"valor":null}', '[2048]', 'null']) {
    assert.equal(parsePotPayload(payload, 4095).ok, false, payload);
  }
});

test('parsePotPayload rechaza cargas demasiado grandes', () => {
  assert.equal(parsePotPayload('1'.repeat(300), 4095).ok, false);
});

test('parseLedState acepta ON y OFF sin distinguir mayúsculas en telemetría', () => {
  assert.equal(parseLedState('ON'), 'ON');
  assert.equal(parseLedState(' off '), 'OFF');
  assert.equal(parseLedState('{"estado":"on"}'), 'ON');
  assert.equal(parseLedState('{"state":"OFF"}'), 'OFF');
});

test('parseLedState rechaza valores que no son ON u OFF', () => {
  for (const payload of ['', 'true', '1', 'ONOFF', '{"estado":true}', '{}']) {
    assert.equal(parseLedState(payload), null, payload);
  }
});

test('normalizeCommand aplica validación estricta para el endpoint', () => {
  assert.equal(normalizeCommand('ON'), 'ON');
  assert.equal(normalizeCommand('OFF'), 'OFF');
  assert.equal(normalizeCommand(' ON '), 'ON');
  assert.equal(normalizeCommand('on'), null);
  assert.equal(normalizeCommand('Off'), null);
  assert.equal(normalizeCommand('ON '), 'ON');
  assert.equal(normalizeCommand('TRUE'), null);
  assert.equal(normalizeCommand(1), null);
  assert.equal(normalizeCommand(null), null);
});
