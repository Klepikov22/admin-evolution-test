
'use strict';

const APP_VERSION = '3.0-rebuilt';
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('ru-RU');

const state = {
  manifest: null,
  layers: [],
  filtered: [],
  currentId: null,
  currentMeta: null,
  cache: new Map(),
  map: null,
  waterLayer: null,
  riversLayer: null,
  previousLayer: null,
  currentLayer: null,
  hatchLayer: null,
  selectedFeature: null,
  selectedLayer: null,
  colorMap: new Map(),
  lastNumericValues: []
};

const dom = {
  loading: $('loading'),
  category: $('categoryFilter'),
  mode: $('modeSelect'),
  status: $('statusFilter'),
  hydro: $('toggleHydro'),
  rivers: $('toggleRivers'),
  previous: $('togglePrevious'),
  hatches: $('toggleHatches'),
  labels: $('toggleLabels'),
  autoFit: $('toggleAutoFit'),
  slider: $('timeSlider'),
  radios: $('snapshotRadios'),
  activeTime: $('activeTimeLabel'),
  layerTitle: $('layerTitle'),
  activeTimeBig: $('activeTimeLabelBig'),
  layerInfo: $('layerInfo'),
  featureInfo: $('featureInfo'),
  uncertainty: $('uncertaintyBox'),
  schema: $('schemaBox'),
  table: $('attributeTableBox'),
  search: $('tableSearch'),
  resetView: $('resetView'),
  fitLayer: $('fitLayer'),
  downloadLayer: $('downloadLayer'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn')
};

const palette = ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#a6cee3','#b2df8a','#cab2d6','#ffff99'];
const statusColors = {
  normal: '#9ca3af',
  unstable_control: '#dc2626',
  disputed_affiliation: '#f97316',
  unclear_affiliation: '#a16207',
  unclear_boundary: '#6b7280',
  transitional_zone: '#7c3aed'
};

function showLoading(show) {
  dom.loading.classList.toggle('hidden', !show);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[ch]));
}

function compact(value, limit = 140) {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? fmt.format(Math.round(n)) : '—';
}

function boundsFromArray(b) {
  return L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
}

function viewBounds() {
  return boundsFromArray(state.manifest.viewBounds4326);
}

function layerBounds(meta) {
  return meta?.bbox ? boundsFromArray(meta.bbox) : null;
}

function featureId(feature) {
  return feature?.properties?.feature_id || feature?.id || Math.random().toString(36).slice(2);
}

function labelOf(feature) {
  const p = feature?.properties || {};
  return p.name || p.name_raw || p.admin_parent || p.source_layer || 'объект';
}

function categoryLabel(value) {
  return state.manifest.categories?.[value] || value || '—';
}

function colorFor(value) {
  const key = String(value || '—');
  if (!state.colorMap.has(key)) state.colorMap.set(key, palette[state.colorMap.size % palette.length]);
  return state.colorMap.get(key);
}

function valueColor(value, values) {
  const n = Number(value);
  if (!Number.isFinite(n) || !values.length) return '#cbd5e1';
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return '#7dd3fc';
  const t = (n - min) / (max - min);
  const ramp = ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#3182bd','#08519c'];
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(t * (ramp.length - 1))))];
}

async function loadJson(path) {
  if (state.cache.has(path)) return state.cache.get(path);
  showLoading(true);
  const response = await fetch(`${path}?v=${APP_VERSION}`, {cache: 'no-store'});
  if (!response.ok) throw new Error(`${response.status}: ${path}`);
  const json = await response.json();
  state.cache.set(path, json);
  showLoading(false);
  return json;
}

function initMap() {
  const b = viewBounds();
  const c = b.getCenter();

  state.map = L.map('map', {
    crs: L.CRS.EPSG3857,
    zoomControl: true,
    minZoom: state.manifest.minZoom || 5,
    maxZoom: 9,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    zoomAnimation: false,
    markerZoomAnimation: false,
    fadeAnimation: false,
    inertia: false,
    worldCopyJump: false,
    scrollWheelZoom: 'center',
    doubleClickZoom: 'center',
    touchZoom: 'center',
    wheelDebounceTime: 80,
    wheelPxPerZoomLevel: 220
  });

  state.map.createPane('waterPane'); state.map.getPane('waterPane').style.zIndex = 120;
  state.map.createPane('riverPane'); state.map.getPane('riverPane').style.zIndex = 160;
  state.map.createPane('previousPane'); state.map.getPane('previousPane').style.zIndex = 260;
  state.map.createPane('adminPane'); state.map.getPane('adminPane').style.zIndex = 340;
  state.map.createPane('hatchPane'); state.map.getPane('hatchPane').style.zIndex = 360;

  state.map.setView(c, state.manifest.minZoom || 5, {animate: false});
  L.control.scale({imperial: false}).addTo(state.map);
}

