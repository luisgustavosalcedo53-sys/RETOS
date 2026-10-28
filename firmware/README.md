# Firmware ESP32

1. Instala el core de ESP32 en Arduino IDE y la librería **PubSubClient** de Nick O'Leary.
2. Copia `secrets.h.example` como `secrets.h` y completa WiFi y credenciales MQTT del dispositivo.
3. Ajusta el pin del LED si tu placa usa otro GPIO. El ejemplo usa GPIO2 y GPIO34 para el potenciómetro.
4. Carga el sketch y abre el monitor serie a 115200 baudios.
5. Verifica que el ESP32 publique en `casa/potenciometro` y reciba `ON`/`OFF` en `casa/led`.

`secrets.h` está excluido por `.gitignore`. No publiques capturas con la contraseña WiFi o MQTT visible.

El ejemplo usa MQTT 1883 sin cifrar. Para producción, migra a `WiFiClientSecure` con TLS en 8883 y valida el certificado del broker; no uses `setInsecure()` en un servidor público.
