'use strict';

const VERSION = '6.0-province-hatch-fix';
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('ru-RU');

const state = {
  manifest: null,
  map: null,
  layers: [],
  filtered: [],
  currentId: null,
  currentMeta: null,
  currentJson: null,
  currentLayer: null,
  previousLayer: null,
  hatchLayer: null,
  waterLayer: null,
  riverLayer: null,
  cache: new Map(),
  colors: new Map(),
  selectedLayer: null,
  selectedFeature: null,
};

const dom = {
  status: $('status'),
  category: $('categorySelect'),
  layerSelect: $('layerSelect'),
  mode: $('modeSelect'),
  showWater: $('showWater'),
  showRivers: $('showRivers'),
  showPrevious: $('showPrevious'),
  showHatch: $('showHatch'),
  showLabels: $('showLabels'),
  slider: $('timeSlider'),
  ticks: $('timelineTicks'),
  activeLayerCard: $('activeLayerCard'),
  radios: $('radioList'),
  prev: $('prevBtn'),
  next: $('nextBtn'),
  fitLayer: $('fitLayerBtn'),
  fitProject: $('fitProjectBtn'),
  download: $('downloadBtn'),
  layerInfo: $('layerInfo'),
  featureInfo: $('featureInfo'),
  schema: $('schemaInfo'),
  table: $('tableBox'),
  search: $('tableSearch'),
  legend: $('legendBox'),
};

const palette = [
  '#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5',
  '#bc80bd','#ccebc5','#ffed6f','#d9d9d9','#a6cee3','#b2df8a','#fdbf6f','#cab2d6',
  '#b15928','#1f78b4','#33a02c','#e31a1c','#6a3d9a','#ff7f00'
];

const statusColors = {
  normal: '#cbd5e1',
  uncertain: '#f97316',
  disputed: '#dc2626',
};

const fieldLabels = {
  _display_name: 'Объект',
  _display_map_atd: 'Отображаемый уровень АТД',
  _display_top_atd: 'Высший уровень АТД',
  _display_mid_atd: 'Средний уровень АТД / провинция',
  _display_low_atd: 'Низовой уровень / объект',
  _display_unit_type: 'Тип единицы',
  _display_capital: 'Центр',
  _display_population: 'Население',
  _display_hierarchy: 'Иерархия',
  _display_status: 'Статус реконструкции',
  _province_affiliation: 'Провинциальная принадлежность',
  _province_note: 'Примечание к провинциальной принадлежности',
  _name_note: 'Примечание к названию',
  _time_label: 'Период',
  _start_year: 'Начало',
  _end_year: 'Окончание',
  _source_file: 'Исходный слой',
  _uncertain_label: 'Неопределённость',
  Confidence: 'Уверенность',
  Source: 'Источник',
  Shape_Area: 'Площадь геометрии',
  Shape_Length: 'Длина геометрии',
};

function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function compact(v,n=160){
  if(v === null || v === undefined || v === '') return '—';
  const s = String(v);
  return s.length > n ? s.slice(0,n) + '…' : s;
}
function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? fmt.format(Math.round(n)) : '—';
}
function setStatus(txt){ dom.status.innerHTML = txt; }
function labelForField(k){ return fieldLabels[k] || state.manifest?.fieldLabels?.[k] || k; }
function displayTitle(m){ return m?.displayTitle || m?.title || 'Слой'; }
function boundsFromBbox(b){ return L.latLngBounds([b[1],b[0]],[b[3],b[2]]); }
function currentIndex(){ return Math.max(0, state.filtered.findIndex(l => l.id === state.currentId)); }
function geometryType(f){ return f?.geometry?.type || ''; }
function isPointFeature(f){ return /Point/.test(geometryType(f)); }
function cleanText(v){ return String(v ?? '').trim(); }

function colorFor(v){
  const k = cleanText(v) || 'Не указано';
  if(!state.colors.has(k)) state.colors.set(k, palette[state.colors.size % palette.length]);
  return state.colors.get(k);
}

