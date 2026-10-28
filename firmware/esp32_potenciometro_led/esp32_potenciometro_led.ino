/*
 * Panel IoT · ESP32 + potenciómetro + LED
 * ------------------------------------------------------------
 * - Publica la lectura ADC (0–4095) en casa/potenciometro.
 * - Se suscribe a casa/led para recibir exactamente ON u OFF.
 * - Publica el estado real en casa/led/estado para confirmarlo.
 *
 * Librerías de Arduino IDE:
 *   - PubSubClient (Nick O'Leary)
 *   - WiFi (incluida en el core de ESP32)
 *
 * Cableado sugerido:
 *   Potenciómetro: 3V3 ---- extremo 1
 *                  GND  ---- extremo 2
 *                  GPIO34 -- cursor (wiper)
 *   LED: GPIO2 ---- resistencia 220–330 ohm ---- ánodo LED
 *        cátodo LED ---- GND
 *
 * Seguridad:
 *   - Copia secrets.h.example como secrets.h y completa los datos.
 *   - No subas secrets.h al repositorio.
 *   - El puerto 1883 no cifra el tráfico. Para un entorno real usa TLS 8883.
 */

#include <WiFi.h>
#include <PubSubClient.h>

#include "secrets.h"

constexpr uint8_t POT_PIN = 34;
constexpr uint8_t LED_PIN = 2;
constexpr uint8_t LED_ON_LEVEL = HIGH;

constexpr unsigned long SEND_INTERVAL_MS = 1000;
constexpr unsigned long WIFI_RETRY_MS = 5000;
constexpr unsigned long MQTT_RETRY_MS = 3000;
constexpr uint16_t MQTT_BUFFER_SIZE = 256;

const char *POT_TOPIC = "casa/potenciometro";
const char *LED_TOPIC = "casa/led";
const char *LED_STATE_TOPIC = "casa/led/estado";

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

unsigned long lastSendAt = 0;
unsigned long lastWiFiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
bool ledState = false;

void publishLedState() {
  const char *payload = ledState ? "ON" : "OFF";
  if (!mqtt.publish(LED_STATE_TOPIC, payload, true)) {
    Serial.println(F("[MQTT] No se pudo publicar el estado del LED."));
  }
}

void applyLedCommand(const String &rawCommand) {
  String command = rawCommand;
  command.trim();
  command.toUpperCase();

  if (command == "ON") {
    ledState = true;
    digitalWrite(LED_PIN, LED_ON_LEVEL);
    publishLedState();
    Serial.println(F("[LED] ON"));
  } else if (command == "OFF") {
    ledState = false;
    digitalWrite(LED_PIN, !LED_ON_LEVEL);
    publishLedState();
    Serial.println(F("[LED] OFF"));
  } else {
    Serial.print(F("[LED] Comando ignorado: "));
    Serial.println(command);
  }
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String topicName(topic);
  String message;
  message.reserve(length);
  for (unsigned int index = 0; index < length; index += 1) {
    message += static_cast<char>(payload[index]);
  }

  Serial.print(F("[MQTT] Mensaje en "));
  Serial.print(topicName);
  Serial.print(F(": "));
  Serial.println(message);

  if (topicName == LED_TOPIC) {
    applyLedCommand(message);
  }
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  unsigned long now = millis();
  if (now - lastWiFiAttemptAt < WIFI_RETRY_MS) {
    return;
  }
  lastWiFiAttemptAt = now;

  Serial.print(F("[WiFi] Conectando a "));
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) {
    return;
  }

  unsigned long now = millis();
  if (now - lastMqttAttemptAt < MQTT_RETRY_MS) {
    return;
  }
  lastMqttAttemptAt = now;

  String clientId = String(MQTT_CLIENT_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print(F("[MQTT] Conectando como "));
  Serial.println(clientId);

  if (mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println(F("[MQTT] Conectado."));
    mqtt.subscribe(LED_TOPIC, 1);
    publishLedState();
    // Si el LED estaba encendido antes de reconectar, el estado se publica
    // de nuevo de forma retenida para que el dashboard lo vea.
  } else {
    Serial.print(F("[MQTT] Error, rc="));
    Serial.println(mqtt.state());
  }
}

void publishPotentiometer() {
  unsigned long now = millis();
  if (now - lastSendAt < SEND_INTERVAL_MS) {
    return;
  }
  lastSendAt = now;

  int raw = analogRead(POT_PIN);
  char payload[12];
  snprintf(payload, sizeof(payload), "%d", raw);

  if (!mqtt.publish(POT_TOPIC, payload, false)) {
    Serial.println(F("[MQTT] No se pudo publicar la lectura."));
    return;
  }

  Serial.print(F("[POT] "));
  Serial.println(payload);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, !LED_ON_LEVEL);
  ledState = false;

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  connectWiFi();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(MQTT_BUFFER_SIZE);
  mqtt.setKeepAlive(15);
  mqtt.setSocketTimeout(10);
}

void loop() {
  connectWiFi();
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    connectMqtt();
  }

  if (mqtt.connected()) {
    mqtt.loop();
    publishPotentiometer();
  }

  delay(10);
}