function resetToProjectView() {
  const b = viewBounds();
  state.map.setView(b.getCenter(), state.manifest.minZoom || 5, {animate: false});
}

async function loadHydro() {
  const [water, rivers] = await Promise.all([
    loadJson(state.manifest.hydro.water),
    loadJson(state.manifest.hydro.rivers)
  ]);

  state.waterLayer = L.geoJSON(water, {
    pane: 'waterPane',
    interactive: false,
    style: () => ({
      color: 'transparent',
      weight: 0,
      opacity: 0,
      fillColor: '#a8d5e6',
      fillOpacity: 0.96
    })
  }).addTo(state.map);

  state.riversLayer = L.geoJSON(rivers, {
    pane: 'riverPane',
    interactive: false,
    style: (f) => ({
      color: '#78b7cc',
      weight: riverWeight(f),
      opacity: 0.88,
      lineCap: 'round',
      lineJoin: 'round'
    })
  }).addTo(state.map);

  updateHydroVisibility();
}

function riverWeight(feature) {
  const p = feature.properties || {};
  const raw = Number(p.strokeweig);
  if (Number.isFinite(raw)) return Math.max(0.45, Math.min(1.15, raw * 0.65));
  const rank = Number(p.scale_rank);
  if (Number.isFinite(rank)) return Math.max(0.45, 1.2 - Math.min(rank, 8) * 0.09);
  return 0.65;
}

function updateHydroVisibility() {
  if (!state.map) return;
  const hydroOn = !!dom.hydro.checked;
  const riversOn = hydroOn && !!dom.rivers.checked;
  toggleLayer(state.waterLayer, hydroOn);
  toggleLayer(state.riversLayer, riversOn);
}

function toggleLayer(layer, show) {
  if (!layer) return;
  const has = state.map.hasLayer(layer);
  if (show && !has) layer.addTo(state.map);
  if (!show && has) state.map.removeLayer(layer);
}

function ensureHatchPattern() {
  const svg = document.querySelector('#map .leaflet-overlay-pane svg');
  if (!svg || svg.querySelector('#uncertainHatch')) return;

  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  const pattern = document.createElementNS(ns, 'pattern');
  pattern.setAttribute('id', 'uncertainHatch');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', '8');
  pattern.setAttribute('height', '8');
  pattern.setAttribute('patternTransform', 'rotate(45)');

  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '0');
  line.setAttribute('x2', '0');
  line.setAttribute('y2', '8');
  line.setAttribute('stroke', '#9a3412');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('opacity', '0.78');

  pattern.appendChild(line);
  defs.appendChild(pattern);
  svg.insertBefore(defs, svg.firstChild);
}

function applyLayerFilter() {
  const cat = dom.category.value;
  state.filtered = state.layers.filter(l => cat === 'all' || l.category === cat);
  if (!state.filtered.length) state.filtered = [...state.layers];
  state.filtered.sort((a, b) => (a.sortYear - b.sortYear) || (a.originalOrder - b.originalOrder));

  if (!state.currentId || !state.filtered.some(l => l.id === state.currentId)) {
    const target = state.filtered.find(l => l.id === state.manifest.defaultLayerId);
    const admins = state.filtered.filter(l => l.category === 'admin');
    state.currentId = (target || admins.find(l => l.sortYear === 1798) || admins.at(-1) || state.filtered.at(-1)).id;
  }

  dom.slider.max = Math.max(0, state.filtered.length - 1);
  renderLayerRadios();
  syncSlider();
}