async function loadJson(path){
  if(state.cache.has(path)) return state.cache.get(path);
  const r = await fetch(`${path}?v=${VERSION}`, {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${path}`);
  const j = await r.json();
  state.cache.set(path,j);
  return j;
}

function initMap(){
  const b = boundsFromBbox(state.manifest.projectBounds);
  state.map = L.map('map', {
    minZoom: state.manifest.minZoom || 5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 220,
    scrollWheelZoom: 'center',
    doubleClickZoom: 'center',
    touchZoom: 'center',
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    preferCanvas: false,
  });
  state.map.createPane('waterPane'); state.map.getPane('waterPane').style.zIndex = 150;
  state.map.createPane('riverPane'); state.map.getPane('riverPane').style.zIndex = 170;
  state.map.createPane('previousPane'); state.map.getPane('previousPane').style.zIndex = 360;
  state.map.createPane('adminPane'); state.map.getPane('adminPane').style.zIndex = 420;
  state.map.createPane('hatchPane'); state.map.getPane('hatchPane').style.zIndex = 430;
  state.map.setView(b.getCenter(), state.manifest.minZoom || 5, {animate:false});
  L.control.scale({imperial:false}).addTo(state.map);
}

function projectFit(){
  const b = boundsFromBbox(state.manifest.projectBounds);
  state.map.setView(b.getCenter(), state.manifest.minZoom || 5, {animate:false});
}

function getName(f){
  const p = f.properties || {};
  return p._display_name || p._name || p.name || p.Name || p.NAME || p.name_ru || p.name_rus || 'объект';
}
function getTopAtd(f){ return (f.properties || {})._display_top_atd || 'Не указано'; }
function getMidAtd(f){ return (f.properties || {})._display_mid_atd || ''; }
function getMapAtd(f){ return (f.properties || {})._display_map_atd || getMidAtd(f) || getTopAtd(f) || 'Не указано'; }
function getType(f){ return (f.properties || {})._display_unit_type || (f.properties || {})._unit_type || (f.properties || {}).featurecla || 'Не указано'; }
function isUncertain(f){ return Number((f.properties || {})._uncertain) === 1 || Number((f.properties || {})._hatch) === 1; }

function styleValue(f){
  const mode = dom.mode.value;
  if(mode === 'top') return getMapAtd(f);
  if(mode === 'mid') return getMidAtd(f) || getTopAtd(f);
  if(mode === 'type') return getType(f);
  if(mode === 'uncertain') return isUncertain(f) ? ((f.properties || {})._uncertain_label || 'Спорная / неясная зона') : 'Обычная принадлежность';
  return 'Единый цвет';
}

function featureStyle(f, previous=false){
  if(previous){
    return {color:'#64748b', weight:1.25, opacity:.78, dashArray:'5 5', fillColor:'#64748b', fillOpacity:.025};
  }
  let fill = '#e4b36c';
  if(dom.mode.value === 'uncertain') fill = isUncertain(f) ? statusColors.uncertain : statusColors.normal;
  else if(dom.mode.value !== 'single') fill = colorFor(styleValue(f));
  const uncertain = isUncertain(f);
  // Спорные / двоеданческие / неясные полигоны не получают собственного внешнего контура.
  // Их читаем через штриховку, а базовая заливка оставлена очень лёгкой.
  if(uncertain && !isPointFeature(f)){
    return {color:'transparent', weight:0, opacity:0, fillColor:fill, fillOpacity:.12};
  }
  return {
    color:'#263746',
    weight:1.35,
    opacity:.98,
    fillColor:fill,
    fillOpacity:.46,
  };
}

function selectedOutlineStyle(){
  return {color:'#a65b00', weight:3.4, opacity:1, fillOpacity:0};
}

function pointStyle(f, previous=false){
  const uncertain = isUncertain(f);
  return {
    radius: previous ? 4 : (uncertain ? 7 : 5.5),
    color: previous ? '#64748b' : (uncertain ? '#7c2d12' : '#3a2607'),
    weight: previous ? 1 : 1.4,
    fillColor: previous ? '#94a3b8' : (uncertain ? '#f97316' : '#f6c85f'),
    fillOpacity: previous ? .35 : .9,
    opacity: .98,
  };
}

function popup(f){
  const p = f.properties || {};
  const keys = [
    '_display_name','_display_hierarchy','_display_top_atd','_display_mid_atd','_display_unit_type',
    '_display_capital','_display_population','_display_status','_time_label','_source_file','Confidence','Source'
  ];
  const rest = Object.keys(p).filter(k => !k.startsWith('_display') && !keys.includes(k) && !k.startsWith('_')).slice(0,50);
  const rows = keys.concat(rest).map(k => `<tr><td>${esc(labelForField(k))}</td><td>${esc(compact(p[k],240))}</td></tr>`).join('');
  return `<b>${esc(getName(f))}</b><table class="popupTable">${rows}</table>`;
}

function onEach(previous=false){
  return (f,l) => {
    l.bindPopup(popup(f), {maxWidth: 460});
    const name = getName(f);
    if(name){
      l.bindTooltip(esc(name), {sticky:!dom.showLabels.checked, permanent:dom.showLabels.checked && !previous, direction:'center', className:'featureLabel'});
    }
    if(!previous){
      l.on('click', () => selectFeature(f,l));
      if(l.setStyle){
        l.on('mouseover', () => { if(state.selectedLayer !== l) l.setStyle(isUncertain(f) && !isPointFeature(f) ? {color:'transparent', weight:0, opacity:0, fillOpacity:.20} : {weight:2.7, fillOpacity:.56}); });
        l.on('mouseout', () => { if(state.selectedLayer !== l) l.setStyle(featureStyle(f,false)); });
      }
    }
  };
}

function clearCurrent(){
  ['currentLayer','previousLayer','hatchLayer'].forEach(k => {
    if(state[k]){ state.map.removeLayer(state[k]); state[k] = null; }
  });
  state.selectedLayer = null;
  state.selectedFeature = null;
}

async function drawPrevious(){
  if(!dom.showPrevious.checked) return;
  const i = currentIndex();
  if(i <= 0) return;
  const meta = state.filtered[i-1];
  const gj = await loadJson(meta.file);
  state.previousLayer = L.geoJSON(gj, {
    pane:'previousPane',
    style:f => featureStyle(f,true),
    pointToLayer:(f,ll) => L.circleMarker(ll, pointStyle(f,true)),
    onEachFeature:onEach(true)
  }).addTo(state.map);
}

function hatchColor(f){
  // Штриховку привязываем к ближайшему содержательному административному признаку: отображаемый уровень, затем верхний АТД.
  // Это стабильнее, чем геометрический nearest-neighbour в браузере, и совпадает с цветом выверенной соседней группы.
  return colorFor(getMapAtd(f) || getTopAtd(f) || 'Спорная зона');
}

function hatchId(color){
  return 'hatch_' + String(color || '#999').replace(/[^a-zA-Z0-9]/g,'');
}

function ensureHatchPatterns(features){
  const svgs = document.querySelectorAll('#map .leaflet-overlay-pane svg');
  if(!svgs.length) return;
  const colors = [...new Set((features || []).map(hatchColor))];
  const ns = 'http://www.w3.org/2000/svg';
  svgs.forEach(svg => {
    let defs = svg.querySelector('defs');
    if(!defs){
      defs = document.createElementNS(ns,'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    colors.forEach(color => {
      const id = hatchId(color);
      if(defs.querySelector('#' + id)) return;
      const pat = document.createElementNS(ns,'pattern');
      pat.setAttribute('id', id);
      pat.setAttribute('patternUnits','userSpaceOnUse');
      pat.setAttribute('width','9');
      pat.setAttribute('height','9');
      pat.setAttribute('patternTransform','rotate(45)');
      const bg = document.createElementNS(ns,'rect');
      bg.setAttribute('x','0'); bg.setAttribute('y','0'); bg.setAttribute('width','9'); bg.setAttribute('height','9');
      bg.setAttribute('fill','#ffffff'); bg.setAttribute('opacity','.05');
      const line = document.createElementNS(ns,'line');
      line.setAttribute('x1','0'); line.setAttribute('y1','0'); line.setAttribute('x2','0'); line.setAttribute('y2','9');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width','1.6');
      line.setAttribute('opacity','.62');
      pat.appendChild(bg);
      pat.appendChild(line);
      defs.appendChild(pat);
    });
  });
}



async function selectLayer(id){
  state.currentId = id;
  state.currentMeta = state.layers.find(l => l.id === id);
  if(!state.currentMeta) return;
  clearCurrent();
  setStatus(`Загрузка: <b>${esc(displayTitle(state.currentMeta))}</b>…`);
  dom.layerSelect.value = id;
  renderTimeline();
  await drawPrevious();
  const gj = await loadJson(state.currentMeta.file);
  state.currentJson = gj;
  state.currentLayer = L.geoJSON(gj, {
    pane:'adminPane',
    style:f => featureStyle(f,false),
    pointToLayer:(f,ll) => L.circleMarker(ll, pointStyle(f,false)),
    onEachFeature:onEach(false)
  }).addTo(state.map);
  if(dom.showHatch.checked){
    const hatch = {type:'FeatureCollection', features:(gj.features || []).filter(f => Number(f.properties?._hatch) === 1 && !isPointFeature(f))};
    if(hatch.features.length){
      state.hatchLayer = L.geoJSON(hatch, {
        pane:'hatchPane',
        interactive:false,
        style:f => ({color:'transparent', weight:0, opacity:0, fillColor:`url(#${hatchId(hatchColor(f))})`, fillOpacity:.72})
      }).addTo(state.map);
      setTimeout(() => ensureHatchPatterns(hatch.features), 0);
    }
  }
  renderPanels(gj);
  fitCurrentLayer(false);
  setStatus(`Активно: <b>${esc(state.currentMeta.timeLabel)}</b> · ${esc(displayTitle(state.currentMeta))} · объектов: ${fmt.format(state.currentMeta.featureCount)}`);
}

