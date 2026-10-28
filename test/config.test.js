'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../lib/config');

test('la configuración mínima usa valores seguros por defecto', () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  assert.equal(config.server.host, '0.0.0.0');
  assert.equal(config.server.port, 3000);
  assert.equal(config.mqtt.potTopic, 'casa/potenciometro');
  assert.equal(config.mqtt.ledTopic, 'casa/led');
  assert.equal(config.mqtt.ledStateTopic, 'casa/led/estado');
  assert.equal(config.pot.max, 4095);
});

test('rechaza credenciales embebidas en la URL de MQTT', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'test',
        MQTT_URL: 'mqtt://usuario:secreto@127.0.0.1:1883',
      }),
    /no debe incluir usuario ni contraseña/
  );
});

test('rechaza rutas y parámetros en la URL de MQTT', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', MQTT_URL: 'mqtt://127.0.0.1:1883/iot' }),
    /ruta/
  );
});

test('rechaza comodines en los tópicos configurados', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', MQTT_TOPIC_POT: 'casa/#' }),
    /comodines/
  );
});

test('en producción exige usuario y contraseña MQTT', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', HOST: '127.0.0.1' }),
    /obligatorios/
  );
});

test('en producción acepta credenciales largas', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    MQTT_USERNAME: 'dashboard',
    MQTT_PASSWORD: 'una-clave-de-prueba-larga',
  });
  assert.equal(config.mqtt.username, 'dashboard');
  assert.equal(config.mqtt.tls, false);
});

test('permite desactivar la confirmación del LED con un tópico vacío', () => {
  const config = loadConfig({ NODE_ENV: 'test', MQTT_TOPIC_LED_STATE: '' });
  assert.equal(config.mqtt.ledStateTopic, null);
});

test('rechaza TLS inseguro sin advertencia visible', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    MQTT_URL: 'mqtts://broker.example.com:8883',
    MQTT_REJECT_UNAUTHORIZED: 'false',
  });
  assert.equal(config.mqtt.tls, true);
  assert.ok(config.warnings.some((warning) => warning.includes('TLS')));
});

test('rechaza MQTT_CA_FILE cuando no se usa TLS', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'test',
        MQTT_URL: 'mqtt://127.0.0.1:1883',
        MQTT_CA_FILE: './ca.pem',
      }),
    /solo se puede usar con MQTT_URL=mqtts/
  );
});

test('rechaza QoS fuera de rango y booleanos inválidos', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', MQTT_QOS: '3' }),
    /MQTT_QOS/
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', MQTT_RETAIN_LED: 'quizá' }),
    /MQTT_RETAIN_LED/
  );
});