function renderLayerRadios() {
  dom.radios.innerHTML = '';
  state.filtered.forEach((meta) => {
    const label = document.createElement('label');
    label.className = `snapshot-radio${meta.id === state.currentId ? ' active' : ''}`;
    label.innerHTML = `
      <input type="radio" name="snapshot" value="${esc(meta.id)}" ${meta.id === state.currentId ? 'checked' : ''}>
      <span class="time">${esc(meta.timeLabel || meta.sortYear)}</span>
      <span class="name" title="${esc(meta.title)}">${esc(meta.title)}</span>
      <span class="count">${fmt.format(meta.featureCount)}${meta.uncertaintyCount ? `<i title="${meta.uncertaintyCount} спорных/неясных"></i>` : ''}</span>
    `;
    label.querySelector('input').addEventListener('change', () => selectLayer(meta.id));
    dom.radios.appendChild(label);
  });
}

function syncSlider() {
  const idx = Math.max(0, state.filtered.findIndex(l => l.id === state.currentId));
  dom.slider.value = String(idx);
}

function currentIndex() {
  return Math.max(0, state.filtered.findIndex(l => l.id === state.currentId));
}

async function selectLayer(id) {
  state.currentId = id;
  state.currentMeta = state.layers.find(l => l.id === id);
  state.selectedFeature = null;
  state.selectedLayer = null;
  renderLayerRadios();
  syncSlider();
  await drawCurrentLayer();
}

function filteredFeatures(geojson) {
  const status = dom.status.value;
  const features = geojson.features || [];
  if (status === 'uncertain') return features.filter(f => Number(f.properties?.uncertainty_flag) === 1);
  if (status === 'normal') return features.filter(f => Number(f.properties?.uncertainty_flag) !== 1);
  return features;
}

function adminStyle(meta, previous = false) {
  return (feature) => {
    const p = feature.properties || {};
    if (previous) {
      return {
        color: '#475569',
        weight: 1.2,
        opacity: 0.78,
        dashArray: '5 5',
        fillColor: '#94a3b8',
        fillOpacity: 0.02
      };
    }

    if (Number(p.render_hatch) === 1) {
      return {
        color: 'transparent',
        weight: 0,
        opacity: 0,
        fillColor: '#fff7ed',
        fillOpacity: 0.12
      };
    }

    const mode = dom.mode.value;
    let fill = '#bae6fd';
    if (mode === 'parent') fill = colorFor(p.admin_parent || p.admin_parent_raw || '—');
    if (mode === 'unit_type') fill = colorFor(p.unit_type || '—');
    if (mode === 'status') fill = statusColors[p.uncertainty_code || 'normal'] || '#9ca3af';
    if (mode === 'population') fill = valueColor(p.population, state.lastNumericValues);
    if (mode === 'confidence') fill = colorFor(p.confidence || '—');

    return {
      color: '#26394d',
      weight: 1.45,
      opacity: 0.96,
      fillColor: fill,
      fillOpacity: 0.44
    };
  };
}

function pointToLayer(previous = false) {
  return (feature, latlng) => {
    const uncertain = Number(feature.properties?.uncertainty_flag) === 1;
    return L.circleMarker(latlng, {
      radius: previous ? 4 : (uncertain ? 7 : 6),
      color: previous ? '#64748b' : (uncertain ? 'transparent' : '#3a2607'),
      weight: previous ? 1 : (uncertain ? 0 : 1.4),
      fillColor: previous ? '#94a3b8' : (uncertain ? '#f97316' : '#f6c85f'),
      fillOpacity: previous ? 0.35 : 0.88,
      opacity: 0.95
    });
  };
}

function popupHtml(feature) {
  const p = feature.properties || {};
  const priority = [
    'name','time_label','year','start_year','end_year','admin_parent','unit_type','capital',
    'population','confidence','control_status','uncertainty_label','uncertainty_source_text','source_layer'
  ];
  const keys = [...priority, ...Object.keys(p).filter(k => !priority.includes(k)).slice(0, 80)];
  const rows = keys.map(k => `<tr><td>${esc(k)}</td><td>${esc(compact(p[k], 260))}</td></tr>`).join('');
  return `<div class="popup-title">${esc(labelOf(feature))}</div><table class="popup-table">${rows}</table>`;
}

