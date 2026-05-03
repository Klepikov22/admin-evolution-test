'use strict';

const state = {
  manifest: null,
  timeline: [],
  currentPos: 0,
  currentLayerMeta: null,
  cache: new Map(),
  currentLayer: null,
  previousLayer: null,
  featureIndex: new Map(),
  labelLayer: null,
  playTimer: null,
  lastGeojson: null,
};

const $ = (id) => document.getElementById(id);

const dom = {
  sidebar: document.querySelector('.sidebar'),
  collapseBtn: $('collapseBtn'),
  slider: $('timeSlider'),
  currentYear: $('currentYear'),
  minYear: $('minYear'),
  maxYear: $('maxYear'),
  sliderPosition: $('sliderPosition'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  playBtn: $('playBtn'),
  categoryFilter: $('categoryFilter'),
  showPrevious: $('showPrevious'),
  autoFit: $('autoFit'),
  labelsToggle: $('labelsToggle'),
  layerTitle: $('layerTitle'),
  downloadLayer: $('downloadLayer'),
  featureCount: $('featureCount'),
  geometryTypes: $('geometryTypes'),
  fieldCount: $('fieldCount'),
  categoryName: $('categoryName'),
  sourceName: $('sourceName'),
  schemaBody: document.querySelector('#schemaTable tbody'),
  attrHead: document.querySelector('#attrTable thead'),
  attrBody: document.querySelector('#attrTable tbody'),
  tableSearch: $('tableSearch'),
  rowCounter: $('rowCounter'),
  loading: $('loading'),
  fitAllBtn: $('fitAllBtn'),
  copySchemaBtn: $('copySchemaBtn'),
};

const categoryRu = {
  admin: 'Административные границы',
  stats: 'Статистика / население',
  settlements: 'Остроги / пункты',
  points: 'Точечные слои',
  buffer: 'Буферы',
};

const map = L.map('map', {
  preferCanvas: true,
  zoomControl: true,
  attributionControl: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 12,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

function showLoading(flag) {
  dom.loading.classList.toggle('hidden', !flag);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compactValue(value, limit = 120) {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function bboxToLatLngBounds(bbox) {
  if (!bbox) return null;
  return L.latLngBounds([bbox[1], bbox[0]], [bbox[3], bbox[2]]);
}

function geometryTypesToText(types) {
  return Object.entries(types || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || '—';
}

function labelForFeature(feature, meta) {
  const props = feature.properties || {};
  const candidates = [meta.labelField, 'Rayon', 'ADM2', 'Uezd', 'Name', 'Gov', 'Okrug', 'Oblast', 'Cap'].filter(Boolean);
  for (const key of candidates) {
    if (props[key] !== undefined && props[key] !== null && String(props[key]).trim() !== '') {
      return String(props[key]);
    }
  }
  return meta.title;
}

function layerStyle(meta, isPrevious = false) {
  if (isPrevious) {
    return {
      color: '#64748b',
      weight: 1.5,
      opacity: 0.9,
      fillColor: '#94a3b8',
      fillOpacity: 0.02,
      dashArray: '5 5',
    };
  }
  if (meta.category === 'buffer') {
    return {
      color: '#f59e0b',
      weight: 1.2,
      opacity: 0.9,
      fillColor: '#f59e0b',
      fillOpacity: 0.08,
    };
  }
  if (meta.category === 'stats') {
    return {
      color: '#f59e0b',
      weight: 1,
      opacity: 0.9,
      fillColor: '#f59e0b',
      fillOpacity: 0.2,
    };
  }
  return {
    color: '#0369a1',
    weight: 1.8,
    opacity: 0.95,
    fillColor: '#38bdf8',
    fillOpacity: 0.12,
  };
}

function makePointLayer(feature, latlng, meta, isPrevious) {
  return L.circleMarker(latlng, {
    radius: isPrevious ? 4 : 6,
    color: isPrevious ? '#64748b' : '#92400e',
    weight: isPrevious ? 1 : 1.4,
    opacity: 0.95,
    fillColor: isPrevious ? '#94a3b8' : '#f59e0b',
    fillOpacity: isPrevious ? 0.35 : 0.85,
  });
}

function popupHtml(feature, meta) {
  const props = feature.properties || {};
  const title = escapeHtml(labelForFeature(feature, meta));
  const rows = Object.entries(props)
    .filter(([key]) => key !== '__rowIndex')
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(compactValue(value, 260))}</td></tr>`)
    .join('');
  return `<div class="popup-title">${title}</div><table class="popup-table">${rows}</table>`;
}

function onEachFeatureFactory(meta, isPrevious = false) {
  return function onEachFeature(feature, leafletLayer) {
    if (!isPrevious) {
      const rowIndex = feature.properties?.__rowIndex;
      if (rowIndex !== undefined) state.featureIndex.set(rowIndex, leafletLayer);
    }
    leafletLayer.bindPopup(popupHtml(feature, meta), { maxWidth: 420 });
    const label = labelForFeature(feature, meta);
    if (label) {
      leafletLayer.bindTooltip(escapeHtml(label), {
        sticky: !dom.labelsToggle.checked,
        permanent: dom.labelsToggle.checked && !isPrevious,
        direction: 'center',
        className: 'feature-label',
      });
    }
    if (!isPrevious && leafletLayer.setStyle) {
      leafletLayer.on('mouseover', () => leafletLayer.setStyle({ weight: 3, fillOpacity: 0.22 }));
      leafletLayer.on('mouseout', () => leafletLayer.setStyle(layerStyle(meta, false)));
    }
  };
}

async function fetchGeojson(meta) {
  if (state.cache.has(meta.id)) return state.cache.get(meta.id);
  showLoading(true);
  const response = await fetch(meta.file);
  if (!response.ok) throw new Error(`Не удалось загрузить ${meta.file}: ${response.status}`);
  const data = await response.json();
  (data.features || []).forEach((feature, idx) => {
    feature.properties = feature.properties || {};
    feature.properties.__rowIndex = idx;
  });
  state.cache.set(meta.id, data);
  showLoading(false);
  return data;
}

function clearMapLayers() {
  if (state.currentLayer) map.removeLayer(state.currentLayer);
  if (state.previousLayer) map.removeLayer(state.previousLayer);
  state.currentLayer = null;
  state.previousLayer = null;
  state.featureIndex.clear();
}

async function drawLayer(meta, isPrevious = false) {
  const geojson = await fetchGeojson(meta);
  const layer = L.geoJSON(geojson, {
    style: () => layerStyle(meta, isPrevious),
    pointToLayer: (feature, latlng) => makePointLayer(feature, latlng, meta, isPrevious),
    onEachFeature: onEachFeatureFactory(meta, isPrevious),
  });
  layer.addTo(map);
  if (!isPrevious) state.lastGeojson = geojson;
  return { layer, geojson };
}

async function setCurrentPosition(pos) {
  if (!state.timeline.length) return;
  const safePos = Math.max(0, Math.min(pos, state.timeline.length - 1));
  state.currentPos = safePos;
  const meta = state.timeline[safePos];
  state.currentLayerMeta = meta;

  clearMapLayers();
  updateLayerInfo(meta);
  renderSchema(meta);
  renderAttributes([], meta);
  showLoading(true);

  try {
    if (dom.showPrevious.checked && safePos > 0) {
      const prevMeta = state.timeline[safePos - 1];
      const previous = await drawLayer(prevMeta, true);
      state.previousLayer = previous.layer;
      state.previousLayer.bringToBack();
    }

    const current = await drawLayer(meta, false);
    state.currentLayer = current.layer;
    state.currentLayer.bringToFront();
    renderAttributes(current.geojson.features || [], meta);

    if (dom.autoFit.checked) {
      const bounds = current.layer.getBounds && current.layer.getBounds();
      if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.08), { animate: true, maxZoom: 8 });
    }
  } catch (error) {
    console.error(error);
    dom.layerTitle.textContent = `Ошибка загрузки: ${meta.title}`;
    alert(error.message);
  } finally {
    showLoading(false);
    updateTimelineUi();
  }
}

function updateLayerInfo(meta) {
  dom.currentYear.textContent = meta.yearLabel;
  dom.layerTitle.textContent = meta.title;
  dom.downloadLayer.href = meta.file;
  dom.downloadLayer.setAttribute('download', meta.file.split('/').pop());
  dom.featureCount.textContent = meta.featureCount.toLocaleString('ru-RU');
  dom.geometryTypes.textContent = geometryTypesToText(meta.geometryTypes);
  dom.fieldCount.textContent = String(meta.fields.length);
  dom.categoryName.textContent = categoryRu[meta.category] || meta.category;
  dom.sourceName.textContent = `Исходное имя: ${meta.originalFile}`;
}

function renderSchema(meta) {
  dom.schemaBody.innerHTML = meta.fields.map((field) => {
    const fillRate = Math.round((field.fillRate || 0) * 100);
    const samples = (field.samples || []).map(escapeHtml).join(' · ');
    return `<tr><td><strong>${escapeHtml(field.name)}</strong></td><td>${escapeHtml(field.type)}</td><td>${fillRate}%</td><td class="samples">${samples || '—'}</td></tr>`;
  }).join('');
}

function fieldsForTable(meta) {
  const names = meta.fields.map((f) => f.name).filter((name) => name !== '__rowIndex');
  const preferred = [meta.labelField, 'Rayon', 'ADM2', 'Uezd', 'Name', 'Gov', 'Okrug', 'Oblast', 'Cap', 'Pop', 'Year', 'Year_Start', 'Year_end']
    .filter(Boolean);
  const ordered = [];
  for (const name of preferred.concat(names)) {
    if (name && names.includes(name) && !ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

function renderAttributes(features, meta) {
  const query = dom.tableSearch.value.trim().toLowerCase();
  const fields = fieldsForTable(meta);
  const filtered = query
    ? features.filter((feature) => JSON.stringify(feature.properties || {}).toLowerCase().includes(query))
    : features;

  dom.attrHead.innerHTML = `<tr>${fields.map((name) => `<th>${escapeHtml(name)}</th>`).join('')}</tr>`;
  dom.attrBody.innerHTML = filtered.map((feature) => {
    const props = feature.properties || {};
    const rowIndex = props.__rowIndex;
    const cells = fields.map((name) => `<td>${escapeHtml(compactValue(props[name], 90))}</td>`).join('');
    return `<tr class="clickable" data-row-index="${rowIndex}">${cells}</tr>`;
  }).join('');

  dom.rowCounter.textContent = `${filtered.length.toLocaleString('ru-RU')} из ${features.length.toLocaleString('ru-RU')}`;

  dom.attrBody.querySelectorAll('tr[data-row-index]').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = Number(row.dataset.rowIndex);
      const layer = state.featureIndex.get(idx);
      if (!layer) return;
      if (layer.getBounds) {
        const bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.25), { maxZoom: 8 });
      } else if (layer.getLatLng) {
        map.setView(layer.getLatLng(), Math.max(map.getZoom(), 7));
      }
      layer.openPopup();
    });
  });
}

function applyCategoryFilter(resetPos = true) {
  const value = dom.categoryFilter.value;
  state.timeline = state.manifest.layers.filter((layer) => value === 'all' || layer.category === value);
  if (!state.timeline.length) {
    state.timeline = state.manifest.layers.slice();
  }

  dom.slider.min = 0;
  dom.slider.max = Math.max(0, state.timeline.length - 1);
  if (resetPos) state.currentPos = 0;
  dom.slider.value = state.currentPos;
  dom.minYear.textContent = state.timeline[0]?.yearLabel || '—';
  dom.maxYear.textContent = state.timeline.at(-1)?.yearLabel || '—';
  setCurrentPosition(state.currentPos);
}

function updateTimelineUi() {
  dom.slider.max = Math.max(0, state.timeline.length - 1);
  dom.slider.value = state.currentPos;
  dom.sliderPosition.textContent = `${state.currentPos + 1} / ${state.timeline.length}`;
  dom.prevBtn.disabled = state.currentPos <= 0;
  dom.nextBtn.disabled = state.currentPos >= state.timeline.length - 1;
}

function fitOverall() {
  const bounds = bboxToLatLngBounds(state.manifest?.bbox);
  if (bounds) map.fitBounds(bounds.pad(0.05));
}

function stopPlayback() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
    dom.playBtn.textContent = '▶';
  }
}

function togglePlayback() {
  if (state.playTimer) {
    stopPlayback();
    return;
  }
  dom.playBtn.textContent = 'Ⅱ';
  state.playTimer = setInterval(() => {
    if (state.currentPos >= state.timeline.length - 1) {
      stopPlayback();
      return;
    }
    setCurrentPosition(state.currentPos + 1);
  }, 1300);
}

function schemaToCsv(meta) {
  const lines = [['field', 'type', 'filled', 'fillRate', 'samples']];
  for (const f of meta.fields) {
    lines.push([f.name, f.type, f.filled, f.fillRate, (f.samples || []).join(' | ')]);
  }
  return lines.map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
}

async function copySchema() {
  if (!state.currentLayerMeta) return;
  const csv = schemaToCsv(state.currentLayerMeta);
  try {
    await navigator.clipboard.writeText(csv);
    dom.copySchemaBtn.textContent = 'Скопировано';
    setTimeout(() => { dom.copySchemaBtn.textContent = 'Скопировать CSV'; }, 1200);
  } catch {
    console.log(csv);
    alert('CSV выведен в console.log — браузер не дал доступ к буферу обмена.');
  }
}

function bindEvents() {
  dom.slider.addEventListener('input', () => {
    stopPlayback();
    setCurrentPosition(Number(dom.slider.value));
  });
  dom.prevBtn.addEventListener('click', () => {
    stopPlayback();
    setCurrentPosition(state.currentPos - 1);
  });
  dom.nextBtn.addEventListener('click', () => {
    stopPlayback();
    setCurrentPosition(state.currentPos + 1);
  });
  dom.playBtn.addEventListener('click', togglePlayback);
  dom.categoryFilter.addEventListener('change', () => {
    stopPlayback();
    applyCategoryFilter(true);
  });
  dom.showPrevious.addEventListener('change', () => setCurrentPosition(state.currentPos));
  dom.labelsToggle.addEventListener('change', () => setCurrentPosition(state.currentPos));
  dom.fitAllBtn.addEventListener('click', fitOverall);
  dom.copySchemaBtn.addEventListener('click', copySchema);
  dom.tableSearch.addEventListener('input', () => {
    if (state.lastGeojson && state.currentLayerMeta) {
      renderAttributes(state.lastGeojson.features || [], state.currentLayerMeta);
    }
  });
  dom.collapseBtn.addEventListener('click', () => {
    dom.sidebar.classList.toggle('collapsed');
    setTimeout(() => map.invalidateSize(), 220);
  });
  window.addEventListener('keydown', (event) => {
    if (event.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') setCurrentPosition(state.currentPos - 1);
    if (event.key === 'ArrowRight') setCurrentPosition(state.currentPos + 1);
    if (event.key === ' ') {
      event.preventDefault();
      togglePlayback();
    }
  });
}

async function init() {
  bindEvents();
  showLoading(true);
  const response = await fetch('data/manifest.json');
  if (!response.ok) throw new Error('Не удалось загрузить data/manifest.json');
  state.manifest = await response.json();
  applyCategoryFilter(true);
  fitOverall();
  showLoading(false);
}

init().catch((error) => {
  console.error(error);
  showLoading(false);
  dom.layerTitle.textContent = 'Ошибка инициализации';
  alert(error.message);
});