function fitCurrentLayer(animated=true){
  const l = state.currentLayer;
  if(!l) return;
  const b = l.getBounds?.();
  if(b && b.isValid()) state.map.fitBounds(b, {padding:[28,28], maxZoom:7, animate:animated});
}

async function drawHydro(){
  setStatus('Загрузка гидрографии…');
  const h = state.manifest.hydro;
  const [water,rivers] = await Promise.all([loadJson(h.water), loadJson(h.rivers)]);
  state.waterLayer = L.geoJSON(water, {pane:'waterPane', interactive:false, style:{color:'transparent', weight:0, fillColor:'#a9d4e5', fillOpacity:1}});
  state.riverLayer = L.geoJSON(rivers, {pane:'riverPane', interactive:false, style:f => {
    const sw = Number(f.properties?.strokeweig);
    return {color:'#6aaec7', weight:Number.isFinite(sw) ? Math.max(.45, Math.min(1.25, sw*.7)) : .65, opacity:.9, lineCap:'round', lineJoin:'round'};
  }});
  updateHydro();
}

function updateHydro(){
  if(state.waterLayer){
    const has = state.map.hasLayer(state.waterLayer);
    if(dom.showWater.checked && !has) state.waterLayer.addTo(state.map);
    if(!dom.showWater.checked && has) state.map.removeLayer(state.waterLayer);
  }
  if(state.riverLayer){
    const has = state.map.hasLayer(state.riverLayer);
    if(dom.showRivers.checked && !has) state.riverLayer.addTo(state.map);
    if(!dom.showRivers.checked && has) state.map.removeLayer(state.riverLayer);
  }
}