function onEachFeature(meta, previous = false) {
  return (feature, layer) => {
    layer.feature = feature;
    layer.bindPopup(popupHtml(feature), {maxWidth: 460});

    const label = labelOf(feature);
    if (label) {
      layer.bindTooltip(esc(label), {
        sticky: !dom.labels.checked,
        permanent: dom.labels.checked && !previous,
        direction: 'center',
        className: 'feature-label'
      });
    }

    if (!previous) {
      layer.on('click', () => selectFeature(feature, layer));
      if (layer.setStyle) {
        layer.on('mouseover', () => {
          if (Number(feature.properties?.render_hatch) !== 1) layer.setStyle({weight: 2.8, fillOpacity: 0.58});
        });
        layer.on('mouseout', () => layer.setStyle(adminStyle(meta, false)(feature)));
      }
    }
  };
}

function clearDynamicLayers() {
  ['previousLayer', 'currentLayer', 'hatchLayer'].forEach(key => {
    if (state[key]) {
      state.map.removeLayer(state[key]);
      state[key] = null;
    }
  });
}

async function drawPreviousLayer() {
  if (!dom.previous.checked) return;
  const idx = currentIndex();
  if (idx <= 0) return;
  const meta = state.filtered[idx - 1];
  const geojson = await loadJson(meta.file);
  state.previousLayer = L.geoJSON(geojson, {
    pane: 'previousPane',
    style: adminStyle(meta, true),
    pointToLayer: pointToLayer(true),
    onEachFeature: onEachFeature(meta, true)
  }).addTo(state.map);
}

async function drawCurrentLayer() {
  clearDynamicLayers();
  if (!state.currentMeta) return;

  const meta = state.currentMeta;
  const geojson = await loadJson(meta.file);
  const features = filteredFeatures(geojson);
  const display = {type: 'FeatureCollection', features};

  state.lastNumericValues = features.map(f => Number(f.properties?.population)).filter(Number.isFinite);

  await drawPreviousLayer();

  state.currentLayer = L.geoJSON(display, {
    pane: 'adminPane',
    style: adminStyle(meta, false),
    pointToLayer: pointToLayer(false),
    onEachFeature: onEachFeature(meta, false)
  }).addTo(state.map);

  const hatchFeatures = features.filter(f => Number(f.properties?.render_hatch) === 1);
  if (dom.hatches.checked && hatchFeatures.length) {
    state.hatchLayer = L.geoJSON({type: 'FeatureCollection', features: hatchFeatures}, {
      pane: 'hatchPane',
      interactive: false,
      style: () => ({
        color: 'transparent',
        weight: 0,
        opacity: 0,
        fillColor: 'url(#uncertainHatch)',
        fillOpacity: 0.82
      })
    }).addTo(state.map);
    setTimeout(ensureHatchPattern, 0);
  }

  if (dom.autoFit.checked) fitCurrentLayer();
  updatePanels(display);
  dom.activeTime.textContent = meta.timeLabel || String(meta.sortYear);
  dom.layerTitle.textContent = meta.title;
  if (dom.activeTimeBig) dom.activeTimeBig.textContent = meta.timeLabel || String(meta.sortYear);
  renderLayerRadios();
}

function fitCurrentLayer() {
  if (!state.currentLayer) return;
  const b = state.currentLayer.getBounds?.();
  if (b && b.isValid()) {
    state.map.fitBounds(b, {padding: [32, 32], maxZoom: 6.5, animate: false});
    if (state.map.getZoom() < (state.manifest.minZoom || 5)) state.map.setZoom(state.manifest.minZoom || 5, {animate: false});
  }
}

function selectFeature(feature, layer) {
  if (state.selectedLayer && state.selectedLayer.setStyle) {
    state.selectedLayer.setStyle(adminStyle(state.currentMeta, false)(state.selectedLayer.feature));
  }

  state.selectedFeature = feature;
  state.selectedLayer = layer;

  if (layer?.setStyle && Number(feature.properties?.render_hatch) !== 1) {
    layer.setStyle({color: '#a65b00', weight: 3.2, opacity: 1, fillOpacity: 0.62});
  }

  renderFeature(feature);
}

