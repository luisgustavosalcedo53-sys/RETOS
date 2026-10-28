'use strict';

/**
 * El cliente mqtt no acepta un arreglo de objetos { topic, qos }:
 * espera un arreglo de cadenas o un mapa { topico: { qos } }.
 * Esta función construye el mapa que usa el panel y evita reenviar
 * el objeto equivocado a mqtt.subscribe().
 */
function buildSubscriptions({ potTopic, ledStateTopic, qos }) {
  if (typeof potTopic !== 'string' || !potTopic) {
    throw new TypeError('potTopic es obligatorio.');
  }

  const subscriptions = {
    [potTopic]: { qos },
  };

  if (ledStateTopic) {
    if (typeof ledStateTopic !== 'string') {
      throw new TypeError('ledStateTopic debe ser una cadena.');
    }
    subscriptions[ledStateTopic] = { qos };
  }

  return subscriptions;
}

module.exports = { buildSubscriptions };