function selectFeature(f,l){
  if(state.selectedLayer && state.selectedLayer.setStyle) state.selectedLayer.setStyle(featureStyle(state.selectedFeature,false));
  state.selectedLayer = l;
  state.selectedFeature = f;
  if(l.setStyle) l.setStyle(selectedOutlineStyle());
  renderFeature(f);
}

function renderFeature(f){
  const p = f.properties || {};
  const rows = ['_display_hierarchy','_display_map_atd','_display_top_atd','_display_mid_atd','_province_note','_display_unit_type','_display_capital','_display_population','_display_status','_source_file']
    .map(k => `<div class="row"><span>${esc(labelForField(k))}</span><b>${esc(compact(p[k],220))}</b></div>`).join('');
  const badge = isUncertain(f) ? `<span class="badge warn">спорная / неясная зона</span>` : `<span class="badge">обычный объект</span>`;
  dom.featureInfo.innerHTML = `${badge}<div class="infoTitle">${esc(getName(f))}</div>${rows}`;
}

function renderPanels(gj){
  const feats = gj.features || [];
  const uncertain = feats.filter(isUncertain).length;
  const topVals = [...new Set(feats.map(getTopAtd).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
  dom.layerInfo.innerHTML = `<div class="infoTitle">${esc(displayTitle(state.currentMeta))}</div>
    <div class="row"><span>Период</span><b>${esc(state.currentMeta.timeLabel)}</b></div>
    <div class="row"><span>Категория</span><b>${esc(state.currentMeta.categoryLabel || state.currentMeta.category)}</b></div>
    <div class="row"><span>Объектов</span><b>${fmt.format(feats.length)}</b></div>
    <div class="row"><span>Верхних АТЕ</span><b>${fmt.format(topVals.length)}</b></div>
    <div class="row"><span>Спорных / неясных</span><b>${fmt.format(uncertain)}</b></div>
    <div class="row"><span>Координаты</span><b>${esc(state.currentMeta.projectionMode || '4326')}</b></div>`;
  renderLegend(feats);
  renderSchema(feats);
  renderTable(feats);
  dom.featureInfo.innerHTML = 'Кликни по полигону / объекту.';
}

function renderLegend(feats){
  if(!dom.legend) return;
  const groups = new Map();
  feats.forEach(f => {
    const key = styleValue(f);
    groups.set(key, (groups.get(key) || 0) + 1);
  });
  const rows = [...groups.entries()]
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],'ru'))
    .slice(0,24)
    .map(([name,count]) => `<div class="legendRow"><span class="legendSwatch" style="background:${esc(dom.mode.value==='uncertain' ? (name.includes('Обычная') ? statusColors.normal : statusColors.uncertain) : colorFor(name))}"></span><span title="${esc(name)}">${esc(compact(name,80))}</span><b>${fmt.format(count)}</b></div>`)
    .join('');
  dom.legend.innerHTML = rows || '<div class="muted">Нет данных для легенды.</div>';
}