function renderFeature(feature) {
  const p = feature.properties || {};
  const badge = Number(p.uncertainty_flag) === 1
    ? `<span class="badge warn">${esc(p.uncertainty_label)}</span>`
    : `<span class="badge ok">обычный объект</span>`;

  const rows = [
    'name','time_label','year','start_year','end_year','admin_parent','unit_type','capital',
    'population','urban_population','rural_population','confidence','control_status',
    'uncertainty_source_text','source_layer'
  ].map(k => `<div class="info-row"><span>${esc(k)}</span><b>${esc(compact(p[k], 220))}</b></div>`).join('');

  dom.featureInfo.classList.remove('muted');
  dom.featureInfo.innerHTML = `${badge}<div class="info-title">${esc(labelOf(feature))}</div>${rows}`;
}

function renderLayerInfo(geojson) {
  const meta = state.currentMeta;
  const features = geojson.features || [];
  const uncertain = features.filter(f => Number(f.properties?.uncertainty_flag) === 1).length;
  const parents = new Set(features.map(f => f.properties?.admin_parent).filter(Boolean));
  const geomTypes = {};
  features.forEach(f => geomTypes[f.geometry?.type || '—'] = (geomTypes[f.geometry?.type || '—'] || 0) + 1);

  dom.layerInfo.classList.remove('muted');
  dom.layerInfo.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="k">объектов</div><div class="v">${fmt.format(features.length)}</div></div>
      <div class="stat"><div class="k">спорных</div><div class="v">${fmt.format(uncertain)}</div></div>
      <div class="stat"><div class="k">верхний уровень</div><div class="v">${fmt.format(parents.size)}</div></div>
      <div class="stat"><div class="k">типов геометрии</div><div class="v">${fmt.format(Object.keys(geomTypes).length)}</div></div>
    </div>
    <div class="info-row"><span>Категория</span><b>${esc(categoryLabel(meta.category))}</b></div>
    <div class="info-row"><span>Период</span><b>${esc(meta.timeLabel)}</b></div>
    <div class="info-row"><span>Файл</span><b>${esc(meta.file)}</b></div>
    <div class="info-row"><span>Проекция данных</span><b>EPSG:4326 → Leaflet EPSG:3857</b></div>
  `;
}

function schemaStats(features) {
  const stats = new Map();
  features.forEach(f => Object.entries(f.properties || {}).forEach(([k, v]) => {
    if (!stats.has(k)) stats.set(k, {filled: 0, types: new Map(), samples: []});
    const st = stats.get(k);
    if (v !== null && v !== undefined && v !== '') {
      st.filled++;
      const t = Array.isArray(v) ? 'array' : typeof v;
      st.types.set(t, (st.types.get(t) || 0) + 1);
      const sample = compact(v, 70);
      if (st.samples.length < 3 && !st.samples.includes(sample)) st.samples.push(sample);
    }
  }));
  return [...stats.entries()].map(([name, st]) => ({
    name,
    filled: st.filled,
    type: [...st.types.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] || 'null',
    samples: st.samples
  }));
}

function renderSchema(geojson) {
  const features = geojson.features || [];
  const rows = schemaStats(features).map(r => `
    <tr><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${r.filled}/${features.length}</td><td>${esc(r.samples.join(' · ') || '—')}</td></tr>
  `).join('');
  dom.schema.classList.remove('muted');
  dom.schema.innerHTML = `<table class="schema-table"><thead><tr><th>Поле</th><th>Тип</th><th>Заполнено</th><th>Примеры</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderUncertainty(geojson) {
  const list = (geojson.features || [])
    .filter(f => Number(f.properties?.uncertainty_flag) === 1)
    .sort((a,b) => String(a.properties.name).localeCompare(String(b.properties.name), 'ru'));

  if (!list.length) {
    dom.uncertainty.classList.add('muted');
    dom.uncertainty.textContent = 'В текущем срезе спорные / неясные / неустойчивые формулировки не найдены.';
    return;
  }

  dom.uncertainty.classList.remove('muted');
  dom.uncertainty.innerHTML = `<div class="uncertain-list">${list.map(f => {
    const p = f.properties || {};
    return `<button type="button" class="uncertain-item" data-id="${esc(featureId(f))}">
      <b>${esc(p.name)}</b>
      <small>${esc(p.uncertainty_label)} · ${esc(p.uncertainty_source_field || '—')}</small>
      <small>${esc(compact(p.uncertainty_source_text, 170))}</small>
    </button>`;
  }).join('')}</div>`;

  dom.uncertainty.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      state.currentLayer?.eachLayer(layer => {
        if (featureId(layer.feature) === id) {
          selectFeature(layer.feature, layer);
          if (layer.getBounds) state.map.fitBounds(layer.getBounds(), {padding: [80, 80], maxZoom: 7, animate: false});
          if (layer.getLatLng) state.map.setView(layer.getLatLng(), Math.max(state.map.getZoom(), 6), {animate: false});
        }
      });
    });
  });
}

