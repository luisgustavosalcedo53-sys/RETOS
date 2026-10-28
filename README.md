# Panel IoT · Potenciómetro y LED

Dashboard académico que muestra en tiempo real la lectura de un potenciómetro conectado a un ESP32 y permite encender o apagar un LED por MQTT. El backend está hecho con **Node.js + Express + Socket.IO + MQTT**, la interfaz con **EJS + CSS + JavaScript sin frameworks** y el broker de producción es **Eclipse Mosquitto** sobre **Ubuntu Server LTS** en **AWS EC2**.

![Estado](https://img.shields.io/badge/estado-verificado%20localmente-22d3ee)
![Node](https://img.shields.io/badge/Node.js-20%2B%20%7C%2022%20LTS-2f7bff)
![MQTT](https://img.shields.io/badge/MQTT-Mosquitto-2f7bff)
![Licencia](https://img.shields.io/badge/licencia-ISC-61758f)

---

## Aviso importante sobre este documento

Este README es una **guía de despliegue y operación**. Desde el entorno donde se creó el proyecto:

- **No** se creó ninguna instancia de AWS EC2.
- **No** se configuró ningún servidor Ubuntu remoto.
- **No** se instaló Mosquitto en un servidor remoto.
- **No** se cargó firmware en un ESP32 físico.
- **No** se emitieron certificados TLS reales.

Por lo tanto, los bloques marcados como **«Salida esperada»** son ejemplos ilustrativos: sirven para que compares lo que deberías obtener, pero **no son evidencia de una ejecución remota real**. Solo la sección [Verificación local realizada](#25-verificación-local-realizada) contiene resultados que se obtuvieron en este entorno.

Convención usada en todo el documento:

| Etiqueta | Significado |
| --- | --- |
| **Comando** | Orden que debes ejecutar en el equipo o servidor indicado. |
| **Salida esperada** | Ejemplo de lo que debería aparecer. Los valores pueden variar. |
| **Resultado verificado localmente** | Resultado realmente obtenido en este entorno de desarrollo. |

> **Nunca publiques** el archivo `.env`, el archivo `pwfile` de Mosquitto, claves privadas (`.pem`, `.ppk`, `id_ed25519`), ni capturas donde aparezcan contraseñas, tokens o claves.

---

## 0. Revisión urgente: ¿está en AWS o en local?

**Ahora mismo el proyecto está en local. No está desplegado en AWS.** No existe forma de verificarlo desde este entorno porque no hay acceso a tu instancia. Para comprobarlo en tu EC2, conéctate por PuTTY y ejecuta:

```bash
node -v
npm -v
systemctl is-active mosquitto
systemctl is-enabled mosquitto
sudo ss -ltnp | grep -E '1883|3000'
test -d /opt/iot-dashboard && echo "app: instalada" || echo "app: NO instalada"
```

**Interpretación rápida:**

| Resultado | Significado |
| --- | --- |
| `node -v` muestra `v22.x` | Node.js instalado en EC2. |
| `systemctl is-active mosquitto` muestra `active` | Mosquitto está corriendo. |
| `systemctl is-enabled mosquitto` muestra `enabled` | Mosquitto arranca solo al reiniciar. |
| `ss` muestra `0.0.0.0:1883` | Mosquitto escucha en todas las interfaces. |
| `ss` muestra `0.0.0.0:3000` | Node escucha en todas las interfaces. |
| `app: NO instalada` | El proyecto todavía no está en EC2. |

Si `node` o `mosquitto` no existen, instálalos con los pasos de las secciones [14](#14-nodejs-22-lts-con-nodesource) y [15](#15-mosquitto-autenticación-acl-y-pruebas-locales).

### 0.1 Modo directo para la revisión: `http://TU_IP_PUBLICA:3000`

Para esta revisión se usa el acceso directo, sin Nginx:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
TRUST_PROXY=false
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=dashboard
MQTT_PASSWORD=TU_CLAVE_MQTT_DASHBOARD
```

Pasos mínimos, en orden:

1. **Subir el proyecto** (desde Windows, con `pscp` de PuTTY; no subas `.env` ni `node_modules`):

   ```powershell
   plink -i RUTA_AL_PPK USUARIO_1@TU_IP_PUBLICA "mkdir -p /tmp/iot-dashboard"
   pscp -i RUTA_AL_PPK -r server.js lib views public package.json package-lock.json deploy firmware .env.example README.md USUARIO_1@TU_IP_PUBLICA:/tmp/iot-dashboard/
   ```

2. **Mover a `/opt` y crear el usuario del servicio** (si no existe):

   ```bash
   sudo adduser --system --group --home /var/lib/iot-dashboard --shell /usr/sbin/nologin iotdash
   sudo mkdir -p /opt/iot-dashboard
   sudo cp -r /tmp/iot-dashboard/. /opt/iot-dashboard/
   sudo chown -R iotdash:iotdash /opt/iot-dashboard
   ```

3. **Crear `.env`** (nunca lo subas desde Windows):

   ```bash
   cd /opt/iot-dashboard
   sudo cp .env.example .env
   sudo nano .env
   ```

   Ajusta `HOST=0.0.0.0`, `PORT=3000`, `MQTT_URL=mqtt://127.0.0.1:1883` y las credenciales reales de Mosquitto. Luego:

   ```bash
   sudo chown iotdash:iotdash .env
   sudo chmod 600 .env
   ```

4. **Instalar dependencias y activar el servicio:**

   ```bash
   cd /opt/iot-dashboard
   sudo -u iotdash -H npm ci --omit=dev
   sudo cp deploy/systemd/iot-dashboard.service /etc/systemd/system/iot-dashboard.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now iot-dashboard
   systemctl status iot-dashboard --no-pager
   ```

5. **Abrir puertos** en el Security Group de AWS y en UFW:
   - `22/tcp` desde tu IP (PuTTY).
   - `3000/tcp` desde tu IP para la revisión. **No lo abras a `0.0.0.0/0`** salvo que sea imprescindible y por tiempo limitado.
   - `1883/tcp` desde la IP del ESP32 (solo si el dispositivo conecta por Internet).

   ```bash
   sudo ufw allow from TU_IP_ADMIN to any port 22 proto tcp
   sudo ufw allow from TU_IP_ADMIN to any port 3000 proto tcp
   sudo ufw allow from TU_IP_ESP32 to any port 1883 proto tcp
   sudo ufw enable
   sudo ufw status verbose
   ```

6. **Verificar de verdad** (no basta con que el servicio esté `active`):

   ```bash
   sudo ss -ltnp | grep 3000
   curl -s http://127.0.0.1:3000/healthz
   systemctl status mosquitto --no-pager
   sudo ss -ltnp | grep 1883
   curl -s http://TU_IP_PUBLICA:3000/healthz
   ```

   Debes ver `0.0.0.0:3000` en `ss`, `"status":"ok"` y `"mqtt":{"connected":true}`. Abre `http://TU_IP_PUBLICA:3000` desde tu navegador. Si carga pero no hay lecturas, el problema es MQTT/ESP32, no la publicación del puerto.

> **Nginx es opcional para esta revisión.** Si más adelante usas Nginx, cambia `HOST=127.0.0.1`, abre `80/443` y cierra `3000`. Para la revisión de ahora, el modo directo `0.0.0.0:3000` es suficiente.

---

## Tabla de contenido

1. [Descripción y alcance](#1-descripción-y-alcance)
2. [Arquitectura](#2-arquitectura)
3. [Funcionalidades](#3-funcionalidades)
4. [Estructura del repositorio](#4-estructura-del-repositorio)
5. [Requisitos](#5-requisitos)
6. [Puesta en marcha local](#6-puesta-en-marcha-local)
7. [Variables de entorno](#7-variables-de-entorno)
8. [API HTTP y eventos Socket.IO](#8-api-http-y-eventos-socketio)
9. [Pruebas automatizadas](#9-pruebas-automatizadas)
10. [Despliegue en AWS EC2 desde la consola](#10-despliegue-en-aws-ec2-desde-la-consola)
11. [Conexión con PuTTY y PuTTYgen](#11-conexión-con-putty-y-puttygen)
12. [Preparación de Ubuntu Server](#12-preparación-de-ubuntu-server)
13. [Usuarios Linux, claves SSH y sudo](#13-usuarios-linux-claves-ssh-y-sudo)
14. [Node.js 22 LTS con NodeSource](#14-nodejs-22-lts-con-nodesource)
15. [Mosquitto: autenticación, ACL y pruebas locales](#15-mosquitto-autenticación-acl-y-pruebas-locales)
16. [TLS en Mosquitto, puerto 8883](#16-tls-en-mosquitto-puerto-8883)
17. [Despliegue de la aplicación](#17-despliegue-de-la-aplicación)
18. [Nginx como proxy inverso y HTTPS](#18-nginx-como-proxy-inverso-y-https)
19. [Firewall UFW y Security Group final](#19-firewall-ufw-y-security-group-final)
20. [ESP32: hardware, firmware y pruebas](#20-esp32-hardware-firmware-y-pruebas)
21. [Estados de la interfaz](#21-estados-de-la-interfaz)
22. [Solución de problemas](#22-solución-de-problemas)
23. [Checklist de seguridad](#23-checklist-de-seguridad)
24. [Evidencias para el informe](#24-evidencias-para-el-informe)
25. [Verificación local realizada](#25-verificación-local-realizada)
26. [Limitaciones y trabajo futuro](#26-limitaciones-y-trabajo-futuro)

---

## 1. Descripción y alcance

El proyecto implementa un panel web que:

1. Recibe por MQTT las lecturas de un potenciómetro conectado al ADC de un ESP32.
2. Muestra el valor ADC, el porcentaje, una gráfica de las últimas muestras y la hora de la última lectura.
3. Envía órdenes `ON` u `OFF` al ESP32 por MQTT para controlar un LED.
4. Recibe la confirmación del estado real del LED desde el dispositivo.
5. Informa el estado de la conexión con el broker, las lecturas obsoletas y los errores, sin recargar la página.

**Incluye:** backend Node.js, interfaz responsive, firmware de ejemplo, archivos de despliegue para Mosquitto/Nginx/systemd, pruebas automatizadas y esta guía.

**No incluye:** autenticación de usuarios en la aplicación web, base de datos histórica, aplicación móvil, VPN, ni integración con servicios en la nube distintos de EC2. El alcance es académico y el panel está pensado para ejecutarse detrás de Nginx y con el puerto de Express cerrado al exterior.

### Decisiones de seguridad adoptadas

- El broker final **no permite acceso anónimo**.
- Cada cliente MQTT tiene un usuario y una ACL de mínimo privilegio.
- El backend valida estrictamente las órdenes: solo `ON` u `OFF`.
- La configuración y los secretos viven en `.env`, nunca en el código.
- SSH solo con claves, sin root y sin contraseñas.
- Solo el administrador tiene sudo completo; los demás usuarios no.
- El puerto `3000` de Express no se expone a Internet.
- Se aplican cabeceras de seguridad con Helmet y una CSP estricta.

---

## 2. Arquitectura

```text
┌─────────────────────┐        MQTT 1883 / 8883        ┌──────────────────────────┐
│ ESP32               │  publica casa/potenciometro     │ Eclipse Mosquitto        │
│ · potenciómetro     │ ──────────────────────────────▶ │ · allow_anonymous false  │
│ · LED               │ ◀────────────────────────────── │ · password_file          │
│                     │  recibe casa/led                 │ · acl_file               │
│                     │  publica casa/led/estado         │ · systemd enabled        │
└─────────────────────┘                                  └────────────┬─────────────┘
                                                                      │ MQTT
                                                                      │ localhost
                                                           ┌──────────▼─────────────┐
                                                           │ Node.js + Express      │
                                                           │ · Socket.IO            │
                                                           │ · validación y estado  │
                                                           │ · 127.0.0.1:3000       │
                                                           └──────────┬─────────────┘
                                                                      │ HTTP / WebSocket
                                                           ┌──────────▼─────────────┐
                                                           │ Nginx                  │
                                                           │ · 80/443               │
                                                           │ · TLS con Certbot      │
                                                           └──────────┬─────────────┘
                                                                      │ HTTPS / WSS
                                                           ┌──────────▼─────────────┐
                                                           │ Navegador del usuario  │
                                                           └────────────────────────┘
```

### Flujo de datos

| Paso | Acción | Tópico / ruta |
| --- | --- | --- |
| 1 | El ESP32 lee el ADC cada segundo y publica el valor. | `casa/potenciometro` |
| 2 | El backend valida el payload, actualiza el estado y emite `pot:update`. | Socket.IO |
| 3 | El navegador actualiza el medidor, las tarjetas, la gráfica y los eventos. | WebSocket |
| 4 | El usuario pulsa **Encender** o **Apagar**. | `POST /api/led` |
| 5 | El backend valida que sea exactamente `ON` u `OFF` y publica la orden. | `casa/led` |
| 6 | El ESP32 aplica la orden y publica el estado real. | `casa/led/estado` |
| 7 | El backend confirma el estado y lo muestra en el panel. | `led:state` |

### Puertos

| Puerto | Servicio | Exposición recomendada |
| --- | --- | --- |
| `22` | SSH | Solo la IP del administrador. |
| `80` | HTTP / redirección a HTTPS | Público, si se usa Certbot. |
| `443` | HTTPS / WSS | Público. |
| `1883` | MQTT sin cifrar | Solo la IP del ESP32 o ninguna si se usa TLS/VPN. |
| `8883` | MQTT sobre TLS | Solo la IP del ESP32 o ninguna si se usa VPN. |
| `3000` | Express | Solo la IP del administrador durante la revisión (acceso directo). En producción, detrás de Nginx en `127.0.0.1`. |

> En producción se recomienda **8883 con TLS** y, si es posible, restringir el Security Group a la IP del ESP32 o usar una VPN. El puerto `1883` transmite credenciales y datos sin cifrar.

---

## 3. Funcionalidades

- **Actualización en vivo:** Socket.IO empuja cada lectura y cada cambio de estado; no se recarga la página.
- **Medidor circular:** valor ADC de 12 bits y porcentaje sobre `POT_MAX` (por defecto `4095`).
- **Gráfica temporal:** Canvas nativo, sin librerías externas ni CDN; conserva las últimas `HISTORY_SIZE` muestras (60 por defecto).
- **Tarjetas de estado:** valor actual, estado del LED, última lectura y tiempo activo.
- **Control del LED:** botones `ON`/`OFF`, estado pendiente y confirmación del dispositivo.
- **Estado de conexión:** `Conectando`, `Conectado`, `Reconectando`, `Sin conexión`.
- **Datos obsoletos:** si no llegan lecturas durante `STALE_AFTER_MS`, se muestra una alerta.
- **Registro de eventos:** últimas 50 novedades del servidor, con nivel y hora.
- **Validación estricta:** el endpoint solo acepta `ON` u `OFF`; el resto devuelve `400`.
- **Límite de órdenes:** 15 peticiones cada 10 segundos por IP.
- **Cierre ordenado:** al recibir `SIGTERM`/`SIGINT` cierra Socket.IO, MQTT y HTTP.
- **Seguridad:** Helmet, CSP sin scripts inline, `textContent` en lugar de `innerHTML`, errores saneados y sin secretos en logs.
- **Responsive:** diseño azul/negro inspirado en FieldMonitor, probado a 1440 px y 390 px.

---

## 4. Estructura del repositorio

```text
.
├── server.js                         # Express, MQTT, Socket.IO, validación y cierre ordenado
├── lib/
│   ├── config.js                     # Lectura y validación de variables de entorno
│   ├── payloads.js                   # Parseo de lecturas, estados y órdenes
│   └── subscriptions.js              # Construcción del mapa de suscripciones MQTT
├── views/
│   ├── index.ejs                     # Panel principal
│   └── error.ejs                     # Página de error
├── public/
│   ├── css/styles.css                # Tema azul/negro y diseño responsive
│   └── js/dashboard.js               # Estado del cliente, gráfica y Socket.IO
├── test/
│   ├── config.test.js                # Pruebas de configuración y seguridad
│   ├── payloads.test.js              # Pruebas de validación de payloads
│   └── subscriptions.test.js         # Regresión de suscripciones MQTT
├── deploy/
│   ├── mosquitto/
│   │   ├── iot.conf                  # Configuración final del broker
│   │   └── aclfile.example           # ACL de mínimo privilegio
│   ├── nginx/
│   │   └── iot-dashboard.conf        # Proxy inverso + WebSocket
│   └── systemd/
│       └── iot-dashboard.service     # Servicio endurecido
├── firmware/
│   ├── README.md
│   └── esp32_potenciometro_led/
│       ├── esp32_potenciometro_led.ino
│       └── secrets.h.example
├── .env.example                      # Plantilla con valores ficticios
├── .gitignore                        # Excluye .env, claves y node_modules
├── package.json
├── package-lock.json
└── README.md
```

Archivos que **no** deben subirse al repositorio: `.env`, `firmware/**/secrets.h`, `*.pem`, `*.ppk`, `*.key`, `node_modules/`, logs y capturas con secretos.

---

## 5. Requisitos

### Desarrollo local

- **Node.js 20 o superior**; se recomienda **22 LTS**.
- **npm** (incluido con Node.js).
- Un broker MQTT accesible:
  - Mosquitto local, o
  - un broker del curso, o
  - un contenedor Docker de Mosquitto.
- Navegador moderno con WebSocket.
- Opcional: cliente `mosquitto_pub`/`mosquitto_sub` para pruebas.

### Servidor

- **Ubuntu Server 22.04 o 24.04 LTS** en AWS EC2.
- **t3.micro** o **t2.micro** (1 vCPU, 1 GB de RAM) como mínimo para el panel y Mosquitto.
- **10–20 GB** de disco `gp3`.
- Dirección IPv4 pública o **Elastic IP**.
- Security Group con solo los puertos necesarios.

### Hardware

- ESP32 DevKit (o placa compatible).
- Potenciómetro de 10 kΩ.
- LED y resistencia de 220–330 Ω.
- Cables y protoboard.

---

## 6. Puesta en marcha local

### 6.1 Instalar dependencias

**Comando:**

```bash
npm ci
```

Si no existe `package-lock.json` o estás ajustando versiones:

```bash
npm install
```

**Salida esperada (ejemplo):**

```text
added 120 packages, and audited 121 packages in 8s
found 0 vulnerabilities
```

> En Windows con PowerShell, si `npm` está bloqueado por la política de ejecución de scripts, usa `npm.cmd` en lugar de `npm`.

### 6.2 Crear el archivo `.env`

**Comando (Linux/macOS):**

```bash
cp .env.example .env
```

**Comando (Windows PowerShell):**

```powershell
Copy-Item .env.example .env
```

Edita `.env` y ajusta como mínimo:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

> Dejar `MQTT_USERNAME` y `MQTT_PASSWORD` vacíos **solo** es válido en desarrollo con un broker local anónimo. En producción el backend se niega a arrancar sin credenciales MQTT.

### 6.3 Iniciar un broker local

**Opción A: Mosquitto instalado en Linux/WSL**

```bash
sudo systemctl start mosquitto
sudo systemctl status mosquitto --no-pager
```

Para una prueba local rápida y anónima, configura temporalmente el broker solo en `127.0.0.1` y con `allow_anonymous true`. **No uses esa configuración en el servidor público.**

**Opción B: Docker**

```bash
docker run --rm -it -p 127.0.0.1:1883:1883 eclipse-mosquitto:2 \
  mosquitto -c /mosquitto-no-auth.conf
```

**Salida esperada (ejemplo):**

```text
mosquitto version 2.x starting
Config loaded from /mosquitto-no-auth.conf.
Opening ipv4 listen socket on port 1883.
```

### 6.4 Arrancar el panel

**Comando:**

```bash
npm start
```

**Salida esperada (ejemplo):**

```text
[2026-01-01T12:00:00.000Z] Panel IoT disponible en http://127.0.0.1:3000
[2026-01-01T12:00:00.001Z] Broker MQTT: mqtt://127.0.0.1:1883 · autenticación: deshabilitada (solo desarrollo)
[2026-01-01T12:00:00.001Z] Tópicos: lecturas=casa/potenciometro · control=casa/led · estado=casa/led/estado
[2026-01-01T12:00:00.002Z] MQTT sin usuario configurado. En el servidor público usa autenticación y ACL.
[2026-01-01T12:00:00.100Z] Conectado al broker MQTT.
[2026-01-01T12:00:00.120Z] Suscripción activa: casa/potenciometro, casa/led/estado.
```

Abre <http://127.0.0.1:3000>.

### 6.5 Simular el ESP32 sin hardware

Puedes usar `mosquitto_pub` para publicar lecturas y confirmar el LED:

**Terminal A (observar todo):**

```bash
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'casa/#' -v
```

**Terminal B (publicar una lectura):**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -t casa/potenciometro -m 2048
```

**Salida esperada en la Terminal A:**

```text
casa/potenciometro 2048
```

**Publicar una confirmación de LED:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -t casa/led/estado -m ON
```

La tarjeta **Estado del LED** debe pasar a `ON` y el evento debe aparecer en la lista.

> Para validar la interfaz sin hardware se usó un broker local compatible con MQTT y un simulador del ESP32. Esos archivos de prueba **no forman parte del repositorio** ni del despliegue de producción; el broker final es Mosquitto con autenticación y ACL.

### 6.6 Prueba de las órdenes

**Comando:**

```bash
curl -s -X POST http://127.0.0.1:3000/api/led \
  -H 'Content-Type: application/json' \
  -d '{"command":"ON"}'
```

**Salida esperada:**

```json
{"ok":true,"command":"ON","at":1767225600000,"topic":"casa/led"}
```

**Comando inválido:**

```bash
curl -s -i -X POST http://127.0.0.1:3000/api/led \
  -H 'Content-Type: application/json' \
  -d '{"command":"on"}'
```

**Salida esperada (resumen):**

```text
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"ok":false,"error":"Comando inválido. El servidor solo acepta exactamente \"ON\" u \"OFF\"."}
```

> Se permiten espacios alrededor de `ON`/`OFF` porque el backend recorta el valor; las minúsculas y cualquier otro texto se rechazan.

### 6.7 Detener el panel

`Ctrl+C` en la terminal. El servidor captura `SIGINT`, emite `server:shutdown`, cierra Socket.IO y MQTT, y termina.

**Salida esperada (ejemplo):**

```text
[2026-01-01T12:10:00.000Z] Señal SIGINT recibida. Cerrando el panel…
```

---

## 7. Variables de entorno

Toda la configuración del backend se lee desde `.env` mediante `dotenv`. No hay IPs, usuarios ni contraseñas escritos en el código.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` activa validaciones estrictas y caché de vistas. |
| `HOST` | `127.0.0.1` | Interfaz donde escucha Express. Detrás de Nginx debe ser `127.0.0.1`. |
| `PORT` | `3000` | Puerto interno de Express. |
| `TRUST_PROXY` | `false` | `true` detrás de Nginx para respetar `X-Forwarded-*`. |
| `ENABLE_HSTS` | `false` | Activa HSTS. Solo después de verificar HTTPS. |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | URL del broker. Solo `mqtt://` o `mqtts://`; sin credenciales embebidas. |
| `MQTT_USERNAME` | vacío | Usuario MQTT. Obligatorio en producción. |
| `MQTT_PASSWORD` | vacío | Contraseña MQTT. Obligatoria en producción. |
| `MQTT_CLIENT_ID` | vacío | Si está vacío se genera uno único con host y PID. |
| `MQTT_TOPIC_POT` | `casa/potenciometro` | Tópico de lecturas. |
| `MQTT_TOPIC_LED` | `casa/led` | Tópico de órdenes. |
| `MQTT_TOPIC_LED_STATE` | `casa/led/estado` | Tópico de confirmación. Vacío desactiva la confirmación. |
| `MQTT_QOS` | `1` | QoS de suscripción y publicación (`0`, `1`, `2`). |
| `MQTT_RETAIN_LED` | `true` | Retiene la última orden para que el ESP32 la reciba al reconectar. |
| `MQTT_RECONNECT_PERIOD_MS` | `5000` | Espera entre reintentos de conexión. |
| `MQTT_CONNECT_TIMEOUT_MS` | `10000` | Timeout de conexión. |
| `MQTT_CA_FILE` | vacío | Ruta a la CA pública. Solo con `mqtts://`. |
| `MQTT_REJECT_UNAUTHORIZED` | `true` | Valida el certificado TLS. No lo desactives en producción. |
| `MQTT_LED_ACK_TIMEOUT_MS` | `8000` | Espera máxima de confirmación del LED. |
| `POT_MAX` | `4095` | Valor máximo del ADC (12 bits). |
| `STALE_AFTER_MS` | `15000` | Tiempo sin lecturas para marcar datos obsoletos. |
| `HISTORY_SIZE` | `60` | Muestras conservadas para la gráfica. |
| `READING_EVENT_INTERVAL_MS` | `30000` | Frecuencia con la que se registra una lectura en eventos. |

### Ejemplo de `.env` de producción

```dotenv
NODE_ENV=production
# Acceso directo por IP: 0.0.0.0. Detrás de Nginx: 127.0.0.1.
HOST=0.0.0.0
PORT=3000
# false en acceso directo; true solo detrás de Nginx.
TRUST_PROXY=false
ENABLE_HSTS=false

MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=dashboard
MQTT_PASSWORD=UNA_CLAVE_LARGA_Y_UNICA
MQTT_TOPIC_POT=casa/potenciometro
MQTT_TOPIC_LED=casa/led
MQTT_TOPIC_LED_STATE=casa/led/estado
MQTT_QOS=1
MQTT_RETAIN_LED=true

POT_MAX=4095
STALE_AFTER_MS=15000
HISTORY_SIZE=60
READING_EVENT_INTERVAL_MS=30000
```

> `UNA_CLAVE_LARGA_Y_UNICA` es un marcador. No uses esa cadena. Genera una contraseña distinta para `dashboard`, `esp32` y `monitor`.

### Validaciones que aplica el backend

- En producción, `MQTT_USERNAME` y `MQTT_PASSWORD` son obligatorios.
- `MQTT_URL` no puede incluir usuario ni contraseña.
- Solo se aceptan los protocolos `mqtt:` y `mqtts:`.
- Los tópicos no pueden contener comodines `+` o `#`.
- `MQTT_CA_FILE` solo se permite con `mqtts://`.
- `MQTT_REJECT_UNAUTHORIZED=false` genera una advertencia visible.
- Los enteros y booleanos se validan con rangos; un valor inválido impide arrancar.

---

## 8. API HTTP y eventos Socket.IO

### Rutas

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/` | Panel HTML. |
| `GET` | `/api/state` | Estado completo en JSON, sin caché. |
| `GET` | `/healthz` | Estado resumido para monitoreo. |
| `POST` | `/api/led` | Publica `ON` u `OFF` en `casa/led`. |

### `GET /api/state`

**Comando:**

```bash
curl -s http://127.0.0.1:3000/api/state | python3 -m json.tool
```

**Salida esperada (resumen):**

```json
{
  "serverTime": 1767225600000,
  "startedAt": 1767225000000,
  "uptimeMs": 600000,
  "mqtt": {
    "connected": true,
    "status": "connected",
    "since": 1767225000100,
    "broker": "127.0.0.1:1883",
    "tls": false,
    "lastError": null
  },
  "pot": {
    "value": 2048,
    "percent": 50,
    "at": 1767225599000,
    "stale": false,
    "count": 42
  },
  "led": {
    "state": "ON",
    "confirmed": true,
    "at": 1767225590000,
    "source": "device"
  },
  "history": [],
  "events": [],
  "config": {
    "potMax": 4095,
    "staleAfterMs": 15000,
    "historySize": 60,
    "qos": 1,
    "retainLed": true,
    "topics": {
      "pot": "casa/potenciometro",
      "led": "casa/led",
      "ledState": "casa/led/estado"
    }
  }
}
```

### `POST /api/led`

**Cuerpo:**

```json
{"command":"ON"}
```

**Respuestas:**

| Código | Significado |
| --- | --- |
| `200` | Orden publicada. |
| `400` | Comando distinto de `ON`/`OFF` o JSON inválido. |
| `429` | Más de 15 órdenes en 10 segundos desde la misma IP. |
| `502` | El broker rechazó o no confirmó la publicación. |
| `503` | El broker MQTT no está conectado. |

### `GET /healthz`

**Comando:**

```bash
curl -s http://127.0.0.1:3000/healthz
```

**Salida esperada con broker conectado:**

```json
{"status":"ok","mqtt":{"connected":true,"status":"connected"},"pot":{"hasReading":true,"stale":false,"lastReadingAt":1767225599000},"uptimeMs":600000}
```

**Salida esperada con broker caído:**

```json
{"status":"degraded","mqtt":{"connected":false,"status":"disconnected"},"pot":{"hasReading":true,"stale":false,"lastReadingAt":1767225599000},"uptimeMs":600000}
```

> `/healthz` responde `200` incluso en estado `degraded` para que puedas monitorear el cuerpo JSON. Si necesitas un chequeo binario, usa `status == "ok"`.

### Eventos Socket.IO

| Evento | Dirección | Contenido |
| --- | --- | --- |
| `state:init` | Servidor → cliente | Snapshot completo al conectar. |
| `mqtt:status` | Servidor → cliente | Estado del broker. |
| `pot:update` | Servidor → cliente | Última lectura validada. |
| `pot:stale` | Servidor → cliente | Cambio de estado obsoleto/vigente. |
| `led:state` | Servidor → cliente | Estado del LED y si está confirmado. |
| `led:ack-timeout` | Servidor → cliente | El dispositivo no confirmó la orden. |
| `event:log` | Servidor → cliente | Nuevo evento del registro. |
| `server:shutdown` | Servidor → cliente | El servidor se está deteniendo. |

---

## 9. Pruebas automatizadas

### 9.1 Ejecutar las pruebas

**Comando:**

```bash
npm test
```

**Salida esperada (resumen):**

```text
# tests 24
# pass 24
# fail 0
# duration_ms 122.3954
```

Las pruebas cubren:

- Valores válidos, JSON, coma decimal, fuera de rango y payloads gigantes.
- `ON`/`OFF` en telemetría y validación estricta de órdenes.
- Configuración mínima, credenciales embebidas, comodines, producción sin credenciales, TLS inseguro y `MQTT_CA_FILE`.
- Construcción correcta del mapa de suscripciones MQTT (regresión del bug de `topic.split`).

### 9.2 Verificar sintaxis

**Comando:**

```bash
npm run check
```

**Salida esperada:** ninguna salida y código de salida `0`.

### 9.3 Auditar dependencias

**Comando:**

```bash
npm audit --omit=dev
```

**Salida esperada:**

```text
found 0 vulnerabilities
```

### 9.4 Pruebas manuales mínimas

| Prueba | Comando | Resultado esperado |
| --- | --- | --- |
| Panel carga | `curl -I http://127.0.0.1:3000` | `200 OK`, `text/html; charset=utf-8`. |
| Estado JSON | `curl -s http://127.0.0.1:3000/api/state` | JSON con `mqtt`, `pot`, `led`, `events`. |
| Orden válida | `POST {"command":"ON"}` | `200` y `{"ok":true,...}`. |
| Orden inválida | `POST {"command":"on"}` | `400` con mensaje de error. |
| Broker caído | Detener Mosquitto y enviar orden | `503` y `healthz` en `degraded`. |
| Sin lecturas | Detener el ESP32 15 s | `pot.stale: true` y alerta en la UI. |
| Confirmación LED | Publicar en `casa/led/estado` | Tarjeta LED en `ON`/`OFF` confirmado. |

---

## 10. Despliegue en AWS EC2 desde la consola

> **No se creó ninguna instancia desde este entorno.** Estos pasos son la guía para que los ejecutes en tu cuenta.

### 10.1 Lanzar la instancia

1. Inicia sesión en la consola de AWS y elige una región cercana (por ejemplo, `us-east-1` o `sa-east-1`).
2. Entra en **EC2 → Instances → Launch instance**.
3. **Name:** `iot-dashboard`.
4. **Application and OS Images:** selecciona **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type** (64-bit x86).
5. **Instance type:** `t3.micro` o `t2.micro` según tu cuenta y región.
6. **Key pair:**
   - Crea un par nuevo: **Create new key pair**.
   - Nombre: `iot-dashboard-key`.
   - Tipo: **RSA** (compatible con PuTTYgen de forma directa).
   - Formato: **.pem**.
   - Descarga el archivo y guárdalo en un lugar seguro. **AWS no te lo volverá a mostrar.**
7. **Network settings → Edit:**
   - VPC: la predeterminada.
   - Subnet: una pública.
   - Auto-assign public IP: **Enable**.
   - Firewall: **Create security group** con las reglas de la tabla siguiente.
8. **Configure storage:** `10 GiB` o `20 GiB`, tipo `gp3`.
9. **Advanced details:** deja los valores por defecto (sin user data).
10. **Launch instance** y espera a que el estado sea **Running** y los chequeos `2/2 passed`.

### 10.2 Security Group inicial

Crea el grupo `iot-dashboard-sg` con estas reglas de entrada:

| Tipo | Protocolo | Puerto | Origen | Motivo |
| --- | --- | --- | --- | --- |
| SSH | TCP | `22` | `TU_IP_ADMIN/32` | Administración. |
| HTTP | TCP | `80` | `0.0.0.0/0`, `::/0` | Validación de Certbot y redirección. |
| HTTPS | TCP | `443` | `0.0.0.0/0`, `::/0` | Panel y WebSocket seguros. |
| MQTT | TCP | `1883` | `TU_IP_ESP32/32` | Solo si el ESP32 conecta sin TLS. |
| MQTTS | TCP | `8883` | `TU_IP_ESP32/32` | Recomendado si el ESP32 conecta por Internet. |

Reglas de salida: permite todo el tráfico saliente (valor por defecto).

> **No abras el puerto `3000`.** Express escucha en `127.0.0.1` y Nginx es el único acceso público. Tampoco abras `1883` a `0.0.0.0/0` si puedes usar `8883` o una VPN.

### 10.3 Elastic IP (recomendado)

1. **EC2 → Elastic IPs → Allocate Elastic IP address**.
2. **Associate** con la instancia `iot-dashboard`.
3. Anota la IP: será `TU_IP_PUBLICA`.

Una Elastic IP evita que la IP cambie al detener/iniciar la instancia. AWS puede cobrar si la IP no está asociada; mantén la asociación.

### 10.4 Primer acceso

Desde Linux/macOS:

```bash
ssh -i RUTA_LLAVE.pem ubuntu@TU_IP_PUBLICA
```

Desde Windows PowerShell (OpenSSH):

```powershell
ssh -i "RUTA_LLAVE.pem" ubuntu@TU_IP_PUBLICA
```

**Salida esperada (ejemplo):**

```text
Welcome to Ubuntu 24.04.x LTS (GNU/Linux ... x86_64)
...
ubuntu@ip-172-31-xx-xx:~$
```

Si OpenSSH en Windows rechaza la clave por permisos, ejecuta:

```powershell
icacls.exe "RUTA_LLAVE.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

---

## 11. Conexión con PuTTY y PuTTYgen

### 11.1 Convertir el `.pem` a `.ppk` con PuTTYgen

1. Descarga PuTTY (incluye PuTTYgen) desde el sitio oficial: <https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html>.
2. Abre **PuTTYgen**.
3. Pulsa **Load** y selecciona `iot-dashboard-key.pem`. Si no aparece, cambia el filtro a **All Files (*.*)**.
4. PuTTYgen mostrará un mensaje de importación correcta.
5. Pulsa **Save private key**.
6. Guarda como `iot-dashboard-key.ppk`.
7. Si te pregunta por una passphrase, elige una fuerte. La passphrase protege el `.ppk` en tu equipo.
8. **No subas el `.ppk` al servidor ni al repositorio.** Es una clave privada.

### 11.2 Crear claves individuales para cada integrante (recomendado)

Cada integrante debe tener su propia clave. Puedes generarla con PuTTYgen:

1. **PuTTYgen → Generate** (mueve el ratón).
2. Tipo: **Ed25519** (o RSA 4096 si tu versión de PuTTY es antigua).
3. **Key comment:** `USUARIO_1@LAPTOP-01`.
4. **Save public key** como `USUARIO_1.pub`.
5. **Save private key** como `USUARIO_1.ppk` con passphrase.
6. Envía **solo** `USUARIO_1.pub` al administrador. El `.ppk` nunca sale de tu equipo.

Alternativa con OpenSSH:

```bash
ssh-keygen -t ed25519 -a 100 -C "USUARIO_1@LAPTOP-01"
```

Genera `~/.ssh/id_ed25519` (privada) y `~/.ssh/id_ed25519.pub` (pública).

### 11.3 Configurar PuTTY

1. Abre **PuTTY**.
2. **Session:**
   - **Host Name:** `TU_IP_PUBLICA`.
   - **Port:** `22`.
   - **Connection type:** SSH.
3. **Connection → SSH → Auth → Credentials:**
   - **Private key file for authentication:** selecciona `USUARIO_1.ppk`.
4. **Connection → Data:**
   - **Auto-login username:** `USUARIO_1`.
5. **Window → Translation:**
   - **Remote character set:** `UTF-8` (para ver bien los acentos).
6. **Connection → Seconds between keepalives:** `30` (opcional).
7. Vuelve a **Session**, escribe un nombre en **Saved Sessions** (por ejemplo, `iot-TU_IP_PUBLICA`) y pulsa **Save**.
8. Pulsa **Open**.
9. La primera vez verás la huella de la clave del servidor. Verifícala antes de aceptar. Puedes compararla desde otra sesión con:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

**Salida esperada (ejemplo):**

```text
256 SHA256:AbCdEf... root@ip-172-31-xx-xx (ED25519)
```

Si la huella coincide, pulsa **Accept**.

### 11.4 Copiar la clave pública al servidor

**Desde Linux/macOS:**

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub USUARIO_1@TU_IP_PUBLICA
```

**Desde Windows PowerShell:**

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh USUARIO_1@TU_IP_PUBLICA "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**Desde el servidor (si el administrador recibe el `.pub`):**

```bash
sudo -u USUARIO_1 mkdir -p /home/USUARIO_1/.ssh
sudo -u USUARIO_1 nano /home/USUARIO_1/.ssh/authorized_keys
```

Pega una clave pública por línea. Luego:

```bash
sudo chown -R USUARIO_1:USUARIO_1 /home/USUARIO_1/.ssh
sudo chmod 700 /home/USUARIO_1/.ssh
sudo chmod 600 /home/USUARIO_1/.ssh/authorized_keys
```

**Salida esperada de una prueba de acceso:**

```text
USUARIO_1@ip-172-31-xx-xx:~$ whoami
USUARIO_1
```

---

## 12. Preparación de Ubuntu Server

Conéctate como `ubuntu` o como `USUARIO_1` con sudo.

### 12.1 Actualizar el sistema

**Comando:**

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y curl ca-certificates gnupg lsb-release ufw git unzip htop
```

**Salida esperada (resumen):**

```text
Reading package lists... Done
Building dependency tree... Done
...
0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
```

Si el kernel se actualiza, reinicia:

```bash
sudo reboot
```

Vuelve a conectarte por SSH.

### 12.2 Zona horaria y nombre

**Comando:**

```bash
sudo timedatectl set-timezone America/Lima
sudo hostnamectl set-hostname iot-dashboard
timedatectl
```

**Salida esperada (ejemplo):**

```text
               Local time: ...
           Universal time: ...
                 Time zone: America/Lima
System clock synchronized: yes
              NTP service: active
```

> Ajusta `America/Lima` a tu zona si el proyecto se presenta en otro país. Una hora correcta es importante para los eventos y los certificados.

### 12.3 Swap (opcional en instancias de 1 GB)

**Comando:**

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

**Salida esperada (ejemplo):**

```text
               total        used        free      shared  buff/cache   available
Mem:           1.0Gi       200Mi       500Mi       1.0Mi       300Mi       600Mi
Swap:          1.0Gi          0B       1.0Gi
```

### 12.4 Actualizaciones automáticas de seguridad

**Comando:**

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Selecciona **Yes** para instalar actualizaciones de seguridad automáticamente. Verifica:

```bash
systemctl status unattended-upgrades --no-pager
```

**Salida esperada:** `active (running)`.

---

## 13. Usuarios Linux, claves SSH y sudo

### 13.1 Los cuatro usuarios

| Usuario | Rol | sudo | Acceso |
| --- | --- | --- | --- |
| `USUARIO_1` | Administrador / despliegue | Completo | SSH con su clave. |
| `USUARIO_2` | Backend / operación MQTT | Limitado a servicios y `mosquitto_passwd` | SSH con su clave. |
| `USUARIO_3` | Firmware / ESP32 | Ninguno | SSH con su clave. |
| `USUARIO_4` | Documentación / auditoría | Ninguno; grupo `adm` para leer logs | SSH con su clave. |

La aplicación se ejecuta con el usuario de sistema **`iotdash`**, sin shell y sin sudo. No uses uno de los cuatro usuarios humanos para el servicio.

> Cambia `USUARIO_1`…`USUARIO_4` por nombres reales (por ejemplo, `ana`, `luis`, `marta`, `jose`). No uses espacios ni acentos en los nombres de usuario.

### 13.2 Crear los usuarios

**Comando:**

```bash
sudo adduser USUARIO_1
sudo adduser USUARIO_2
sudo adduser USUARIO_3
sudo adduser USUARIO_4
```

Cada comando pide una contraseña y datos opcionales. Usa contraseñas largas y distintas. Aunque el acceso SSH será solo con clave, la contraseña se usa para `sudo`.

**Salida esperada (ejemplo):**

```text
info: Adding user `USUARIO_1' ...
info: Creating home directory `/home/USUARIO_1' ...
info: Setting up user USUARIO_1 ...
```

### 13.3 Asignar privilegios mínimos

**Solo el administrador tiene sudo completo:**

```bash
sudo usermod -aG sudo USUARIO_1
```

**USUARIO_2: sudo limitado a operaciones concretas:**

```bash
sudo visudo -f /etc/sudoers.d/iot-operators
```

Contenido:

```sudoers
Cmnd_Alias IOT_SERVICES = /usr/bin/systemctl restart mosquitto, \
                          /usr/bin/systemctl restart iot-dashboard, \
                          /usr/bin/systemctl status mosquitto, \
                          /usr/bin/systemctl status iot-dashboard, \
                          /usr/bin/mosquitto_passwd

USUARIO_2 ALL=(root) NOPASSWD: IOT_SERVICES
```

Guarda y valida:

```bash
sudo chmod 440 /etc/sudoers.d/iot-operators
sudo visudo -c
```

**Salida esperada:**

```text
/etc/sudoers: parsed OK
/etc/sudoers.d/iot-operators: parsed OK
```

**USUARIO_3 no recibe sudo.**

**USUARIO_4 puede leer logs sin sudo:**

```bash
sudo usermod -aG adm,systemd-journal USUARIO_4
```

> `systemctl status` no requiere sudo para leer el estado, pero se incluye por comodidad. Si prefieres un modelo aún más estricto, elimina esas entradas y deja solo `restart` y `mosquitto_passwd`.

### 13.4 Verificar privilegios

**Comando:**

```bash
sudo -l -U USUARIO_1
sudo -l -U USUARIO_2
sudo -l -U USUARIO_3
sudo -l -U USUARIO_4
```

**Salida esperada (resumen):**

```text
User USUARIO_1 may run the following commands on iot-dashboard:
    (ALL : ALL) ALL

User USUARIO_2 may run the following commands on iot-dashboard:
    (root) NOPASSWD: /usr/bin/systemctl restart mosquitto, ...

User USUARIO_3 is not allowed to run sudo on iot-dashboard.

User USUARIO_4 is not allowed to run sudo on iot-dashboard.
```

### 13.5 Crear el usuario del servicio

**Comando:**

```bash
sudo adduser --system --group --home /var/lib/iot-dashboard --shell /usr/sbin/nologin iotdash
id iotdash
```

**Salida esperada (ejemplo):**

```text
uid=998(iotdash) gid=998(iotdash) grupos=998(iotdash)
```

`iotdash` no tiene shell, no tiene sudo y no puede iniciar sesión. Solo ejecuta el servicio.

### 13.6 Endurecer SSH

> **Hazlo al final**, cuando ya verificaste que los cuatro usuarios pueden entrar con su clave. Mantén una sesión SSH abierta mientras pruebas otra; si algo falla, no cierres la primera.

**Comando:**

```bash
sudo tee /etc/ssh/sshd_config.d/99-iot-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowUsers USUARIO_1 USUARIO_2 USUARIO_3 USUARIO_4
EOF
```

Valida y aplica:

```bash
sudo sshd -t
sudo systemctl restart ssh
```

**Salida esperada de `sshd -t`:** ninguna salida (configuración válida).

**Verificación:**

```bash
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|maxauthtries'
```

**Salida esperada (ejemplo):**

```text
permitrootlogin no
pubkeyauthentication yes
passwordauthentication no
maxauthtries 3
allowusers USUARIO_1 USUARIO_2 USUARIO_3 USUARIO_4
```

> `AllowUsers` también bloquea al usuario `ubuntu`. Asegúrate de que los cuatro usuarios ya tengan sus claves antes de aplicar este archivo. Si te quedas fuera, usa **EC2 Instance Connect** o el **Serial Console** de AWS para recuperar el acceso.

### 13.7 Probar el acceso de cada integrante

Cada integrante, desde su equipo:

```bash
ssh -i ~/.ssh/id_ed25519 USUARIO_1@TU_IP_PUBLICA
```

**Salida esperada:**

```text
USUARIO_1@ip-172-31-xx-xx:~$ whoami
USUARIO_1
```

Si ves `Permission denied (publickey)`, revisa:

- El nombre de usuario correcto.
- La clave pública está en `/home/USUARIO_X/.ssh/authorized_keys`.
- Permisos `700` en `.ssh` y `600` en `authorized_keys`.
- El propietario es el usuario, no root.
- `AllowUsers` incluye al usuario.

---

## 14. Node.js 22 LTS con NodeSource

**Comando:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
```

> Descargar el script y revisarlo antes de ejecutarlo es más seguro que `curl | sudo bash`. El script de NodeSource agrega su repositorio y la clave GPG.

**Verificación:**

```bash
node -v
npm -v
which node
```

**Salida esperada (ejemplo):**

```text
v22.16.0
10.9.2
/usr/bin/node
```

> La versión exacta puede cambiar. Lo importante es que sea `v22.x` y que `npm` sea `10.x` o superior.

Si `node` no aparece:

```bash
hash -r
sudo apt-get install -y nodejs
```

---

## 15. Mosquitto: autenticación, ACL y pruebas locales

### 15.1 Instalar Mosquitto

**Comando:**

```bash
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto
systemctl status mosquitto --no-pager
```

**Salida esperada (resumen):**

```text
● mosquitto.service - Mosquitto MQTT Broker
     Loaded: loaded (/lib/systemd/system/mosquitto.service; enabled; ...)
     Active: active (running) since ...
```

### 15.2 Obtener el código en el servidor

**Opción A: Git (recomendado)**

```bash
sudo git clone REPO_URL /opt/iot-dashboard
sudo chown -R iotdash:iotdash /opt/iot-dashboard
```

Sustituye `REPO_URL` por la URL de tu repositorio. Si el repositorio es privado, configura una deploy key de solo lectura o sube el código por `scp`.

**Opción B: `scp` desde tu equipo**

```bash
scp -i RUTA_LLAVE -r ./iot-dashboard USUARIO_1@TU_IP_PUBLICA:/tmp/iot-dashboard
```

Luego, en el servidor:

```bash
sudo mv /tmp/iot-dashboard /opt/iot-dashboard
sudo chown -R iotdash:iotdash /opt/iot-dashboard
```

> No copies `node_modules/` ni `.env` desde tu equipo. Las dependencias se instalan en el servidor y `.env` se crea allí.

### 15.3 Revisar la configuración por defecto

**Comando:**

```bash
sudo grep -R "allow_anonymous\|listener\|password_file\|acl_file" /etc/mosquitto/ 2>/dev/null
```

**Salida esperada:** líneas comentadas o ninguna. Si algún archivo activa `allow_anonymous true`, coméntalo o elimínalo antes de continuar.

### 15.4 Copiar la configuración del proyecto

**Comando:**

```bash
sudo cp /opt/iot-dashboard/deploy/mosquitto/iot.conf /etc/mosquitto/conf.d/iot.conf
sudo cp /opt/iot-dashboard/deploy/mosquitto/aclfile.example /etc/mosquitto/aclfile
```

Contenido de `iot.conf`:

```conf
listener 1883 0.0.0.0
allow_anonymous false
password_file /etc/mosquitto/pwfile
acl_file /etc/mosquitto/aclfile

persistence true
persistence_location /var/lib/mosquitto/
log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
log_type notice
connection_messages true
```

> `listener 1883 0.0.0.0` es necesario si el ESP32 está en otra red. Si el ESP32 y el broker están en la misma red privada o VPN, usa `listener 1883 127.0.0.1` o la IP privada y no abras el puerto en el Security Group.

### 15.5 Crear usuarios y contraseñas MQTT

**Comando (interactivo; recomendado):**

```bash
sudo mosquitto_passwd -c /etc/mosquitto/pwfile dashboard
sudo mosquitto_passwd /etc/mosquitto/pwfile esp32
sudo mosquitto_passwd /etc/mosquitto/pwfile monitor
```

- `-c` crea el archivo y **sobrescribe** si ya existe. Úsalo solo la primera vez.
- Cada comando pide la contraseña dos veces.
- Usa contraseñas distintas, largas y sin espacios.
- No uses `-b` en un equipo compartido: la contraseña quedaría en el historial del shell.

**Proteger el archivo:**

```bash
sudo chown root:mosquitto /etc/mosquitto/pwfile
sudo chmod 640 /etc/mosquitto/pwfile
ls -l /etc/mosquitto/pwfile
```

**Salida esperada:**

```text
-rw-r----- 1 root mosquitto ... /etc/mosquitto/pwfile
```

> Si no vas a usar la cuenta `monitor`, elimina su bloque de la ACL y no la crees. La ACL de ejemplo la incluye solo para observación y capturas.

### 15.6 Ajustar la ACL

**Comando:**

```bash
sudo nano /etc/mosquitto/aclfile
```

Contenido de referencia:

```conf
user dashboard
topic read casa/potenciometro
topic write casa/led
topic read casa/led/estado

user esp32
topic write casa/potenciometro
topic read casa/led
topic write casa/led/estado

user monitor
topic read casa/#
```

**Permisos:**

```bash
sudo chown root:mosquitto /etc/mosquitto/aclfile
sudo chmod 640 /etc/mosquitto/aclfile
```

> Si cambias los nombres de usuario MQTT, actualiza la ACL, `.env` y `firmware/.../secrets.h`. Los nombres deben coincidir exactamente.

### 15.7 Reiniciar y verificar

**Comando:**

```bash
sudo systemctl restart mosquitto
systemctl status mosquitto --no-pager
sudo journalctl -u mosquitto -n 50 --no-pager
sudo ss -ltnp | grep 1883
```

**Salida esperada (resumen):**

```text
Active: active (running)
...
Opening ipv4 listen socket on port 1883.
```

```text
LISTEN 0 1024 0.0.0.0:1883 0.0.0.0:* users:(("mosquitto",pid=...,fd=...))
```

Si el servicio falla:

```bash
sudo tail -n 80 /var/log/mosquitto/mosquitto.log
```

### 15.8 Pruebas locales de publicación y suscripción

**Terminal A — suscriptor de solo lectura:**

```bash
read -rsp "Clave monitor: " MP; echo
mosquitto_sub -h 127.0.0.1 -p 1883 -u monitor -P "$MP" -t 'casa/#' -v
```

**Terminal B — publicar una lectura como ESP32:**

```bash
read -rsp "Clave esp32: " EP; echo
mosquitto_pub -h 127.0.0.1 -p 1883 -u esp32 -P "$EP" -t casa/potenciometro -m 2048
```

**Salida esperada en la Terminal A:**

```text
casa/potenciometro 2048
```

**Publicar una orden como dashboard:**

```bash
read -rsp "Clave dashboard: " DP; echo
mosquitto_pub -h 127.0.0.1 -p 1883 -u dashboard -P "$DP" -t casa/led -m ON
```

**Salida esperada en la Terminal A:**

```text
casa/led ON
```

**Publicar la confirmación como ESP32:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -u esp32 -P "$EP" -t casa/led/estado -m ON
```

**Salida esperada en la Terminal A:**

```text
casa/led/estado ON
```

### 15.9 Pruebas negativas obligatorias

**1. Acceso anónimo rechazado:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -t casa/led -m ON
```

**Salida esperada:**

```text
Connection error: Connection Refused: not authorised.
```

**2. Contraseña incorrecta:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -u dashboard -P 'incorrecta' -t casa/led -m ON
```

**Salida esperada:** el mismo rechazo de conexión.

**3. ACL: el ESP32 no puede publicar en el tópico de órdenes:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -u esp32 -P "$EP" -t casa/led -m ON
```

**Resultado esperado:** el mensaje **no** aparece en el suscriptor `monitor`. El broker registra un `Denied PUBLISH` en el log. `mosquitto_pub` puede terminar con código `0` aunque el mensaje no se entregue; por eso la verificación se hace con el suscriptor.

**4. ACL: el dashboard no puede leer el tópico de órdenes:**

```bash
mosquitto_sub -h 127.0.0.1 -p 1883 -u dashboard -P "$DP" -t casa/led -v
```

**Resultado esperado:** no recibe mensajes publicados en `casa/led`. Si el broker rechaza la suscripción, puede cerrar la conexión o no entregar nada; revisa el log.

> No continúes al despliegue de la aplicación si alguna prueba negativa falla. Un broker con acceso anónimo o ACL demasiado amplia invalida el objetivo de seguridad.

---

## 16. TLS en Mosquitto, puerto 8883

> **Recomendado.** Sin TLS, las credenciales MQTT viajan en claro. Si el ESP32 se conecta desde Internet, usa `8883` o una VPN.

### 16.1 Requisito: dominio y certificado

Necesitas un dominio (por ejemplo, `iot.tudominio.com`) con un registro **A** que apunte a `TU_IP_PUBLICA`. Si aún no tienes HTTPS en Nginx, primero completa la sección [Nginx](#18-nginx-como-proxy-inverso-y-https) y emite el certificado con Certbot.

### 16.2 Copiar los certificados para Mosquitto

Certbot guarda las claves en `/etc/letsencrypt/live/TU_DOMINIO/`, pero Mosquitto no puede leerlas directamente por permisos. Cópialas a `/etc/mosquitto/certs/`:

```bash
sudo mkdir -p /etc/mosquitto/certs
sudo install -m 640 -o root -g mosquitto \
  /etc/letsencrypt/live/TU_DOMINIO/fullchain.pem \
  /etc/mosquitto/certs/fullchain.pem
sudo install -m 640 -o root -g mosquitto \
  /etc/letsencrypt/live/TU_DOMINIO/privkey.pem \
  /etc/mosquitto/certs/privkey.pem
```

**Verificación:**

```bash
sudo ls -l /etc/mosquitto/certs
```

**Salida esperada:**

```text
-rw-r----- 1 root mosquitto ... fullchain.pem
-rw-r----- 1 root mosquitto ... privkey.pem
```

### 16.3 Agregar el listener TLS

Edita `/etc/mosquitto/conf.d/iot.conf` y añade:

```conf
listener 8883 0.0.0.0
certfile /etc/mosquitto/certs/fullchain.pem
keyfile /etc/mosquitto/certs/privkey.pem
tls_version tlsv1.2
```

Reinicia y verifica:

```bash
sudo systemctl restart mosquitto
systemctl status mosquitto --no-pager
sudo journalctl -u mosquitto -n 50 --no-pager
sudo ss -ltnp | grep 8883
```

**Salida esperada:**

```text
Opening ipv4 listen socket on port 8883.
```

### 16.4 Probar TLS desde el servidor

**Comando:**

```bash
openssl s_client -connect TU_DOMINIO:8883 -servername TU_DOMINIO \
  -CAfile /etc/ssl/certs/ca-certificates.crt </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -dates
```

**Salida esperada (ejemplo):**

```text
subject=CN = TU_DOMINIO
notBefore=...
notAfter=...
```

**Suscripción TLS:**

```bash
mosquitto_sub -h TU_DOMINIO -p 8883 \
  --cafile /etc/ssl/certs/ca-certificates.crt \
  -u monitor -P "$MP" -t 'casa/#' -v
```

Si el certificado es válido, la conexión queda a la espera de mensajes. Si ves `certificate verify failed`, revisa la CA, el nombre del host y las fechas.

### 16.5 Renovación automática

Crea un hook de despliegue para copiar los certificados renovados:

```bash
sudo nano /etc/letsencrypt/renewal-hooks/deploy/mosquitto-certs.sh
```

Contenido:

```bash
#!/bin/sh
set -e
install -m 640 -o root -g mosquitto \
  /etc/letsencrypt/live/TU_DOMINIO/fullchain.pem \
  /etc/mosquitto/certs/fullchain.pem
install -m 640 -o root -g mosquitto \
  /etc/letsencrypt/live/TU_DOMINIO/privkey.pem \
  /etc/mosquitto/certs/privkey.pem
systemctl restart mosquitto
```

Permisos:

```bash
sudo chmod 750 /etc/letsencrypt/renewal-hooks/deploy/mosquitto-certs.sh
sudo certbot renew --dry-run
```

**Salida esperada (resumen):** `Congratulations, all simulated renewals succeeded`.

### 16.6 Configurar la aplicación para TLS

Edita `.env`:

```dotenv
MQTT_URL=mqtts://TU_DOMINIO:8883
MQTT_CA_FILE=/etc/ssl/certs/ca-certificates.crt
MQTT_REJECT_UNAUTHORIZED=true
```

Reinicia:

```bash
sudo systemctl restart iot-dashboard
sudo journalctl -u iot-dashboard -n 30 --no-pager
```

**Salida esperada:**

```text
Broker MQTT: mqtts://TU_DOMINIO:8883 · autenticación: habilitada
Conectado al broker MQTT.
```

> Si el servidor no puede resolver `TU_DOMINIO` hacia su propia IP pública (hairpin NAT), agrega una entrada local:
>
> ```bash
> echo "127.0.0.1 TU_DOMINIO" | sudo tee -a /etc/hosts
> ```
>
> El certificado sigue siendo válido porque el nombre coincide. No cambies `MQTT_REJECT_UNAUTHORIZED` a `false`.

### 16.7 Alternativa sin dominio: CA propia

Si no tienes dominio, puedes crear una CA local y un certificado con SAN para `localhost` y `127.0.0.1`:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout ca.key -out ca.crt \
  -subj "/CN=IoT-Lab-CA"

openssl req -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr \
  -subj "/CN=TU_IP_PUBLICA"

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 825 \
  -extfile <(printf "subjectAltName=IP:TU_IP_PUBLICA,DNS:localhost")
```

Luego usa `server.crt` + `server.key` en Mosquitto y `ca.crt` en la aplicación y el ESP32. **No uses `setInsecure()`** en el firmware: eso anula la validación y hace inútil el TLS.

---

## 17. Despliegue de la aplicación

### 17.1 Crear el `.env` de producción

**Comando:**

```bash
cd /opt/iot-dashboard
sudo cp .env.example .env
sudo nano .env
```

Ajusta como mínimo:

```dotenv
NODE_ENV=production
# Acceso directo por IP: 0.0.0.0. Detrás de Nginx: 127.0.0.1.
HOST=0.0.0.0
PORT=3000
# false en acceso directo; true solo detrás de Nginx.
TRUST_PROXY=false
ENABLE_HSTS=false

MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USERNAME=dashboard
MQTT_PASSWORD=UNA_CLAVE_LARGA_Y_UNICA

POT_MAX=4095
STALE_AFTER_MS=15000
HISTORY_SIZE=60
```

**Permisos:**

```bash
sudo chown iotdash:iotdash /opt/iot-dashboard/.env
sudo chmod 600 /opt/iot-dashboard/.env
ls -l /opt/iot-dashboard/.env
```

**Salida esperada:**

```text
-rw------- 1 iotdash iotdash ... /opt/iot-dashboard/.env
```

> `TRUST_PROXY=true` es correcto detrás de Nginx. Si aún no tienes Nginx, déjalo en `false` y actívalo después. `ENABLE_HSTS=true` solo cuando HTTPS funcione; si lo activas antes, los navegadores pueden dejar de cargar el sitio por HTTP.

### 17.2 Instalar dependencias de producción

**Comando:**

```bash
cd /opt/iot-dashboard
sudo -u iotdash -H npm ci --omit=dev
```

**Salida esperada (ejemplo):**

```text
added 120 packages, and audited 121 packages in 9s
found 0 vulnerabilities
```

> `--omit=dev` instala solo dependencias de ejecución. El proyecto no tiene dependencias de desarrollo críticas; `npm run dev` usa `node --watch`, incluido en Node.js.

### 17.3 Instalar el servicio systemd

**Comando:**

```bash
sudo cp /opt/iot-dashboard/deploy/systemd/iot-dashboard.service /etc/systemd/system/iot-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now iot-dashboard
systemctl status iot-dashboard --no-pager
```

**Salida esperada (resumen):**

```text
● iot-dashboard.service - Panel IoT MQTT (potenciometro y LED)
     Loaded: loaded (/etc/systemd/system/iot-dashboard.service; enabled; ...)
     Active: active (running) since ...
```

**Registros:**

```bash
sudo journalctl -u iot-dashboard -n 40 --no-pager
```

**Salida esperada (ejemplo):**

```text
Panel IoT disponible en http://127.0.0.1:3000
Broker MQTT: mqtt://127.0.0.1:1883 · autenticación: habilitada
Tópicos: lecturas=casa/potenciometro · control=casa/led · estado=casa/led/estado
Conectado al broker MQTT.
Suscripción activa: casa/potenciometro, casa/led/estado.
```

### 17.4 Verificar el servicio

**Comando:**

```bash
curl -s http://127.0.0.1:3000/healthz | python3 -m json.tool
```

**Salida esperada:**

```json
{
  "status": "ok",
  "mqtt": {"connected": true, "status": "connected"},
  "pot": {"hasReading": true, "stale": false, "lastReadingAt": 1767225599000},
  "uptimeMs": 60000
}
```

Si `status` es `degraded`:

```bash
sudo journalctl -u iot-dashboard -n 80 --no-pager
sudo systemctl status mosquitto --no-pager
```

### 17.5 Cierre y reinicio ordenados

**Comando:**

```bash
sudo systemctl restart iot-dashboard
sudo systemctl stop iot-dashboard
sudo systemctl start iot-dashboard
```

**Salida esperada en los logs al detener:**

```text
Señal SIGTERM recibida. Cerrando el panel…
```

El servicio tiene `TimeoutStopSec=15`; si no termina, systemd fuerza la parada. El backend cierra Socket.IO, MQTT y HTTP antes de salir.

### 17.6 Endurecimiento del servicio

El unit incluye:

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
UMask=0077
```

`ProtectSystem=strict` deja el sistema de archivos en solo lectura para el servicio. La aplicación solo necesita leer `.env`, `public/`, `views/` y `node_modules/`, así que funciona sin `ReadWritePaths`.

---

## 18. Nginx como proxy inverso y HTTPS

### 18.1 Instalar Nginx

**Comando:**

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

### 18.2 Copiar el sitio

**Comando:**

```bash
sudo cp /opt/iot-dashboard/deploy/nginx/iot-dashboard.conf /etc/nginx/sites-available/iot-dashboard
sudo ln -sf /etc/nginx/sites-available/iot-dashboard /etc/nginx/sites-enabled/iot-dashboard
sudo rm -f /etc/nginx/sites-enabled/default
```

Edita `server_name`:

```bash
sudo nano /etc/nginx/sites-available/iot-dashboard
```

- Si tienes dominio: `server_name TU_DOMINIO;`
- Si vas a entrar por IP: `server_name _;`

El archivo incluye el bloque `/socket.io/` con `Upgrade` y `Connection`, necesario para WebSocket.

### 18.3 Validar y recargar

**Comando:**

```bash
sudo nginx -t
sudo systemctl reload nginx
```

**Salida esperada:**

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 18.4 Probar HTTP

**Comando:**

```bash
curl -I http://TU_IP_PUBLICA
curl -s http://TU_IP_PUBLICA/healthz
```

**Salida esperada (resumen):**

```text
HTTP/1.1 200 OK
Server: nginx
Content-Type: text/html; charset=utf-8
Content-Security-Policy: default-src 'self'; ...
X-Content-Type-Options: nosniff
```

```json
{"status":"ok","mqtt":{"connected":true,...}}
```

> Si obtienes `502 Bad Gateway`, Express no está escuchando en `127.0.0.1:3000`. Revisa `systemctl status iot-dashboard` y `ss -ltnp | grep 3000`.

### 18.5 Emitir el certificado HTTPS con Certbot

**Requisito:** el dominio debe apuntar a `TU_IP_PUBLICA` mediante un registro DNS **A** (o **AAAA** si usas IPv6).

**Comando:**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d TU_DOMINIO
```

Certbot modifica la configuración de Nginx y ofrece redirigir HTTP a HTTPS. Acepta la redirección.

**Verificación:**

```bash
sudo certbot renew --dry-run
curl -I https://TU_DOMINIO
```

**Salida esperada:**

```text
HTTP/2 200
strict-transport-security: max-age=15552000
```

### 18.6 Activar confianza en el proxy y HSTS

Cuando HTTPS funcione:

```bash
sudo nano /opt/iot-dashboard/.env
```

```dotenv
TRUST_PROXY=true
ENABLE_HSTS=true
```

Reinicia:

```bash
sudo systemctl restart iot-dashboard
```

**Verificación:**

```bash
curl -sI https://TU_DOMINIO | grep -i strict-transport-security
```

**Salida esperada:**

```text
strict-transport-security: max-age=15552000
```

> HSTS le dice al navegador que use solo HTTPS durante 180 días. No lo actives hasta que el certificado y la redirección funcionen. Si algo falla, puedes desactivarlo, pero los navegadores que ya lo recibieron tardarán en olvidarlo.

### 18.7 Verificar WebSocket

1. Abre `https://TU_DOMINIO` en el navegador.
2. DevTools → **Network** → filtro **WS**.
3. Recarga la página.
4. Debe aparecer una conexión `socket.io/?EIO=4&transport=websocket` con estado **101 Switching Protocols**.

Si falla:

- Confirma que el bloque `/socket.io/` tiene `proxy_http_version 1.1`, `Upgrade` y `Connection "upgrade"`.
- Revisa `sudo nginx -t` y `sudo tail -n 50 /var/log/nginx/error.log`.
- Confirma que `TRUST_PROXY=true` si estás detrás de Nginx.

### 18.8 Protección adicional del panel (opcional)

El panel no tiene login propio. Si lo publicas en Internet, cualquiera que conozca la URL puede enviar órdenes al LED. Opciones, de más a menos recomendada:

1. **VPN** (WireGuard, Tailscale) y no exponer `80/443` al público.
2. **Restringir el Security Group** a las IPs del aula o de los integrantes.
3. **Autenticación básica en Nginx** para `/` y `/api/` (verifica que WebSocket siga funcionando):

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd USUARIO_PANEL
```

Añade dentro del bloque `server`:

```nginx
auth_basic "Panel IoT";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Luego:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

> La autenticación básica sin HTTPS envía la contraseña en Base64, no cifrada. Úsala solo con TLS. Prueba el panel en una ventana privada y confirma que la gráfica sigue actualizándose; si el WebSocket no hereda las credenciales, protege `/` y `/api/` y deja `/socket.io/` solo para lectura.

---

## 19. Firewall UFW y Security Group final

### 19.1 Configurar UFW

> **Cuidado:** si activas UFW sin permitir SSH, perderás el acceso. Mantén una sesión SSH abierta y verifica antes de cerrar.

**Comando:**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from TU_IP_ADMIN to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Si el ESP32 se conecta desde Internet **y** usas TLS:

```bash
sudo ufw allow from TU_IP_ESP32 to any port 8883 proto tcp
```

Si usas `1883` sin TLS (no recomendado):

```bash
sudo ufw allow from TU_IP_ESP32 to any port 1883 proto tcp
```

Activar:

```bash
sudo ufw enable
sudo ufw status verbose
```

**Salida esperada (ejemplo):**

```text
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    TU_IP_ADMIN
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
8883/tcp                   ALLOW IN    TU_IP_ESP32
```

### 19.2 Verificar puertos escuchando

**Comando:**

```bash
sudo ss -ltnp
```

**Salida esperada (resumen):**

```text
LISTEN 0 4096 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=...,fd=...))
LISTEN 0 1024 0.0.0.0:1883   0.0.0.0:* users:(("mosquitto",...))
LISTEN 0 1024 0.0.0.0:8883   0.0.0.0:* users:(("mosquitto",...))
LISTEN 0 511  0.0.0.0:80     0.0.0.0:* users:(("nginx",...))
LISTEN 0 511  0.0.0.0:443    0.0.0.0:* users:(("nginx",...))
```

Lo importante: **`3000` debe aparecer en `127.0.0.1`, no en `0.0.0.0`.**

### 19.3 Security Group final

| Regla | Puerto | Origen | Nota |
| --- | --- | --- | --- |
| SSH | `22` | `TU_IP_ADMIN/32` | Si tu IP cambia, actualiza la regla. |
| HTTP | `80` | `0.0.0.0/0` | Solo para redirección/Certbot. |
| HTTPS | `443` | `0.0.0.0/0` | Panel. |
| MQTTS | `8883` | `TU_IP_ESP32/32` | Recomendado. |
| MQTT | `1883` | `TU_IP_ESP32/32` | Solo si no usas TLS. |

**No agregues** `3000`, `8080`, `9000`, `3306` ni paneles de administración.

### 19.4 Si te quedas fuera por UFW

- Usa **EC2 Instance Connect** o el **Serial Console** de AWS.
- O reinicia la instancia y usa un **user data** temporal para desactivar UFW; luego corrige la regla.
- No desactives UFW de forma permanente.

---

## 20. ESP32: hardware, firmware y pruebas

### 20.1 Materiales y cableado

| Componente | Conexión |
| --- | --- |
| Potenciómetro, extremo 1 | `3V3` |
| Potenciómetro, extremo 2 | `GND` |
| Potenciómetro, cursor (wiper) | `GPIO34` |
| LED, ánodo | `GPIO2` → resistencia 220–330 Ω |
| LED, cátodo | `GND` |

> `GPIO34` es solo entrada y no tiene pull-up interno; es adecuado para el cursor de un potenciómetro. No alimentes el potenciómetro con 5 V si el ADC del ESP32 está configurado para 3.3 V.

### 20.2 Preparar Arduino IDE

1. Instala **Arduino IDE 2.x**.
2. **File → Preferences → Additional Boards Manager URLs:**

```text
https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

3. **Tools → Board → Boards Manager:** busca `esp32` e instala **esp32 by Espressif Systems**.
4. **Tools → Manage Libraries:** instala **PubSubClient** de Nick O'Leary.
5. Selecciona **Tools → Board → ESP32 Arduino → ESP32 Dev Module**.
6. Selecciona el puerto correcto.

### 20.3 Configurar los secretos del firmware

**Comando:**

```bash
cd firmware/esp32_potenciometro_led
cp secrets.h.example secrets.h
```

Edita `secrets.h`:

```cpp
#define WIFI_SSID "TU_RED_WIFI"
#define WIFI_PASSWORD "TU_CLAVE_WIFI"

#define MQTT_HOST "TU_IP_PUBLICA"
#define MQTT_PORT 1883
#define MQTT_USERNAME "esp32"
#define MQTT_PASSWORD "TU_CLAVE_MQTT_ESP32"
#define MQTT_CLIENT_ID "esp32-casa"
```

> `secrets.h` está en `.gitignore`. No lo subas. No uses la misma contraseña para WiFi y MQTT. Si usas TLS, `MQTT_HOST` debe ser el dominio del certificado y el puerto `8883`.

### 20.4 Cargar el sketch

1. Abre `esp32_potenciometro_led.ino`.
2. Verifica los pines:

```cpp
constexpr uint8_t POT_PIN = 34;
constexpr uint8_t LED_PIN = 2;
constexpr uint8_t LED_ON_LEVEL = HIGH;
```

Si tu módulo LED es de ánodo común (se enciende con nivel bajo), cambia `LED_ON_LEVEL` a `LOW`.

3. Pulsa **Upload**.
4. Abre el **Serial Monitor** a `115200` baudios.

**Salida esperada (ejemplo):**

```text
[WiFi] Conectando a TU_RED_WIFI
[MQTT] Conectando como esp32-casa-1a2b3c4d
[MQTT] Conectado.
[POT] 2048
[POT] 2051
[POT] 2047
```

Al enviar una orden:

```text
[MQTT] Mensaje en casa/led: ON
[LED] ON
```

### 20.5 Probar el firmware desde el servidor

**Suscriptor:**

```bash
mosquitto_sub -h 127.0.0.1 -p 1883 -u monitor -P "$MP" -t 'casa/#' -v
```

**Salida esperada:**

```text
casa/potenciometro 2048
casa/potenciometro 2051
casa/potenciometro 2047
```

**Enviar ON:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -u dashboard -P "$DP" -t casa/led -m ON
```

**Salida esperada en el suscriptor:**

```text
casa/led ON
casa/led/estado ON
```

El LED físico debe encenderse y el panel debe mostrar **LED encendido / Confirmado**.

**Enviar OFF:**

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -u dashboard -P "$DP" -t casa/led -m OFF
```

**Salida esperada:**

```text
casa/led OFF
casa/led/estado OFF
```

### 20.6 Si el ESP32 está en otra red

- `MQTT_HOST` debe ser `TU_IP_PUBLICA` o `TU_DOMINIO`.
- El Security Group y UFW deben permitir el puerto desde la IP pública del ESP32.
- La red WiFi debe ser **2.4 GHz**; muchos ESP32 no conectan a 5 GHz.
- Si el router tiene aislamiento de clientes, el ESP32 no saldrá a Internet.
- Para producción, usa `8883` con TLS. El sketch incluido usa `1883`; migrarlo requiere `WiFiClientSecure` y el certificado CA.

### 20.7 Migración mínima a TLS en el firmware

El sketch actual usa:

```cpp
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
```

Para TLS:

```cpp
#include <WiFiClientSecure.h>
WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);

// En setup():
secureClient.setCACert(ROOT_CA); // cadena PEM de la CA
mqtt.setServer(MQTT_HOST, 8883);
```

> No uses `secureClient.setInsecure()`. Eso cifra el tráfico pero no valida la identidad del servidor, por lo que un atacante con un certificado falso podría interceptar las credenciales.

### 20.8 Calibración

- El ADC del ESP32 no es perfecto; las lecturas pueden variar algunas unidades.
- `POT_MAX=4095` corresponde a 12 bits. Si tu potenciómetro no llega a `4095`, puedes ajustar `POT_MAX` o mapear el rango real.
- Para reducir ruido, promedia varias lecturas en el firmware:

```cpp
int raw = 0;
for (int i = 0; i < 8; i++) {
  raw += analogRead(POT_PIN);
  delay(2);
}
raw /= 8;
```

- El porcentaje que muestra el panel es `valor / POT_MAX`; no es una medida física calibrada.

---

## 21. Estados de la interfaz

| Estado | Cuándo aparece | Qué muestra |
| --- | --- | --- |
| `Conectando…` | Al cargar la página, antes del primer estado. | Píldora ámbar. |
| `Broker conectado` | MQTT conectado. | Píldora cian. |
| `Reconectando…` | Se perdió la conexión y el cliente reintenta. | Píldora ámbar. |
| `Sin conexión` | El broker está caído o el WebSocket falló. | Píldora roja y alerta. |
| `Esperando datos` | Aún no hay lecturas. | Badge gris. |
| `En vivo` | Llegan lecturas recientes. | Badge cian. |
| `Datos obsoletos` | Pasaron más de `STALE_AFTER_MS` sin lecturas. | Badge ámbar y alerta. |
| `Sin datos` (LED) | No se recibió confirmación del dispositivo. | Tarjeta LED gris. |
| `Confirmado` | El ESP32 publicó `casa/led/estado`. | Badge cian. |
| `Esperando confirmación` | Se publicó una orden y aún no hay confirmación. | Botones deshabilitados y badge azul. |
| `Sin confirmación` | Venció `MQTT_LED_ACK_TIMEOUT_MS`. | Aviso y evento de advertencia. |

### Eventos

- Se conservan los últimos **50** eventos en el servidor.
- La lista muestra hora, nivel (info/success/warn/error) y mensaje.
- **Limpiar vista** solo borra la lista del navegador; no borra el estado del servidor.
- Las lecturas se registran como evento cada `READING_EVENT_INTERVAL_MS` para evitar ruido.

### Interpretación de la confirmación

- El panel muestra la orden como **pendiente** hasta que llega `casa/led/estado`.
- Si el ESP32 no publica confirmación, el panel muestra **Sin confirmación** después de 8 segundos.
- Si tu firmware no implementa `casa/led/estado`, deja `MQTT_TOPIC_LED_STATE=` vacío en `.env` para desactivar la confirmación.

---

## 22. Solución de problemas

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `EADDRINUSE` al arrancar | Otro proceso usa el puerto 3000. | `sudo ss -ltnp \| grep 3000`; detén el proceso o cambia `PORT`. |
| `ECONNREFUSED 127.0.0.1:1883` | Mosquitto no está corriendo o no escucha en esa interfaz. | `systemctl status mosquitto`; `sudo ss -ltnp \| grep 1883`; revisa `iot.conf`. |
| `connack timeout` | El TCP conecta pero el broker no responde; TLS/protocolo incorrecto. | Verifica `mqtt://` vs `mqtts://`, puerto y listener. |
| `Connection Refused: not authorised` | Usuario/contraseña incorrectos o `allow_anonymous false`. | Recrea el usuario con `mosquitto_passwd`, revisa `.env`/`secrets.h`, reinicia Mosquitto. |
| El panel carga pero no hay lecturas | Tópico incorrecto, ESP32 no publica o ACL bloquea la lectura. | `mosquitto_sub -u monitor ... -t casa/potenciometro -v`; revisa logs del backend. |
| `Suscripción rechazada por el broker` | La ACL no permite leer el tópico. | Añade `topic read` para el usuario `dashboard`. |
| La orden devuelve 200 pero el LED no cambia | El ESP32 no está suscrito, la ACL bloquea o el firmware ignora el mensaje. | `mosquitto_sub -t casa/led -v`; revisa serial del ESP32; revisa ACL de `esp32`. |
| LED queda en «Esperando confirmación» | El firmware no publica `casa/led/estado` o el tópico no coincide. | Verifica `MQTT_TOPIC_LED_STATE`, ACL `topic write casa/led/estado` y firmware. |
| `502 Bad Gateway` en Nginx | Express no está corriendo o no escucha en `127.0.0.1:3000`. | `systemctl status iot-dashboard`; `curl http://127.0.0.1:3000/healthz`; `journalctl`. |
| El WebSocket no conecta | Falta `Upgrade`/`Connection` en Nginx o `TRUST_PROXY` mal configurado. | Revisa el bloque `/socket.io/`; `nginx -t`; `TRUST_PROXY=true`. |
| `npm ci` falla con `EBADENGINE` | Node.js es más antiguo que 20. | `node -v`; instala Node 22 con NodeSource. |
| `EACCES` al leer `.env` | Propietario o permisos incorrectos. | `sudo chown iotdash:iotdash .env`; `sudo chmod 600 .env`. |
| `Permission denied (publickey)` | Clave no instalada, usuario incorrecto o `AllowUsers` no lo incluye. | Revisa `authorized_keys`, permisos y `sshd -T`. |
| PuTTY: «Server refused our key» | `.ppk` no corresponde a la clave pública o el usuario no existe. | Verifica el comentario de la clave, el usuario y `authorized_keys`. |
| SSH timeout | Security Group/UFW bloquea el puerto o cambió la IP. | Revisa SG, `ufw status`, Elastic IP. |
| `certificate verify failed` en MQTT TLS | CA incorrecta, hostname distinto o certificado vencido. | Usa el dominio del certificado y `MQTT_CA_FILE` correcto; revisa fechas. |
| El ESP32 no conecta al WiFi | Red de 5 GHz, señal débil o credenciales incorrectas. | Usa 2.4 GHz, acerca el router, revisa `secrets.h`. |
| La gráfica salta mucho | Ruido del ADC. | Promedia lecturas en el firmware; revisa alimentación y masa. |
| La hora de los eventos no coincide | Zona horaria del servidor. | `sudo timedatectl set-timezone America/Lima`. |
| `npm audit` reporta vulnerabilidades | Dependencias desactualizadas. | `npm audit fix` en desarrollo, prueba y vuelve a desplegar. |

### Comandos de diagnóstico rápido

```bash
# Servicios
systemctl status mosquitto iot-dashboard nginx --no-pager

# Puertos
sudo ss -ltnp

# Logs
sudo journalctl -u mosquitto -n 80 --no-pager
sudo journalctl -u iot-dashboard -n 80 --no-pager
sudo tail -n 80 /var/log/nginx/error.log
sudo tail -n 80 /var/log/mosquitto/mosquitto.log

# Healthchecks
curl -s http://127.0.0.1:3000/healthz
curl -sI https://TU_DOMINIO

# MQTT
mosquitto_sub -h 127.0.0.1 -p 1883 -u monitor -P "$MP" -t 'casa/#' -v
```

---

## 23. Checklist de seguridad

### Secretos y configuración

- [ ] `.env` existe solo en el servidor, con permisos `600` y propietario `iotdash`.
- [ ] `.env` está en `.gitignore` y no aparece en `git ls-files`.
- [ ] `.env.example` solo contiene valores ficticios.
- [ ] `secrets.h` del firmware está en `.gitignore`.
- [ ] No hay contraseñas en `iot.conf`, `aclfile`, `README.md` ni en el código.
- [ ] No hay claves privadas en el repositorio ni en capturas.

### Mosquitto

- [ ] `allow_anonymous false`.
- [ ] `password_file` y `acl_file` configurados.
- [ ] `pwfile` y `aclfile` con permisos `640 root:mosquitto`.
- [ ] Usuarios `dashboard`, `esp32` y `monitor` con contraseñas distintas y largas.
- [ ] ACL de mínimo privilegio; el ESP32 no puede publicar en `casa/led`.
- [ ] `mosquitto` habilitado al arranque (`systemctl is-enabled mosquitto`).
- [ ] TLS `8883` o VPN si el broker está expuesto a Internet.
- [ ] `1883` restringido por Security Group y UFW.

### SSH y usuarios

- [ ] Cuatro usuarios humanos, cada uno con su propia clave.
- [ ] `PermitRootLogin no`.
- [ ] `PasswordAuthentication no`.
- [ ] `PubkeyAuthentication yes`.
- [ ] `AllowUsers` solo con los cuatro usuarios.
- [ ] `USUARIO_1` con sudo completo; `USUARIO_2` con sudo limitado; `USUARIO_3` y `USUARIO_4` sin sudo.
- [ ] `iotdash` sin shell y sin sudo.
- [ ] `.ssh` con `700` y `authorized_keys` con `600`.

### Red y aplicación

- [ ] Security Group solo con `22`, `80`, `443` y, si hace falta, `8883`.
- [ ] UFW activo con política de entrada `deny`.
- [ ] Express escucha en `127.0.0.1:3000`, no en `0.0.0.0`.
- [ ] Nginx es el único acceso público.
- [ ] HTTPS con Certbot y redirección desde HTTP.
- [ ] HSTS activo solo después de verificar HTTPS.
- [ ] Panel protegido por VPN, restricción de IP o autenticación adicional si es público.
- [ ] `/healthz` monitoreado.

### Aplicación

- [ ] Validación estricta de `ON`/`OFF`.
- [ ] Límite de 15 órdenes/10 s por IP.
- [ ] Helmet y CSP activos.
- [ ] Sin `innerHTML`; todo el texto dinámico usa `textContent`.
- [ ] Errores saneados; sin credenciales en logs.
- [ ] `npm audit --omit=dev` sin vulnerabilidades.
- [ ] `npm test` y `npm run check` en verde.
- [ ] Cierre ordenado con `SIGTERM`/`SIGINT`.
- [ ] Actualizaciones de seguridad automáticas.

### Decisiones que se evitaron deliberadamente

| Práctica riesgosa | Por qué no se usa |
| --- | --- |
| `allow_anonymous true` | Cualquiera podría leer y controlar el LED. |
| Todos los usuarios en `sudo` | Amplía innecesariamente la superficie de ataque. |
| Webmin/Portainer | Añaden puertos y paneles adicionales que no se necesitan. |
| Abrir `3000`, `8080`, `9000` | Express y herramientas internas no deben ser públicos. |
| `chmod 777` | Rompe el principio de mínimo privilegio. |
| Contraseñas en el código o en `docker-compose` | Se filtran al repositorio y a las capturas. |
| `MQTT_REJECT_UNAUTHORIZED=false` | Desactiva la validación TLS. |
| `setInsecure()` en el ESP32 | Cifra sin verificar la identidad del servidor. |
| `curl \| sudo bash` sin revisar | Ejecuta código remoto sin inspección. |

---

## 24. Evidencias para el informe

Prepara una carpeta con capturas y salidas de comandos. **Tapa o recorta** IPs privadas, IDs de cuenta, correos, contraseñas y claves.

### 24.1 AWS

1. Captura de **EC2 → Instances** con la instancia `iot-dashboard` en estado **Running** y los chequeos `2/2`.
2. Captura de **Elastic IP** asociada.
3. Captura de **Security Group → Inbound rules** (sin `3000`).
4. Captura de la **VPC/Subnet** o del resumen de red.

### 24.2 Usuarios y SSH

```bash
getent passwd USUARIO_1 USUARIO_2 USUARIO_3 USUARIO_4
id USUARIO_1 USUARIO_2 USUARIO_3 USUARIO_4
sudo -l -U USUARIO_1
sudo -l -U USUARIO_2
sudo -l -U USUARIO_3
sudo -l -U USUARIO_4
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers'
```

**Evidencia:** cuatro usuarios, solo uno con sudo completo, root sin login, contraseñas SSH deshabilitadas.

### 24.3 Firewall y puertos

```bash
sudo ufw status verbose
sudo ss -ltnp
```

**Evidencia:** UFW activo, solo puertos necesarios, Express en `127.0.0.1:3000`.

### 24.4 Mosquitto

```bash
systemctl status mosquitto --no-pager
systemctl is-enabled mosquitto
sudo ss -ltnp | grep -E '1883|8883'
sudo tail -n 40 /var/log/mosquitto/mosquitto.log
```

**Evidencia:** broker activo y habilitado, listeners correctos.

### 24.5 Pruebas MQTT

1. Suscriptor `monitor` recibiendo `casa/potenciometro`.
2. Publicación `esp32` en `casa/potenciometro`.
3. Publicación `dashboard` en `casa/led`.
4. Confirmación `esp32` en `casa/led/estado`.
5. **Acceso anónimo rechazado**.
6. **ACL denegada**: `esp32` intenta publicar en `casa/led` y el mensaje no llega.
7. Si usas TLS: `openssl s_client` con `Verify return code: 0 (ok)`.

### 24.6 Aplicación

```bash
systemctl status iot-dashboard --no-pager
sudo journalctl -u iot-dashboard -n 40 --no-pager
curl -s http://127.0.0.1:3000/healthz | python3 -m json.tool
curl -sI https://TU_DOMINIO
```

**Evidencia:** servicio activo, `/healthz` en `ok`, HTTPS con HSTS.

### 24.7 Interfaz

- Captura de escritorio a 1440 px con lecturas y gráfica.
- Captura móvil a 390 px sin desbordamiento horizontal.
- Captura con LED **ON** confirmado y **OFF** confirmado.
- Captura del estado **Datos obsoletos** (detén el ESP32 15 s).
- Captura del estado **Sin conexión** (detén Mosquitto).
- Captura de la lista de eventos con una orden y una confirmación.
- Consola del navegador sin errores de CSP.

### 24.8 ESP32

- Foto del montaje (potenciómetro, LED, resistencia, ESP32).
- Captura del **Serial Monitor** a 115200 con `[POT]`, `[LED] ON` y `[LED] OFF`.
- Video corto o secuencia de capturas del LED físico encendiendo/apagando desde el panel.

### 24.9 Pruebas y repositorio

```bash
npm test
npm run check
npm audit --omit=dev
git ls-files | grep -E '\.env$|secrets\.h$|\.pem$|\.ppk$' || echo "Sin secretos rastreados"
```

**Evidencia:** pruebas en verde, auditoría limpia, ningún secreto en Git.

### 24.10 Cierre ordenado

```bash
sudo systemctl stop iot-dashboard
sudo journalctl -u iot-dashboard -n 20 --no-pager
sudo systemctl start iot-dashboard
```

**Evidencia:** log con `Señal SIGTERM recibida. Cerrando el panel…` y servicio que se detiene sin errores.

---

## 25. Verificación local realizada

Esta sección documenta lo que **sí** se ejecutó en el entorno de desarrollo. No sustituye las evidencias del servidor ni del hardware.

### 25.1 Entorno

- Windows 11.
- Node.js `v22.16.0`.
- npm `10.9.2`.
- Broker MQTT local compatible con Mosquitto (Aedes) y simulador de ESP32, usados solo para validar la interfaz. No forman parte del repositorio.
- Navegador Chrome en modo headless para capturas a 1440 px y 390 px.

### 25.2 Resultados

| Prueba | Resultado |
| --- | --- |
| `npm ci` | Dependencias instaladas correctamente. |
| `npm audit --omit=dev` | `found 0 vulnerabilities`. |
| `npm test` | **24 pruebas aprobadas, 0 fallidas**. |
| `npm run check` | Código de salida `0`, sin errores de sintaxis. |
| Arranque del panel | `Panel IoT disponible en http://127.0.0.1:3000`. |
| Conexión MQTT | `Conectado al broker MQTT` y suscripción activa. |
| Lecturas en vivo | Valor ADC, porcentaje, gráfica y eventos actualizados sin recargar. |
| Orden `ON` | `200`, LED confirmado por el dispositivo simulado. |
| Orden `OFF` | `200`, LED confirmado por el dispositivo simulado. |
| Orden inválida `on` | `400` con mensaje de validación. |
| Broker caído | `503` al enviar orden; `/healthz` en `degraded`. |
| Datos obsoletos | `pot.stale: true` tras 15 s sin lecturas; se recuperó al volver el dispositivo. |
| UTF-8 | `application/json; charset=utf-8`, sin caracteres de reemplazo. |
| Cabeceras | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` presentes. |
| Responsive | Sin desbordamiento horizontal a 390 px; layout correcto a 1440 px. |
| Consola del navegador | Sin errores de CSP ni de WebSocket. |

### 25.3 Bug corregido durante la verificación

El cliente `mqtt` v5 **no acepta** un arreglo de objetos `{ topic, qos }` en `subscribe()`; internamente llama `topic.split('/')` y falla con `topic.split is not a function`. Se corrigió construyendo un mapa `{ topico: { qos } }` en `lib/subscriptions.js` y se agregó una prueba de regresión en `test/subscriptions.test.js`.

### 25.4 Lo que no se ejecutó

- Creación de instancias EC2.
- Instalación de Ubuntu, Mosquitto, NodeSource o Nginx en un servidor remoto.
- Configuración de usuarios Linux y SSH en un servidor real.
- Emisión de certificados TLS reales.
- Carga del firmware en un ESP32 físico.
- Pruebas de puertos desde Internet.

Los bloques de «Salida esperada» de este README son ejemplos para guiar el despliegue, no resultados remotos.

---

## 26. Limitaciones y trabajo futuro

### Limitaciones actuales

- **Historial en memoria:** las lecturas y los eventos se pierden al reiniciar el backend. Para persistencia, añade SQLite, PostgreSQL o InfluxDB.
- **Una sola instancia:** Socket.IO no usa un adaptador Redis; si escalas horizontalmente, los clientes de distintas instancias no comparten eventos.
- **Sin autenticación web:** el panel no tiene login. Protégelo con VPN, restricción de IP o autenticación en Nginx.
- **Sin control de usuarios:** no hay roles ni auditoría por persona; el alcance es académico.
- **Firmware de ejemplo en 1883:** para producción hay que migrar a TLS 8883 con `WiFiClientSecure`.
- **ADC sin calibración fina:** el porcentaje es aproximado; no es una medición de precisión.
- **Un solo LED:** el modelo se puede extender a varios actuadores con tópicos y ACL adicionales.
- **Retención de la orden:** `MQTT_RETAIN_LED=true` hace que el ESP32 reciba la última orden al reconectar. Es intencional, pero puede sorprender; usa `false` si no lo deseas.

### Mejoras sugeridas

1. Persistencia histórica y exportación CSV.
2. Autenticación con OAuth2/OIDC o Nginx `auth_request`.
3. Varios dispositivos y tópicos por sala.
4. Alarmas por umbral y notificaciones.
5. Métricas Prometheus y panel Grafana.
6. Despliegue con Docker Compose y secretos gestionados.
7. CI con GitHub Actions: `npm test`, `npm run check`, `npm audit`.
8. Certificados TLS automatizados también para el ESP32.
9. Pruebas de carga de Socket.IO.
10. Backups cifrados de la configuración (nunca de claves privadas en repositorios).

---

## Créditos y licencia

Proyecto académico de IoT: **ESP32 + MQTT + Node.js + Express + Socket.IO + Mosquitto + Nginx + AWS EC2**.

Licencia **ISC**. Las marcas y nombres de terceros pertenecen a sus respectivos propietarios.

> Si este proyecto se presenta como trabajo académico, adjunta las evidencias de la sección 24 y aclara qué partes se ejecutaron realmente en AWS, en Ubuntu y en el ESP32 físico.
