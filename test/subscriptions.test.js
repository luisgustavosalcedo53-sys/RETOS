'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSubscriptions } = require('../lib/subscriptions');

test('buildSubscriptions devuelve un mapa topico -> { qos }', () => {
  const subscriptions = buildSubscriptions({
    potTopic: 'casa/potenciometro',
    ledStateTopic: 'casa/led/estado',
    qos: 1,
  });

  assert.deepEqual(subscriptions, {
    'casa/potenciometro': { qos: 1 },
    'casa/led/estado': { qos: 1 },
  });
  for (const value of Object.values(subscriptions)) {
    assert.equal(typeof value, 'object');
    assert.equal(typeof value.qos, 'number');
  }
});

test('buildSubscriptions omite el estado del LED si no está configurado', () => {
  const subscriptions = buildSubscriptions({
    potTopic: 'casa/potenciometro',
    ledStateTopic: null,
    qos: 0,
  });

  assert.deepEqual(subscriptions, {
    'casa/potenciometro': { qos: 0 },
  });
});

test('buildSubscriptions rechaza un tópico de lectura vacío', () => {
  assert.throws(
    () => buildSubscriptions({ potTopic: '', ledStateTopic: null, qos: 1 }),
    TypeError
  );
});