function schemaStats(feats){
  const stats = new Map();
  feats.forEach(f => Object.entries(f.properties || {}).forEach(([k,v]) => {
    if(!stats.has(k)) stats.set(k, {n:0, t:new Set(), s:[]});
    const st = stats.get(k);
    if(v !== null && v !== undefined && v !== ''){
      st.n++;
      st.t.add(Array.isArray(v) ? 'array' : typeof v);
      const sv = String(v);
      if(st.s.length < 2 && !st.s.includes(sv)) st.s.push(compact(sv,60));
    }
  }));
  return [...stats.entries()].sort((a,b) => {
    const aa = a[0].startsWith('_display') ? '0'+a[0] : '1'+a[0];
    const bb = b[0].startsWith('_display') ? '0'+b[0] : '1'+b[0];
    return aa.localeCompare(bb,'ru');
  });
}

function renderSchema(feats){
  const rows = schemaStats(feats).map(([k,st]) => `<tr><td>${esc(labelForField(k))}<small>${esc(k)}</small></td><td>${esc([...st.t].join(', ') || '—')}</td><td>${st.n}/${feats.length}</td><td>${esc(st.s.join(' · ') || '—')}</td></tr>`).join('');
  dom.schema.innerHTML = `<table class="schemaTable"><thead><tr><th>Поле</th><th>Тип</th><th>Заполнено</th><th>Примеры</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTable(feats){
  const q = (dom.search.value || '').toLowerCase();
  const shown = feats.filter(f => !q || JSON.stringify(f.properties || {}).toLowerCase().includes(q)).slice(0,250);
  const rows = shown.map((f,i) => {
    return `<tr data-i="${i}"><td>${i+1}</td><td>${esc(compact(getName(f),70))}</td><td>${esc(compact(getMapAtd(f),70))}</td><td>${esc(compact(getMidAtd(f),60))}</td><td>${esc(compact(getType(f),45))}</td><td>${esc(isUncertain(f) ? ((f.properties||{})._uncertain_label || 'да') : '—')}</td></tr>`;
  }).join('');
  dom.table.innerHTML = `<table class="attrTable"><thead><tr><th>#</th><th>Объект</th><th>На карте</th><th>Средний уровень</th><th>Тип</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table><div class="muted tableHint">Показано ${shown.length} из ${feats.length}. Для выделения на карте кликни по объекту.</div>`;
  dom.table.querySelectorAll('tr[data-i]').forEach(tr => tr.addEventListener('click', () => renderFeature(shown[Number(tr.dataset.i)])));
}

function applyCategory(){
  const cat = dom.category.value;
  state.filtered = state.layers.filter(l => cat === 'all' || l.category === cat);
  if(!state.filtered.length) state.filtered = [...state.layers];
  state.filtered.sort((a,b) => (a.year-b.year) || (a.startYear-b.startYear) || displayTitle(a).localeCompare(displayTitle(b),'ru'));
  if(!state.currentId || !state.filtered.some(l => l.id === state.currentId)){
    state.currentId = (state.filtered.find(l => l.id === state.manifest.defaultLayerId) || state.filtered[state.filtered.length-1])?.id;
  }
  renderLayerSelect();
  renderTimeline();
}

