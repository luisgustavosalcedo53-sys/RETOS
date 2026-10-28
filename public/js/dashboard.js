'use strict';

(() => {
  const numberFormat = new Intl.NumberFormat('es-PE', {
    maximumFractionDigits: 1,
  });
  const timeFormatter = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const dateTimeFormatter = new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  const elements = {
    clock: document.getElementById('clock'),
    brokerPill: document.getElementById('brokerPill'),
    brokerPillText: document.getElementById('brokerPillText'),

    potStatus: document.getElementById('potStatus'),
    gaugeProgress: document.getElementById('gaugeProgress'),
    potValue: document.getElementById('potValue'),
    potPercent: document.getElementById('potPercent'),
    gaugeMax: document.getElementById('gaugeMax'),
    gaugeNote: document.getElementById('gaugeNote'),

    metricValue: document.getElementById('metricValue'),
    metricValueSub: document.getElementById('metricValueSub'),
    metricLedCard: document.getElementById('metricLedCard'),
    metricLed: document.getElementById('metricLed'),
    metricLedSub: document.getElementById('metricLedSub'),
    metricLast: document.getElementById('metricLast'),
    metricLastSub: document.getElementById('metricLastSub'),

    chartCanvas: document.getElementById('chartCanvas'),
    chartEmpty: document.getElementById('chartEmpty'),
    chartMin: document.getElementById('chartMin'),
    chartMax: document.getElementById('chartMax'),
    chartAvg: document.getElementById('chartAvg'),
    chartCount: document.getElementById('chartCount'),

    ledCard: document.getElementById('control'),
    ledBadge: document.getElementById('ledBadge'),
    ledStateLabel: document.getElementById('ledStateLabel'),
    ledSubLabel: document.getElementById('ledSubLabel'),
    ledToggle: document.getElementById('ledToggle'),
    ledOptions: Array.from(document.querySelectorAll('[data-command]')),
    ledTopicHint: document.getElementById('ledTopicHint'),
    ledConfirmHint: document.getElementById('ledConfirmHint'),

    eventList: document.getElementById('eventList'),
    eventEmpty: document.getElementById('eventEmpty'),
    clearEvents: document.getElementById('clearEvents'),

    brokerLabel: document.getElementById('brokerLabel'),
    transportLabel: document.getElementById('transportLabel'),
    mqttSinceLabel: document.getElementById('mqttSinceLabel'),
    readingsCount: document.getElementById('readingsCount'),
    potTopicLabel: document.getElementById('potTopicLabel'),
    ledTopicLabel: document.getElementById('ledTopicLabel'),
    stateTopicLabel: document.getElementById('stateTopicLabel'),
    serverUptime: document.getElementById('serverUptime'),

    alertBanner: document.getElementById('alertBanner'),
    alertTitle: document.getElementById('alertTitle'),
    alertText: document.getElementById('alertText'),
    alertDismiss: document.getElementById('alertDismiss'),

    refreshBtn: document.getElementById('refreshBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    toastStack: document.getElementById('toastStack'),
  };

  const appState = {
    config: {
      potMax: 4095,
      staleAfterMs: 15000,
      historySize: 60,
      topics: {
        pot: 'casa/potenciometro',
        led: 'casa/led',
        ledState: 'casa/led/estado',
      },
    },
    history: [],
    events: [],
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
    mqtt: {
      connected: false,
      status: 'connecting',
      since: null,
      broker: '—',
      tls: false,
    },
    startedAt: null,
    uptimeMs: 0,
    receivedAt: 0,
    pendingCommand: false,
    socketConnected: false,
    socketFailed: false,
    hasConnectedBefore: false,
    dismissedBannerKey: null,
    currentBannerKey: null,
  };

  const renderedEventIds = new Set();
  const lastBanner = {
    key: null,
    signature: '',
    hidden: true,
  };
  let chart = null;
  let socket = null;
  let clockTimer = null;

  // -----------------------------------------------------------------------
  // Formato
  // -----------------------------------------------------------------------
  function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function formatNumber(value) {
    return isNumber(value) ? numberFormat.format(value) : '--';
  }

  function formatPercent(value) {
    return isNumber(value) ? `${numberFormat.format(value)} %` : '-- %';
  }

  function formatClock(value) {
    if (!value) {
      return '--:--:--';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--:--:--' : timeFormatter.format(date);
  }

  function formatDateTime(value) {
    if (!value) {
      return 'Sin fecha';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Sin fecha'
      : dateTimeFormatter.format(date);
  }

  function formatRelative(value) {
    if (!value) {
      return 'Sin lecturas todavía';
    }
    const diff = Math.max(0, Date.now() - value);
    if (diff < 2500) {
      return 'Ahora mismo';
    }
    if (diff < 60000) {
      return `Hace ${Math.floor(diff / 1000)} s`;
    }
    if (diff < 3600000) {
      return `Hace ${Math.floor(diff / 60000)} min`;
    }
    if (diff < 86400000) {
      return `Hace ${Math.floor(diff / 3600000)} h`;
    }
    return `Hace ${Math.floor(diff / 86400000)} d`;
  }

  function formatDuration(ms) {
    if (!isNumber(ms) || ms < 0) {
      return '—';
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds} s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} h ${minutes % 60} min`;
    }
    return `${Math.floor(hours / 24)} d ${hours % 24} h`;
  }

  // -----------------------------------------------------------------------
  // Gráfica en canvas (sin librerías externas ni CDN)
  // -----------------------------------------------------------------------
  class HistoryChart {
    constructor(canvas, emptyElement) {
      this.canvas = canvas;
      this.emptyElement = emptyElement;
      this.context = canvas.getContext('2d');
      this.points = [];
      this.maxPoints = 60;
      this.lastWidth = 0;
      this.lastHeight = 0;

      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => this.draw());
        this.resizeObserver.observe(canvas.parentElement);
      } else {
        window.addEventListener('resize', () => this.draw());
      }
      this.draw();
    }

    setMaxPoints(maxPoints) {
      this.maxPoints = Math.max(10, Math.min(500, maxPoints || 60));
      if (this.points.length > this.maxPoints) {
        this.points = this.points.slice(-this.maxPoints);
      }
      this.draw();
    }

    setPoints(points) {
      this.points = Array.isArray(points)
        ? points
            .filter((point) => point && isNumber(Number(point.percent)))
            .slice(-this.maxPoints)
        : [];
      this.draw();
    }

    addPoint(point) {
      if (!point || !isNumber(Number(point.percent))) {
        return;
      }
      this.points.push({
        value: Number(point.value),
        percent: Number(point.percent),
        at: Number(point.at),
      });
      if (this.points.length > this.maxPoints) {
        this.points.splice(0, this.points.length - this.maxPoints);
      }
      this.draw();
    }

    draw() {
      const canvas = this.canvas;
      if (!canvas || !this.context) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = this.context;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const padding = { top: 15, right: 12, bottom: 27, left: 39 };
      const plotWidth = Math.max(1, rect.width - padding.left - padding.right);
      const plotHeight = Math.max(1, rect.height - padding.top - padding.bottom);
      const fontFamily =
        '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

      ctx.font = `10px ${fontFamily}`;
      ctx.textBaseline = 'middle';

      // Rejilla horizontal y etiquetas de porcentaje.
      for (let index = 0; index <= 4; index += 1) {
        const ratio = index / 4;
        const y = padding.top + plotHeight * ratio;
        const value = 100 - ratio * 100;
        ctx.beginPath();
        ctx.strokeStyle = index === 4 ? 'rgba(97, 117, 143, 0.28)' : 'rgba(97, 117, 143, 0.13)';
        ctx.lineWidth = 1;
        ctx.moveTo(padding.left, y + 0.5);
        ctx.lineTo(padding.left + plotWidth, y + 0.5);
        ctx.stroke();

        ctx.fillStyle = '#61758f';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(value)}%`, padding.left - 9, y);
      }

      if (this.points.length === 0) {
        this.emptyElement.hidden = false;
        return;
      }
      this.emptyElement.hidden = true;

      const xFor = (index) =>
        this.points.length === 1
          ? padding.left + plotWidth / 2
          : padding.left + (plotWidth * index) / (this.points.length - 1);
      const yFor = (percent) =>
        padding.top +
        plotHeight -
        (Math.max(0, Math.min(100, percent)) / 100) * plotHeight;

      const coordinates = this.points.map((point, index) => ({
        x: xFor(index),
        y: yFor(point.percent),
      }));

      // Área bajo la curva.
      const areaGradient = ctx.createLinearGradient(
        0,
        padding.top,
        0,
        padding.top + plotHeight
      );
      areaGradient.addColorStop(0, 'rgba(47, 123, 255, 0.28)');
      areaGradient.addColorStop(0.65, 'rgba(34, 211, 238, 0.08)');
      areaGradient.addColorStop(1, 'rgba(34, 211, 238, 0)');

      ctx.beginPath();
      ctx.moveTo(coordinates[0].x, padding.top + plotHeight);
      ctx.lineTo(coordinates[0].x, coordinates[0].y);
      for (let index = 1; index < coordinates.length; index += 1) {
        ctx.lineTo(coordinates[index].x, coordinates[index].y);
      }
      ctx.lineTo(
        coordinates[coordinates.length - 1].x,
        padding.top + plotHeight
      );
      ctx.closePath();
      ctx.fillStyle = areaGradient;
      ctx.fill();

      // Línea principal.
      const lineGradient = ctx.createLinearGradient(
        padding.left,
        0,
        padding.left + plotWidth,
        0
      );
      lineGradient.addColorStop(0, '#2f7bff');
      lineGradient.addColorStop(1, '#22d3ee');

      ctx.beginPath();
      ctx.moveTo(coordinates[0].x, coordinates[0].y);
      for (let index = 1; index < coordinates.length; index += 1) {
        ctx.lineTo(coordinates[index].x, coordinates[index].y);
      }
      ctx.strokeStyle = lineGradient;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(34, 211, 238, 0.42)';
      ctx.shadowBlur = 9;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Punto actual.
      const last = coordinates[coordinates.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = '#eaf2ff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 7.2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Etiquetas de tiempo: inicio, centro y final.
      const labelIndexes = Array.from(
        new Set([
          0,
          Math.floor((this.points.length - 1) / 2),
          this.points.length - 1,
        ])
      );
      ctx.fillStyle = '#61758f';
      ctx.font = `10px ${fontFamily}`;
      ctx.textBaseline = 'alphabetic';
      for (const index of labelIndexes) {
        const point = this.points[index];
        const x = xFor(index);
        const label = formatClock(point.at);
        if (index === 0) {
          ctx.textAlign = 'left';
        } else if (index === this.points.length - 1) {
          ctx.textAlign = 'right';
        } else {
          ctx.textAlign = 'center';
        }
        ctx.fillText(label, x, rect.height - 7);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  function renderConfig() {
    const max = isNumber(Number(appState.config.potMax))
      ? Number(appState.config.potMax)
      : 4095;
    elements.gaugeMax.textContent = numberFormat.format(max);
    elements.gaugeNote.textContent = `0 a ${numberFormat.format(max)}`;
    elements.ledTopicHint.textContent = appState.config.topics.led || 'casa/led';
    elements.potTopicLabel.textContent =
      appState.config.topics.pot || 'casa/potenciometro';
    elements.ledTopicLabel.textContent = appState.config.topics.led || 'casa/led';

    const ledStateTopic = appState.config.topics.ledState;
    elements.stateTopicLabel.textContent = ledStateTopic || 'Desactivada';
    elements.ledConfirmHint.replaceChildren();
    if (ledStateTopic) {
      const code = document.createElement('code');
      code.textContent = ledStateTopic;
      elements.ledConfirmHint.append('La confirmación se lee de ', code, '.');
    } else {
      elements.ledConfirmHint.textContent =
        'Sin confirmación configurada: se muestra la última orden enviada.';
    }

    if (chart) {
      chart.setMaxPoints(appState.config.historySize);
    }
  }

  function renderPot() {
    const pot = appState.pot;
    elements.readingsCount.textContent = numberFormat.format(pot.count || 0);

    if (!isNumber(pot.value)) {
      elements.potValue.textContent = '--';
      elements.potValue.classList.add('is-empty');
      elements.potPercent.textContent = '-- %';
      elements.gaugeProgress.setAttribute('stroke-dasharray', '0 100');
      elements.metricValue.textContent = '--';
      elements.metricValueSub.textContent = 'Sin lecturas todavía';
      elements.metricLast.textContent = '--:--:--';
      elements.metricLastSub.textContent = 'Sin lecturas todavía';
      elements.potStatus.textContent = 'Esperando datos';
      elements.potStatus.dataset.state = 'idle';
      return;
    }

    const percent = Math.max(0, Math.min(100, Number(pot.percent) || 0));
    elements.potValue.textContent = formatNumber(pot.value);
    elements.potValue.classList.remove('is-empty');
    elements.potPercent.textContent = formatPercent(percent);
    elements.gaugeProgress.setAttribute(
      'stroke-dasharray',
      `${percent.toFixed(1)} 100`
    );

    elements.metricValue.textContent = formatNumber(pot.value);
    elements.metricValueSub.textContent = `${formatPercent(percent)} del recorrido`;
    elements.metricLast.textContent = formatClock(pot.at);
    elements.metricLastSub.textContent = formatRelative(pot.at);

    if (pot.stale) {
      elements.potStatus.textContent = 'Datos antiguos';
      elements.potStatus.dataset.state = 'warning';
    } else {
      elements.potStatus.textContent = 'En vivo';
      elements.potStatus.dataset.state = 'live';
    }
  }

  function renderLed() {
    const led = appState.led;
    const ledState = led.state === 'ON' || led.state === 'OFF' ? led.state : 'UNKNOWN';
    const cardState = ledState === 'ON' ? 'on' : ledState === 'OFF' ? 'off' : 'unknown';
    const hasState = ledState !== 'UNKNOWN';
    const stateTopic = appState.config.topics.ledState;

    elements.ledCard.dataset.state = cardState;
    elements.metricLedCard.dataset.state = cardState;
    elements.ledToggle.dataset.state = cardState;

    elements.metricLed.textContent = hasState ? ledState : 'SIN DATOS';
    if (hasState && led.confirmed) {
      elements.metricLedSub.textContent = `Confirmado a las ${formatClock(led.at)}`;
    } else if (hasState) {
      elements.metricLedSub.textContent = stateTopic
        ? 'Orden enviada; esperando confirmación'
        : 'Última orden conocida';
    } else {
      elements.metricLedSub.textContent = 'Esperando estado del dispositivo';
    }

    elements.ledStateLabel.textContent = hasState
      ? `LED ${ledState === 'ON' ? 'encendido' : 'apagado'}`
      : 'LED sin estado';

    if (hasState && led.confirmed) {
      elements.ledSubLabel.textContent = `Confirmado por el dispositivo a las ${formatClock(led.at)}.`;
    } else if (hasState && stateTopic) {
      elements.ledSubLabel.textContent = `Orden ${ledState} enviada. Esperando confirmación del ESP32…`;
    } else if (hasState) {
      elements.ledSubLabel.textContent =
        'Última orden conocida. El dispositivo no publica confirmación.';
    } else {
      elements.ledSubLabel.textContent =
        'Aún no hay estado del LED. Conecta el broker para controlarlo.';
    }

    if (!hasState) {
      elements.ledBadge.textContent = 'Sin datos';
      elements.ledBadge.dataset.state = 'idle';
    } else if (led.confirmed) {
      elements.ledBadge.textContent = 'Confirmado';
      elements.ledBadge.dataset.state = 'live';
    } else {
      elements.ledBadge.textContent = 'Pendiente';
      elements.ledBadge.dataset.state = 'pending';
    }

    for (const button of elements.ledOptions) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.command === ledState)
      );
    }

    updateLedControls();
  }

  function updateLedControls() {
    const disabled = !appState.mqtt.connected || appState.pendingCommand;
    for (const button of elements.ledOptions) {
      button.disabled = disabled;
    }
    elements.ledToggle.classList.toggle('is-pending', appState.pendingCommand);
    elements.ledToggle.setAttribute(
      'aria-busy',
      String(appState.pendingCommand)
    );
  }

  function renderMqtt() {
    const mqtt = appState.mqtt;
    const status = ['connected', 'connecting', 'reconnecting', 'disconnected'].includes(
      mqtt.status
    )
      ? mqtt.status
      : 'disconnected';

    elements.brokerPill.dataset.state = status;
    const labels = {
      connected: 'Broker conectado',
      connecting: 'Conectando…',
      reconnecting: 'Reconectando…',
      disconnected: 'Broker desconectado',
    };
    elements.brokerPillText.textContent = labels[status];

    elements.brokerLabel.textContent = mqtt.broker || '—';
    elements.transportLabel.textContent = mqtt.tls
      ? 'MQTT sobre TLS · cifrado'
      : 'MQTT · sin cifrar';

    if (mqtt.since) {
      elements.mqttSinceLabel.textContent = mqtt.connected
        ? formatClock(mqtt.since)
        : `${formatClock(mqtt.since)} (última)`;
    } else {
      elements.mqttSinceLabel.textContent = '—';
    }

    updateLedControls();
    updateBanner();
  }

  function renderHistory() {
    if (!chart) {
      return;
    }
    if (!Array.isArray(appState.history)) {
      appState.history = [];
    }
    chart.setPoints(appState.history);
    updateChartStats();
  }

  function updateChartStats() {
    const values = appState.history
      .map((point) => Number(point.percent))
      .filter((value) => Number.isFinite(value));

    if (values.length === 0) {
      elements.chartMin.textContent = '--';
      elements.chartMax.textContent = '--';
      elements.chartAvg.textContent = '--';
      elements.chartCount.textContent = '0 muestras';
      elements.chartCanvas.setAttribute(
        'aria-label',
        'Gráfica de las últimas lecturas del potenciómetro. Aún no hay datos.'
      );
      return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    elements.chartMin.textContent = formatPercent(min);
    elements.chartMax.textContent = formatPercent(max);
    elements.chartAvg.textContent = formatPercent(avg);
    elements.chartCount.textContent = `${values.length} ${
      values.length === 1 ? 'muestra' : 'muestras'
    }`;
    elements.chartCanvas.setAttribute(
      'aria-label',
      `Gráfica de ${values.length} lecturas del potenciómetro. Mínimo ${formatPercent(
        min
      )}, máximo ${formatPercent(max)}, media ${formatPercent(avg)}.`
    );
  }

  function renderDetails() {
    updateUptime();
  }

  function updateUptime() {
    if (!appState.receivedAt) {
      elements.serverUptime.textContent = '—';
      return;
    }
    const elapsed = Date.now() - appState.receivedAt;
    elements.serverUptime.textContent = formatDuration(
      Math.max(0, appState.uptimeMs + elapsed)
    );
  }

  function renderEvents(events) {
    elements.eventList.replaceChildren();
    renderedEventIds.clear();

    const ordered = (Array.isArray(events) ? events : [])
      .filter((event) => event && event.message)
      .sort((a, b) => Number(b.at) - Number(a.at))
      .slice(0, 50);

    if (ordered.length === 0) {
      elements.eventEmpty.hidden = false;
      return;
    }

    elements.eventEmpty.hidden = true;
    const fragment = document.createDocumentFragment();
    for (const event of ordered) {
      renderedEventIds.add(String(event.id || `${event.at}-${event.message}`));
      fragment.append(createEventNode(event));
    }
    elements.eventList.append(fragment);
  }

  function createEventNode(event) {
    const item = document.createElement('li');
    item.className = 'event-item';
    item.dataset.id = String(event.id || `${event.at}-${event.message}`);
    const level = ['success', 'warn', 'error'].includes(event.level)
      ? event.level
      : 'info';
    item.dataset.level = level;

    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = formatClock(event.at);
    time.title = formatDateTime(event.at);

    const dot = document.createElement('span');
    dot.className = 'event-dot';
    dot.setAttribute('aria-hidden', 'true');

    const message = document.createElement('p');
    message.className = 'event-message';
    message.textContent = String(event.message);

    item.append(time, dot, message);
    return item;
  }

  function addEvent(event) {
    if (!event || !event.message) {
      return;
    }
    const id = String(event.id || `${event.at}-${event.message}`);
    if (renderedEventIds.has(id)) {
      return;
    }
    renderedEventIds.add(id);
    elements.eventEmpty.hidden = true;
    elements.eventList.prepend(createEventNode(event));
    while (elements.eventList.children.length > 50) {
      const last = elements.eventList.lastElementChild;
      if (!last) {
        break;
      }
      renderedEventIds.delete(String(last.dataset.id || ''));
      last.remove();
    }
  }

  // -----------------------------------------------------------------------
  // Avisos
  // -----------------------------------------------------------------------
  function updateBanner() {
    let key = null;
    let type = 'warning';
    let title = '';
    let text = '';

    if (appState.socketFailed) {
      key = 'socket-down';
      type = 'error';
      title = 'Conexión en tiempo real perdida';
      text =
        'El panel no está recibiendo actualizaciones. Se intentará reconectar automáticamente.';
    } else if (appState.mqtt.status === 'disconnected') {
      key = 'mqtt-down';
      type = 'error';
      title = 'Sin conexión con el broker MQTT';
      text =
        'Las lecturas y el control no están disponibles. El servidor reintentará la conexión.';
    } else if (appState.mqtt.status === 'reconnecting') {
      key = 'mqtt-reconnecting';
      title = 'Reconectando con el broker MQTT';
      text =
        'El panel mantiene la última información conocida mientras se restablece la conexión.';
    } else if (appState.pot.stale) {
      key = 'stale-data';
      title = 'No llegan lecturas del potenciómetro';
      text = appState.pot.at
        ? `La última lectura supera el umbral de ${formatDuration(
            appState.config.staleAfterMs
          )}. Revisa el ESP32 y el tópico ${appState.config.topics.pot}.`
        : 'Todavía no se ha recibido ninguna lectura. Revisa el ESP32 y la configuración MQTT.';
    }

    if (!key) {
      elements.alertBanner.hidden = true;
      lastBanner.key = null;
      lastBanner.signature = '';
      lastBanner.hidden = true;
      appState.currentBannerKey = null;
      appState.dismissedBannerKey = null;
      return;
    }

    if (appState.dismissedBannerKey === key) {
      elements.alertBanner.hidden = true;
      lastBanner.hidden = true;
      return;
    }

    const signature = `${type}|${title}|${text}`;
    if (
      lastBanner.key === key &&
      lastBanner.signature === signature &&
      !lastBanner.hidden
    ) {
      return;
    }

    appState.currentBannerKey = key;
    elements.alertBanner.hidden = false;
    elements.alertBanner.dataset.type = type;
    elements.alertTitle.textContent = title;
    elements.alertText.textContent = text;
    lastBanner.key = key;
    lastBanner.signature = signature;
    lastBanner.hidden = false;
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.type = type;
    toast.textContent = String(message);
    elements.toastStack.append(toast);

    while (elements.toastStack.children.length > 4) {
      elements.toastStack.firstElementChild?.remove();
    }

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 200);
    }, 4600);
  }

  // -----------------------------------------------------------------------
  // Estado
  // -----------------------------------------------------------------------
  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const incomingConfig = snapshot.config && typeof snapshot.config === 'object'
      ? snapshot.config
      : {};
    const incomingTopics =
      incomingConfig.topics && typeof incomingConfig.topics === 'object'
        ? incomingConfig.topics
        : {};

    appState.config = {
      ...appState.config,
      ...incomingConfig,
      topics: {
        ...appState.config.topics,
        ...incomingTopics,
      },
    };

    if (snapshot.pot && typeof snapshot.pot === 'object') {
      appState.pot = {
        value: numberOrNull(snapshot.pot.value),
        percent: numberOrNull(snapshot.pot.percent),
        at: numberOrNull(snapshot.pot.at),
        stale: Boolean(snapshot.pot.stale),
        count: Number(snapshot.pot.count) || 0,
      };
    }

    if (snapshot.led && typeof snapshot.led === 'object') {
      appState.led = {
        state: snapshot.led.state === 'ON' || snapshot.led.state === 'OFF'
          ? snapshot.led.state
          : 'UNKNOWN',
        confirmed: Boolean(snapshot.led.confirmed),
        at: numberOrNull(snapshot.led.at),
        source: snapshot.led.source || null,
      };
    }

    if (snapshot.mqtt && typeof snapshot.mqtt === 'object') {
      appState.mqtt = {
        connected: Boolean(snapshot.mqtt.connected),
        status: snapshot.mqtt.status || (snapshot.mqtt.connected ? 'connected' : 'disconnected'),
        since: numberOrNull(snapshot.mqtt.since),
        broker: snapshot.mqtt.broker || '—',
        tls: Boolean(snapshot.mqtt.tls),
      };
    }

    const historySize = Number(appState.config.historySize) || 60;
    appState.history = Array.isArray(snapshot.history)
      ? snapshot.history
          .filter((point) => point && isNumber(Number(point.percent)))
          .sort((a, b) => Number(a.at) - Number(b.at))
          .slice(-historySize)
          .map((point) => ({
            value: Number(point.value),
            percent: Number(point.percent),
            at: Number(point.at),
          }))
      : [];

    appState.events = Array.isArray(snapshot.events) ? snapshot.events.slice(0, 50) : [];

    appState.startedAt = Number(snapshot.startedAt) || appState.startedAt;
    appState.uptimeMs = Number(snapshot.uptimeMs) || 0;
    appState.receivedAt = Date.now();

    renderConfig();
    renderPot();
    renderLed();
    renderMqtt();
    renderEvents(appState.events);
    renderHistory();
    renderDetails();
    updateBanner();
  }

  async function loadState({ silent = false } = {}) {
    elements.refreshBtn.classList.add('is-spinning');
    try {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`El servidor respondió ${response.status}.`);
      }
      const data = await response.json();
      applySnapshot(data);
      if (!silent) {
        showToast('Estado actualizado.', 'info');
      }
    } catch (error) {
      if (!silent) {
        showToast(
          error && error.message
            ? error.message
            : 'No se pudo consultar el estado del panel.',
          'error'
        );
      }
    } finally {
      elements.refreshBtn.classList.remove('is-spinning');
    }
  }

  // -----------------------------------------------------------------------
  // Socket.IO
  // -----------------------------------------------------------------------
  function connectSocket() {
    if (typeof window.io !== 'function') {
      appState.socketFailed = true;
      updateBanner();
      showToast('No se pudo cargar el cliente WebSocket.', 'error');
      return;
    }

    socket = window.io({
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socket.on('connect', () => {
      const wasConnected = appState.socketConnected;
      appState.socketConnected = true;
      appState.socketFailed = false;
      updateBanner();
      if (wasConnected || appState.hasConnectedBefore) {
        showToast('Panel reconectado en tiempo real.', 'info');
      }
      appState.hasConnectedBefore = true;
    });

    socket.on('disconnect', (reason) => {
      const wasConnected = appState.socketConnected;
      appState.socketConnected = false;
      appState.socketFailed = true;
      updateBanner();
      if (wasConnected) {
        showToast('Se perdió la conexión en tiempo real.', 'warn');
      }
      if (reason === 'io server disconnect' && socket) {
        socket.connect();
      }
    });

    socket.on('connect_error', () => {
      appState.socketFailed = true;
      updateBanner();
    });

    socket.on('state:init', (snapshot) => {
      appState.socketFailed = false;
      applySnapshot(snapshot);
    });

    socket.on('mqtt:status', (mqtt) => {
      if (!mqtt || typeof mqtt !== 'object') {
        return;
      }
      appState.mqtt = {
        connected: Boolean(mqtt.connected),
        status: mqtt.status || 'disconnected',
        since: Number(mqtt.since) || appState.mqtt.since,
        broker: mqtt.broker || appState.mqtt.broker,
        tls: Boolean(mqtt.tls),
      };
      renderMqtt();
    });

    socket.on('pot:update', (reading) => {
      if (!reading || !isNumber(Number(reading.value))) {
        return;
      }
      const normalized = {
        value: Number(reading.value),
        percent: Number(reading.percent),
        at: Number(reading.at) || Date.now(),
        stale: Boolean(reading.stale),
        count: Number(reading.count) || appState.pot.count,
      };
      const wasStale = appState.pot.stale;
      appState.pot = normalized;
      appState.history.push({
        value: normalized.value,
        percent: normalized.percent,
        at: normalized.at,
      });
      const maxPoints = Number(appState.config.historySize) || 60;
      if (appState.history.length > maxPoints) {
        appState.history.splice(0, appState.history.length - maxPoints);
      }
      if (chart) {
        chart.addPoint(normalized);
      }
      renderPot();
      renderDetails();
      updateChartStats();
      updateBanner();
      if (wasStale) {
        showToast('Se restablecieron las lecturas del potenciómetro.', 'info');
      }
    });

    socket.on('pot:stale', (payload) => {
      const stale = Boolean(payload && payload.stale);
      const wasStale = appState.pot.stale;
      appState.pot.stale = stale;
      renderPot();
      updateBanner();
      if (stale && !wasStale) {
        showToast('No llegan lecturas del potenciómetro.', 'warn');
      }
    });

    socket.on('led:state', (led) => {
      if (!led || typeof led !== 'object') {
        return;
      }
      appState.led = {
        state: led.state === 'ON' || led.state === 'OFF' ? led.state : 'UNKNOWN',
        confirmed: Boolean(led.confirmed),
        at: Number(led.at) || null,
        source: led.source || null,
      };
      renderLed();
    });

    socket.on('led:ack-timeout', () => {
      showToast(
        'El ESP32 no confirmó el estado del LED. Revisa el tópico de confirmación.',
        'warn'
      );
    });

    socket.on('event:log', (event) => {
      addEvent(event);
    });

    socket.on('server:shutdown', (payload) => {
      showToast(
        (payload && payload.message) || 'El servidor se está deteniendo.',
        'warn'
      );
    });
  }

  // -----------------------------------------------------------------------
  // Control del LED
  // -----------------------------------------------------------------------
  async function sendCommand(command) {
    if (command !== 'ON' && command !== 'OFF') {
      return;
    }
    if (!appState.mqtt.connected) {
      showToast('No hay conexión con el broker MQTT.', 'error');
      return;
    }
    if (appState.pendingCommand) {
      return;
    }

    appState.pendingCommand = true;
    updateLedControls();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch('/api/led', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ command }),
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(
          (payload && payload.error) || `El servidor respondió ${response.status}.`
        );
      }

      showToast(`Orden ${command} enviada al LED.`, 'info');
    } catch (error) {
      if (error && error.name === 'AbortError') {
        showToast('La orden tardó demasiado. Revisa la conexión.', 'error');
      } else {
        showToast(
          (error && error.message) || 'No se pudo enviar la orden al LED.',
          'error'
        );
      }
    } finally {
      window.clearTimeout(timeout);
      appState.pendingCommand = false;
      updateLedControls();
    }
  }

  // -----------------------------------------------------------------------
  // Interfaz
  // -----------------------------------------------------------------------
  function tick() {
    const now = new Date();
    elements.clock.textContent = timeFormatter.format(now);
    elements.clock.dateTime = now.toISOString();
    if (appState.pot.at) {
      elements.metricLastSub.textContent = formatRelative(appState.pot.at);
    }
    updateUptime();
    updateBanner();
  }

  function bindEvents() {
    for (const button of elements.ledOptions) {
      button.addEventListener('click', () => {
        sendCommand(button.dataset.command);
      });
    }

    elements.refreshBtn.addEventListener('click', () => {
      loadState();
    });

    elements.fullscreenBtn.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {
        showToast('El navegador no permitió activar pantalla completa.', 'warn');
      }
    });

    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      elements.fullscreenBtn.title = isFullscreen
        ? 'Salir de pantalla completa'
        : 'Pantalla completa';
      elements.fullscreenBtn.setAttribute(
        'aria-label',
        isFullscreen ? 'Salir de pantalla completa' : 'Alternar pantalla completa'
      );
    });

    elements.alertDismiss.addEventListener('click', () => {
      appState.dismissedBannerKey = appState.currentBannerKey;
      elements.alertBanner.hidden = true;
    });

    elements.clearEvents.addEventListener('click', () => {
      appState.events = [];
      elements.eventList.replaceChildren();
      renderedEventIds.clear();
      elements.eventEmpty.hidden = false;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadState({ silent: true });
      }
    });
  }

  function init() {
    chart = new HistoryChart(elements.chartCanvas, elements.chartEmpty);
    bindEvents();
    tick();
    clockTimer = window.setInterval(tick, 1000);
    loadState({ silent: true }).finally(() => {
      connectSocket();
    });
  }

  init();
})();