function renderTable(geojson) {
  const features = geojson.features || [];
  const q = (dom.search.value || '').toLowerCase();
  const rows = features
    .filter(f => !q || JSON.stringify(f.properties || {}).toLowerCase().includes(q))
    .map((f, i) => {
      const p = f.properties || {};
      return `<tr data-id="${esc(featureId(f))}">
        <td>${i + 1}</td>
        <td>${esc(compact(p.name, 85))}</td>
        <td>${esc(compact(p.admin_parent, 85))}</td>
        <td>${esc(compact(p.unit_type, 50))}</td>
        <td>${num(p.population)}</td>
        <td>${esc(p.uncertainty_flag ? p.uncertainty_label : '—')}</td>
      </tr>`;
    }).join('');

  dom.table.classList.remove('muted');
  dom.table.innerHTML = `<table class="attr-table"><thead><tr><th>#</th><th>name</th><th>admin_parent</th><th>unit_type</th><th>population</th><th>uncertainty</th></tr></thead><tbody>${rows}</tbody></table>`;

  dom.table.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const id = tr.dataset.id;
      state.currentLayer?.eachLayer(layer => {
        if (featureId(layer.feature) === id) selectFeature(layer.feature, layer);
      });
    });
  });
}

function updatePanels(geojson) {
  renderLayerInfo(geojson);
  renderSchema(geojson);
  renderUncertainty(geojson);
  renderTable(geojson);
  if (!state.selectedFeature) {
    dom.featureInfo.classList.add('muted');
    dom.featureInfo.textContent = 'Кликни по объекту на карте или по строке в таблице.';
  }
}

function downloadCurrent() {
  if (!state.currentMeta) return;
  const a = document.createElement('a');
  a.href = state.currentMeta.file;
  a.download = state.currentMeta.file.split('/').pop();
  a.click();
}

function bindUI() {
  dom.category.addEventListener('change', async () => { applyLayerFilter(); await selectLayer(state.currentId); });
  [dom.mode, dom.status, dom.previous, dom.hatches, dom.labels].forEach(el => el.addEventListener('change', drawCurrentLayer));
  [dom.hydro, dom.rivers].forEach(el => el.addEventListener('change', updateHydroVisibility));

  dom.slider.addEventListener('input', async (e) => {
    const meta = state.filtered[Number(e.target.value)];
    if (meta) await selectLayer(meta.id);
  });

  dom.prevBtn.addEventListener('click', async () => {
    const i = currentIndex();
    if (i > 0) await selectLayer(state.filtered[i - 1].id);
  });

  dom.nextBtn.addEventListener('click', async () => {
    const i = currentIndex();
    if (i < state.filtered.length - 1) await selectLayer(state.filtered[i + 1].id);
  });

  dom.resetView.addEventListener('click', resetToProjectView);
  dom.fitLayer.addEventListener('click', fitCurrentLayer);
  dom.downloadLayer.addEventListener('click', downloadCurrent);

  dom.search.addEventListener('input', async () => {
    if (!state.currentMeta) return;
    const geojson = await loadJson(state.currentMeta.file);
    renderTable({type: 'FeatureCollection', features: filteredFeatures(geojson)});
  });
}

async function init() {
  showLoading(true);
  state.manifest = await loadJson('data/manifest.json');
  state.layers = [...state.manifest.layers].sort((a,b) => (a.sortYear - b.sortYear) || (a.originalOrder - b.originalOrder));
  state.currentId = state.manifest.defaultLayerId || state.layers[0]?.id;

  initMap();
  bindUI();
  await loadHydro();
  applyLayerFilter();
  await selectLayer(state.currentId);
  showLoading(false);
}

init().catch(err => {
  console.error(err);
  showLoading(false);
  alert('Ошибка загрузки проекта: ' + err.message);
});