function renderLayerSelect(){
  dom.layerSelect.innerHTML = '';
  state.filtered.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = `${m.timeLabel} — ${displayTitle(m)}`;
    if(m.id === state.currentId) o.selected = true;
    dom.layerSelect.appendChild(o);
  });
}

function renderTimeline(){
  const i = currentIndex();
  dom.slider.max = Math.max(0, state.filtered.length - 1);
  dom.slider.value = String(i);
  const meta = state.filtered[i] || state.currentMeta;
  if(dom.activeLayerCard && meta){
    dom.activeLayerCard.innerHTML = `<div><span>Активный срез</span><b>${esc(meta.timeLabel)}</b></div><p>${esc(displayTitle(meta))}</p>`;
  }
  renderTicks(i);
  renderRadios();
}

function renderTicks(activeIndex){
  if(!dom.ticks) return;
  dom.ticks.innerHTML = '';
  const n = state.filtered.length;
  if(!n) return;
  state.filtered.forEach((m,i) => {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'timelineTick' + (i === activeIndex ? ' active' : '');
    tick.title = `${m.timeLabel} — ${displayTitle(m)}`;
    tick.innerHTML = `<span></span><b>${esc(m.timeLabel)}</b>`;
    tick.addEventListener('click', () => selectLayer(m.id));
    dom.ticks.appendChild(tick);
  });
}

function renderRadios(){
  dom.radios.innerHTML = '';
  state.filtered.forEach(m => {
    const label = document.createElement('label');
    label.className = 'radioItem' + (m.id === state.currentId ? ' active' : '');
    label.innerHTML = `<input type="radio" name="layerRadio" value="${m.id}" ${m.id===state.currentId?'checked':''}><span class="year">${esc(m.timeLabel)}</span><span class="name" title="${esc(displayTitle(m))}">${esc(displayTitle(m))}</span><span class="count">${fmt.format(m.featureCount)}</span>`;
    label.querySelector('input').addEventListener('change', () => selectLayer(m.id));
    dom.radios.appendChild(label);
  });
}

function bind(){
  dom.category.addEventListener('change', () => { applyCategory(); selectLayer(state.currentId); });
  dom.layerSelect.addEventListener('change', e => selectLayer(e.target.value));
  dom.mode.addEventListener('change', () => selectLayer(state.currentId));
  [dom.showPrevious,dom.showHatch,dom.showLabels].forEach(x => x.addEventListener('change', () => selectLayer(state.currentId)));
  [dom.showWater,dom.showRivers].forEach(x => x.addEventListener('change', updateHydro));
  dom.slider.addEventListener('input', e => { const m = state.filtered[Number(e.target.value)]; if(m) selectLayer(m.id); });
  dom.prev.addEventListener('click', () => { const i = currentIndex(); if(i > 0) selectLayer(state.filtered[i-1].id); });
  dom.next.addEventListener('click', () => { const i = currentIndex(); if(i < state.filtered.length-1) selectLayer(state.filtered[i+1].id); });
  dom.fitLayer.addEventListener('click', () => fitCurrentLayer(true));
  dom.fitProject.addEventListener('click', projectFit);
  dom.download.addEventListener('click', () => {
    if(!state.currentMeta) return;
    const a = document.createElement('a');
    a.href = state.currentMeta.file;
    a.download = state.currentMeta.file.split('/').pop();
    a.click();
  });
  dom.search.addEventListener('input', () => state.currentJson && renderTable(state.currentJson.features || []));
}

async function init(){
  if(!window.L){
    alert('Leaflet не загрузился. Проверь интернет/CDN или открой проект через GitHub Pages.');
    return;
  }
  setStatus('Загрузка manifest…');
  state.manifest = await loadJson('data/manifest.json');
  state.layers = [...state.manifest.layers];
  state.currentId = state.manifest.defaultLayerId;
  initMap();
  bind();
  applyCategory();
  await drawHydro().catch(err => setStatus(`Гидрография не загрузилась: ${esc(err.message)}`));
  await selectLayer(state.currentId);
}

init().catch(err => {
  console.error(err);
  setStatus(`<b>Ошибка:</b> ${esc(err.message)}`);
  alert('Ошибка загрузки: ' + err.message);
});
