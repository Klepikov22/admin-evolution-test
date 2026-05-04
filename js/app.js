'use strict';

const VERSION = '9.0-exact-print-snapshot';
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('ru-RU');

const state = {
  manifest:null, map:null, layers:[], filtered:[],
  currentId:null, currentMeta:null, currentJson:null,
  currentLayer:null, previousLayer:null, hatchLayer:null, waterLayer:null, riverLayer:null,
  cache:new Map(), colors:new Map(), selectedLayer:null, selectedFeature:null,
  graticuleLayer:null,
  print:{active:false, originalParent:null, originalNext:null, draggablesReady:false}
};

const dom = {
  status:$('status'), category:$('categorySelect'), layerSelect:$('layerSelect'), mode:$('modeSelect'),
  showWater:$('showWater'), showRivers:$('showRivers'), showPrevious:$('showPrevious'), showHatch:$('showHatch'), showLabels:$('showLabels'),
  slider:$('timeSlider'), ticks:$('timelineTicks'), activeLayerCard:$('activeLayerCard'), radios:$('radioList'),
  prev:$('prevBtn'), next:$('nextBtn'), fitLayer:$('fitLayerBtn'), fitProject:$('fitProjectBtn'), download:$('downloadBtn'),
  layerInfo:$('layerInfo'), featureInfo:$('featureInfo'), schema:$('schemaInfo'), table:$('tableBox'), search:$('tableSearch'), legend:$('legendBox'),
  exportMode:$('exportModeBtn'), printWorkspace:$('printWorkspace'), exitPrint:$('exitPrintBtn'), fitPrintExtent:$('fitPrintExtentBtn'),
  printMapFrame:$('printMapFrame'), printMapField:$('printMapField'), printMapSlot:$('printMapSlot'), printGridLabels:$('printGridLabels'),
  printTitle:$('printTitleInput'), printTitleText:$('printTitleText'), paperFormat:$('paperFormatSelect'), paperOrientation:$('paperOrientationSelect'), printDpi:$('printDpiSelect'),
  showPrintLegend:$('showPrintLegend'), showPrintScale:$('showPrintScale'), showPrintNorth:$('showPrintNorth'), showPrintGrid:$('showPrintGrid'), showPrintGridLabels:$('showPrintGridLabels'), showPrintSource:$('showPrintSource'),
  printGridLabelSize:$('printGridLabelSize'), printGridLabelSizeValue:$('printGridLabelSizeValue'), printLegend:$('printLegend'), printLegendBody:$('printLegendBody'),
  printScale:$('printScaleBar'), printNorth:$('printNorthArrow'), printSource:$('printSourceBox'), printSourceText:$('printSourceText'), printSummary:$('printSummary'), printSummaryBody:$('printSummaryBody'),
  printPage:$('printPage'), browserPrint:$('browserPrintBtn'), pngExport:$('pngExportBtn')
};

const palette = ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9','#a6cee3','#b2df8a','#fdbf6f','#cab2d6','#b15928','#1f78b4','#33a02c','#e31a1c','#6a3d9a','#ff7f00'];
const statusColors = {normal:'#cbd5e1', uncertain:'#f97316'};

const fieldLabels = {
  _display_name:'Объект', _display_map_atd:'Отображаемый уровень АТД', _display_top_atd:'Высший уровень АТД',
  _display_mid_atd:'Средний уровень АТД', _display_low_atd:'Низовой уровень / объект', _display_unit_type:'Тип единицы',
  _display_capital:'Центр', _display_population:'Население', _display_hierarchy:'Иерархия',
  _display_status:'Статус реконструкции', _province_affiliation:'Провинциальная принадлежность',
  _province_note:'Примечание к провинциальной принадлежности', _time_label:'Период', _start_year:'Начало',
  _end_year:'Окончание', _source_file:'Исходный слой', _uncertain_label:'Неопределённость'
};

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function compact(v,n=160){if(v===null||v===undefined||v==='')return '—'; const s=String(v); return s.length>n?s.slice(0,n)+'…':s;}
function setStatus(t){dom.status.innerHTML=t;}
function labelForField(k){return fieldLabels[k] || state.manifest?.fieldLabels?.[k] || k;}
function displayTitle(m){return m?.displayTitle || m?.title || 'Слой';}
function boundsFromBbox(b){return L.latLngBounds([b[1],b[0]],[b[3],b[2]]);}
function currentIndex(){return Math.max(0,state.filtered.findIndex(l=>l.id===state.currentId));}
function isPointFeature(f){return /Point/.test(f?.geometry?.type||'');}
function cleanText(v){return String(v??'').trim();}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

function colorFor(v){const k=cleanText(v)||'Не указано'; if(!state.colors.has(k))state.colors.set(k,palette[state.colors.size%palette.length]); return state.colors.get(k);}
async function loadJson(path){if(state.cache.has(path))return state.cache.get(path); const r=await fetch(`${path}?v=${VERSION}`,{cache:'no-store'}); if(!r.ok)throw new Error(`${r.status} ${path}`); const j=await r.json(); state.cache.set(path,j); return j;}

function initMap(){
  const b=boundsFromBbox(state.manifest.projectBounds);
  state.map=L.map('map',{minZoom:state.manifest.minZoom||5,zoomSnap:.25,zoomDelta:.5,wheelPxPerZoomLevel:220,scrollWheelZoom:'center',doubleClickZoom:'center',touchZoom:'center',zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false,inertia:false,preferCanvas:false});
  state.map.createPane('waterPane'); state.map.getPane('waterPane').style.zIndex=150;
  state.map.createPane('riverPane'); state.map.getPane('riverPane').style.zIndex=170;
  state.map.createPane('previousPane'); state.map.getPane('previousPane').style.zIndex=360;
  state.map.createPane('adminPane'); state.map.getPane('adminPane').style.zIndex=420;
  state.map.createPane('hatchPane'); state.map.getPane('hatchPane').style.zIndex=430;
  state.map.createPane('gridPane'); state.map.getPane('gridPane').style.zIndex=560;
  state.map.setView(b.getCenter(), state.manifest.minZoom||5, {animate:false});
  L.control.scale({imperial:false}).addTo(state.map);
}

function projectFit(){const b=boundsFromBbox(state.manifest.projectBounds); state.map.setView(b.getCenter(), state.manifest.minZoom||5, {animate:false}); if(state.print.active)setTimeout(updatePrintLayoutElements,80);}

function getName(f){const p=f.properties||{}; return p._display_name||p._name||p.name||p.Name||p.NAME||p.name_ru||p.name_rus||'объект';}
function getTopAtd(f){return (f.properties||{})._display_top_atd||'Не указано';}
function getMidAtd(f){return (f.properties||{})._display_mid_atd||'';}
function getMapAtd(f){return (f.properties||{})._display_map_atd||getMidAtd(f)||getTopAtd(f)||'Не указано';}
function getType(f){return (f.properties||{})._display_unit_type||(f.properties||{})._unit_type||(f.properties||{}).featurecla||'Не указано';}

function isUncertain(f){
  const p=f.properties||{};
  if(Number(p._uncertain)===1||Number(p._hatch)===1)return true;
  const text=[p._display_status,p._uncertain_label,p._display_name,p.Notes,p.Note,p.note,p.Status].map(v=>String(v||'').toLowerCase()).join(' ');
  if(/выверенн|обычн|уточнен|уточнён/.test(text)&&!/двоедан/.test(text))return false;
  return /(спорн|неясн|неустойчив|двоедан|двое\s*дан|переходн|особый статус|особая зона)/.test(text);
}

function styleValue(f){
  const mode=dom.mode.value;
  if(mode==='top')return getMapAtd(f);
  if(mode==='mid')return getMidAtd(f)||getTopAtd(f);
  if(mode==='type')return getType(f);
  if(mode==='uncertain')return isUncertain(f)?((f.properties||{})._uncertain_label||'Спорная / неясная зона'):'Обычная принадлежность';
  return 'Единый цвет';
}

function featureStyle(f,previous=false){
  if(previous)return {color:'#64748b',weight:1.25,opacity:.78,dashArray:'5 5',fillColor:'#64748b',fillOpacity:.025};
  let fill='#e4b36c';
  if(dom.mode.value==='uncertain')fill=isUncertain(f)?statusColors.uncertain:statusColors.normal;
  else if(dom.mode.value!=='single')fill=colorFor(styleValue(f));
  if(isUncertain(f)&&!isPointFeature(f))return {color:'transparent',weight:0,opacity:0,fillColor:fill,fillOpacity:.12};
  return {color:'#263746',weight:1.35,opacity:.98,fillColor:fill,fillOpacity:.46};
}
function selectedOutlineStyle(){return {color:'#a65b00',weight:3.4,opacity:1,fillOpacity:0};}
function pointStyle(f,previous=false){const u=isUncertain(f); return {radius:previous?4:(u?7:5.5),color:previous?'#64748b':(u?'#7c2d12':'#3a2607'),weight:previous?1:1.4,fillColor:previous?'#94a3b8':(u?'#f97316':'#f6c85f'),fillOpacity:previous?.35:.9,opacity:.98};}

const HatchCanvasLayer=L.Layer.extend({
  initialize(features,colorFn,options={}){this.features=features||[];this.colorFn=colorFn||(()=> '#777');this.options=Object.assign({spacing:10,lineWidth:1.25,opacity:.42},options);},
  onAdd(map){this._map=map;this._canvas=L.DomUtil.create('canvas','hatch-canvas-layer');this._canvas.style.pointerEvents='none';this._canvas.style.position='absolute';(map.getPane('hatchPane')||map.getPanes().overlayPane).appendChild(this._canvas);map.on('move zoom resize viewreset',this._reset,this);this._reset();},
  onRemove(map){map.off('move zoom resize viewreset',this._reset,this);if(this._canvas)L.DomUtil.remove(this._canvas);this._canvas=null;},
  _reset(){if(!this._map||!this._canvas)return;const size=this._map.getSize();const retina=window.devicePixelRatio||1;this._canvas.width=Math.max(1,Math.round(size.x*retina));this._canvas.height=Math.max(1,Math.round(size.y*retina));this._canvas.style.width=size.x+'px';this._canvas.style.height=size.y+'px';L.DomUtil.setPosition(this._canvas,this._map.containerPointToLayerPoint([0,0]));const ctx=this._canvas.getContext('2d');ctx.setTransform(retina,0,0,retina,0,0);ctx.clearRect(0,0,size.x,size.y);this._draw(ctx);},
  _ringsForFeature(f){const g=f.geometry||{}; if(g.type==='Polygon')return [g.coordinates||[]]; if(g.type==='MultiPolygon')return g.coordinates||[]; return [];},
  _draw(ctx){const spacing=this.options.spacing, alpha=this.options.opacity; for(const feature of this.features){const polys=this._ringsForFeature(feature); if(!polys.length)continue; const color=this.colorFn(feature)||'#777'; for(const rings of polys){if(!rings||!rings.length)continue; ctx.save(); ctx.beginPath(); let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; rings.forEach(ring=>{if(!ring||ring.length<3)return; ring.forEach((xy,i)=>{const pt=this._map.latLngToContainerPoint([xy[1],xy[0]]); if(i===0)ctx.moveTo(pt.x,pt.y); else ctx.lineTo(pt.x,pt.y); minX=Math.min(minX,pt.x);minY=Math.min(minY,pt.y);maxX=Math.max(maxX,pt.x);maxY=Math.max(maxY,pt.y);}); ctx.closePath();}); if(!Number.isFinite(minX)){ctx.restore();continue;} ctx.clip('evenodd'); ctx.globalAlpha=alpha; ctx.strokeStyle=color; ctx.lineWidth=this.options.lineWidth; const start=Math.floor((minX-maxY-80)/spacing)*spacing; const end=Math.ceil((maxX-minY+80)/spacing)*spacing; for(let d=start;d<=end;d+=spacing){ctx.beginPath();ctx.moveTo(d+minY-40,minY-40);ctx.lineTo(d+maxY+40,maxY+40);ctx.stroke();} ctx.restore();}}}
});
L.hatchCanvasLayer=(features,colorFn,options)=>new HatchCanvasLayer(features,colorFn,options);

function popup(f){
  const p=f.properties||{}; const keys=['_display_name','_display_hierarchy','_display_top_atd','_display_mid_atd','_display_unit_type','_display_capital','_display_population','_display_status','_time_label','_source_file','Confidence','Source'];
  const rest=Object.keys(p).filter(k=>!k.startsWith('_display')&&!keys.includes(k)&&!k.startsWith('_')).slice(0,50);
  const rows=keys.concat(rest).map(k=>`<tr><td>${esc(labelForField(k))}</td><td>${esc(compact(p[k],240))}</td></tr>`).join('');
  return `<b>${esc(getName(f))}</b><table class="popupTable">${rows}</table>`;
}

function onEach(previous=false){
  return (f,l)=>{
    const name=getName(f);
    if(name)l.bindTooltip(esc(name),{sticky:!dom.showLabels.checked,permanent:dom.showLabels.checked&&!previous,direction:'center',className:'featureLabel'});
    l.bindPopup(popup(f),{maxWidth:460});
    if(!previous){
      l.on('click',()=>selectFeature(f,l));
      if(l.setStyle){
        l.on('mouseover',()=>{if(state.selectedLayer!==l)l.setStyle(isUncertain(f)&&!isPointFeature(f)?{color:'transparent',weight:0,opacity:0,fillOpacity:.20}:{weight:2.7,fillOpacity:.56});});
        l.on('mouseout',()=>{if(state.selectedLayer!==l)l.setStyle(featureStyle(f,false));});
      }
    }
  };
}

function clearCurrent(){['currentLayer','previousLayer','hatchLayer'].forEach(k=>{if(state[k]){state.map.removeLayer(state[k]);state[k]=null;}});state.selectedLayer=null;state.selectedFeature=null;}

async function drawPrevious(){if(!dom.showPrevious.checked)return; const i=currentIndex(); if(i<=0)return; const meta=state.filtered[i-1]; const gj=await loadJson(meta.file); state.previousLayer=L.geoJSON(gj,{pane:'previousPane',style:f=>featureStyle(f,true),pointToLayer:(f,ll)=>L.circleMarker(ll,pointStyle(f,true)),onEachFeature:onEach(true)}).addTo(state.map);}
function hatchColor(f){return colorFor(getMapAtd(f)||getTopAtd(f)||'Спорная зона');}

async function selectLayer(id){
  state.currentId=id; state.currentMeta=state.layers.find(l=>l.id===id); if(!state.currentMeta)return;
  clearCurrent(); setStatus(`Загрузка: <b>${esc(displayTitle(state.currentMeta))}</b>…`);
  dom.layerSelect.value=id; renderTimeline(); await drawPrevious();
  const gj=await loadJson(state.currentMeta.file); state.currentJson=gj;
  state.currentLayer=L.geoJSON(gj,{pane:'adminPane',style:f=>featureStyle(f,false),pointToLayer:(f,ll)=>L.circleMarker(ll,pointStyle(f,false)),onEachFeature:onEach(false)}).addTo(state.map);
  if(dom.showHatch.checked){const h=(gj.features||[]).filter(f=>isUncertain(f)&&!isPointFeature(f)); if(h.length)state.hatchLayer=L.hatchCanvasLayer(h,hatchColor,{spacing:9,lineWidth:1.15,opacity:.46}).addTo(state.map);}
  renderPanels(gj);
  if(state.print.active)fitPrintExtent(); else fitCurrentLayer(false);
  setStatus(`Активно: <b>${esc(state.currentMeta.timeLabel)}</b> · ${esc(displayTitle(state.currentMeta))} · объектов: ${fmt.format(state.currentMeta.featureCount)}`);
  updatePrintLayoutElements();
}

function layerBoundsForFeature(f){
  if(!f)return null; const layer=L.geoJSON(f); const b=layer.getBounds?.(); if(b&&b.isValid())return b;
  if(f.geometry?.type==='Point'){const [lon,lat]=f.geometry.coordinates; return L.latLngBounds([lat-.6,lon-.6],[lat+.6,lon+.6]);}
  return null;
}
function getPrintTargetBounds(){if(state.selectedFeature){const b=layerBoundsForFeature(state.selectedFeature); if(b&&b.isValid())return b;} const b=state.currentLayer?.getBounds?.(); if(b&&b.isValid())return b; return boundsFromBbox(state.manifest.projectBounds);}
function bufferedBounds(bounds,fraction=.08){if(!bounds||!bounds.isValid())return bounds; const sw=bounds.getSouthWest(), ne=bounds.getNorthEast(); let latPad=Math.abs(ne.lat-sw.lat)*fraction, lngPad=Math.abs(ne.lng-sw.lng)*fraction; if(latPad<.18)latPad=.18; if(lngPad<.18)lngPad=.18; return L.latLngBounds([sw.lat-latPad,sw.lng-lngPad],[ne.lat+latPad,ne.lng+lngPad]);}
function fitCurrentLayer(animated=true){const b=state.currentLayer?.getBounds?.(); if(b&&b.isValid()){state.map.fitBounds(bufferedBounds(b,.05),{padding:[28,28],maxZoom:7,animate:animated}); setTimeout(updatePrintLayoutElements,80);}}
function fitPrintExtent(){const b=bufferedBounds(getPrintTargetBounds(),.10); if(b&&b.isValid()){state.map.fitBounds(b,{padding:[24,24],maxZoom:8,animate:false}); setTimeout(updatePrintLayoutElements,140);}}

async function drawHydro(){
  setStatus('Загрузка гидрографии…'); const h=state.manifest.hydro; const [water,rivers]=await Promise.all([loadJson(h.water),loadJson(h.rivers)]);
  state.waterLayer=L.geoJSON(water,{pane:'waterPane',interactive:false,style:{color:'transparent',weight:0,fillColor:'#a9d4e5',fillOpacity:1}});
  state.riverLayer=L.geoJSON(rivers,{pane:'riverPane',interactive:false,style:f=>{const sw=Number(f.properties?.strokeweig); return {color:'#6aaec7',weight:Number.isFinite(sw)?Math.max(.45,Math.min(1.25,sw*.7)):.65,opacity:.9,lineCap:'round',lineJoin:'round'};}});
  updateHydro();
}
function updateHydro(){if(state.waterLayer){const has=state.map.hasLayer(state.waterLayer); if(dom.showWater.checked&&!has)state.waterLayer.addTo(state.map); if(!dom.showWater.checked&&has)state.map.removeLayer(state.waterLayer);} if(state.riverLayer){const has=state.map.hasLayer(state.riverLayer); if(dom.showRivers.checked&&!has)state.riverLayer.addTo(state.map); if(!dom.showRivers.checked&&has)state.map.removeLayer(state.riverLayer);}}

function selectFeature(f,l){if(state.selectedLayer&&state.selectedLayer.setStyle)state.selectedLayer.setStyle(featureStyle(state.selectedFeature,false)); state.selectedLayer=l; state.selectedFeature=f; if(l.setStyle)l.setStyle(selectedOutlineStyle()); renderFeature(f); if(state.print.active)fitPrintExtent(); updatePrintLayoutElements();}
function renderFeature(f){const p=f.properties||{}; const rows=['_display_hierarchy','_display_map_atd','_display_top_atd','_display_mid_atd','_province_note','_display_unit_type','_display_capital','_display_population','_display_status','_source_file'].map(k=>`<div class="row"><span>${esc(labelForField(k))}</span><b>${esc(compact(p[k],220))}</b></div>`).join(''); const badge=isUncertain(f)?`<span class="badge warn">спорная / неясная зона</span>`:`<span class="badge">обычный объект</span>`; dom.featureInfo.innerHTML=`${badge}<div class="infoTitle">${esc(getName(f))}</div>${rows}`;}

function renderPanels(gj){
  const feats=gj.features||[], uncertain=feats.filter(isUncertain).length, topVals=[...new Set(feats.map(getTopAtd).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  dom.layerInfo.innerHTML=`<div class="infoTitle">${esc(displayTitle(state.currentMeta))}</div><div class="row"><span>Период</span><b>${esc(state.currentMeta.timeLabel)}</b></div><div class="row"><span>Категория</span><b>${esc(state.currentMeta.categoryLabel||state.currentMeta.category)}</b></div><div class="row"><span>Объектов</span><b>${fmt.format(feats.length)}</b></div><div class="row"><span>Верхних АТЕ</span><b>${fmt.format(topVals.length)}</b></div><div class="row"><span>Спорных / неясных</span><b>${fmt.format(uncertain)}</b></div>`;
  renderLegend(feats); renderSchema(feats); renderTable(feats); dom.featureInfo.innerHTML='Кликни по полигону / объекту.';
}
function renderLegend(feats){
  const groups=new Map(); feats.forEach(f=>{const key=styleValue(f); groups.set(key,(groups.get(key)||0)+1);});
  const rows=[...groups.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ru')).slice(0,24).map(([name,count])=>{const color=dom.mode.value==='uncertain'?(name.includes('Обычная')?statusColors.normal:statusColors.uncertain):colorFor(name); return `<div class="legendRow"><span class="legendSwatch" style="background:${esc(color)}"></span><span title="${esc(name)}">${esc(compact(name,80))}</span><b>${fmt.format(count)}</b></div>`;}).join('');
  const hc=feats.filter(f=>isUncertain(f)&&!isPointFeature(f)).length; const hatch=hc?`<div class="legendRow specialLegend"><span class="legendSwatch hatchSwatch"></span><span>Особый статус / спорная зона</span><b>${fmt.format(hc)}</b></div>`:''; dom.legend.innerHTML=(rows+hatch)||'<div class="muted">Нет данных для легенды.</div>'; updatePrintLayoutElements();
}
function schemaStats(feats){const stats=new Map(); feats.forEach(f=>Object.entries(f.properties||{}).forEach(([k,v])=>{if(!stats.has(k))stats.set(k,{n:0,t:new Set(),s:[]}); const st=stats.get(k); if(v!==null&&v!==undefined&&v!==''){st.n++; st.t.add(Array.isArray(v)?'array':typeof v); const sv=String(v); if(st.s.length<2&&!st.s.includes(sv))st.s.push(compact(sv,60));}})); return [...stats.entries()].sort((a,b)=>((a[0].startsWith('_display')?'0':'1')+a[0]).localeCompare((b[0].startsWith('_display')?'0':'1')+b[0],'ru'));}
function renderSchema(feats){dom.schema.innerHTML=`<table class="schemaTable"><thead><tr><th>Поле</th><th>Тип</th><th>Заполнено</th><th>Примеры</th></tr></thead><tbody>${schemaStats(feats).map(([k,st])=>`<tr><td>${esc(labelForField(k))}<small>${esc(k)}</small></td><td>${esc([...st.t].join(', ')||'—')}</td><td>${st.n}/${feats.length}</td><td>${esc(st.s.join(' · ')||'—')}</td></tr>`).join('')}</tbody></table>`;}
function renderTable(feats){const q=(dom.search.value||'').toLowerCase(); const shown=feats.filter(f=>!q||JSON.stringify(f.properties||{}).toLowerCase().includes(q)).slice(0,250); dom.table.innerHTML=`<table class="attrTable"><thead><tr><th>#</th><th>Объект</th><th>На карте</th><th>Средний уровень</th><th>Тип</th><th>Статус</th></tr></thead><tbody>${shown.map((f,i)=>`<tr data-i="${i}"><td>${i+1}</td><td>${esc(compact(getName(f),70))}</td><td>${esc(compact(getMapAtd(f),70))}</td><td>${esc(compact(getMidAtd(f),60))}</td><td>${esc(compact(getType(f),45))}</td><td>${esc(isUncertain(f)?((f.properties||{})._uncertain_label||'да'):'—')}</td></tr>`).join('')}</tbody></table><div class="muted tableHint">Показано ${shown.length} из ${feats.length}.</div>`; dom.table.querySelectorAll('tr[data-i]').forEach(tr=>tr.addEventListener('click',()=>renderFeature(shown[Number(tr.dataset.i)])));}

function applyCategory(){const cat=dom.category.value; state.filtered=state.layers.filter(l=>cat==='all'||l.category===cat); if(!state.filtered.length)state.filtered=[...state.layers]; state.filtered.sort((a,b)=>(a.year-b.year)||(a.startYear-b.startYear)||displayTitle(a).localeCompare(displayTitle(b),'ru')); if(!state.currentId||!state.filtered.some(l=>l.id===state.currentId))state.currentId=(state.filtered.find(l=>l.id===state.manifest.defaultLayerId)||state.filtered[state.filtered.length-1])?.id; renderLayerSelect(); renderTimeline();}
function renderLayerSelect(){dom.layerSelect.innerHTML=''; state.filtered.forEach(m=>{const o=document.createElement('option'); o.value=m.id; o.textContent=`${m.timeLabel} — ${displayTitle(m)}`; if(m.id===state.currentId)o.selected=true; dom.layerSelect.appendChild(o);});}
function renderTimeline(){const i=currentIndex(), meta=state.filtered[i]||state.currentMeta; dom.slider.max=Math.max(0,state.filtered.length-1); dom.slider.value=String(i); if(dom.activeLayerCard&&meta)dom.activeLayerCard.innerHTML=`<div><span>Активный срез</span><b>${esc(meta.timeLabel)}</b></div><p>${esc(displayTitle(meta))}</p>`; renderTicks(i); renderRadios();}
function renderTicks(active){dom.ticks.innerHTML=''; state.filtered.forEach((m,i)=>{const tick=document.createElement('button'); tick.type='button'; tick.className='timelineTick'+(i===active?' active':''); tick.title=`${m.timeLabel} — ${displayTitle(m)}`; tick.innerHTML=`<span></span><b>${esc(m.timeLabel)}</b>`; tick.addEventListener('click',()=>selectLayer(m.id)); dom.ticks.appendChild(tick);});}
function renderRadios(){dom.radios.innerHTML=''; state.filtered.forEach(m=>{const label=document.createElement('label'); label.className='radioItem'+(m.id===state.currentId?' active':''); label.innerHTML=`<input type="radio" name="layerRadio" value="${m.id}" ${m.id===state.currentId?'checked':''}><span class="year">${esc(m.timeLabel)}</span><span class="name" title="${esc(displayTitle(m))}">${esc(displayTitle(m))}</span><span class="count">${fmt.format(m.featureCount)}</span>`; label.querySelector('input').addEventListener('change',()=>selectLayer(m.id)); dom.radios.appendChild(label);});}

function clearGraticule(){if(state.graticuleLayer){state.map.removeLayer(state.graticuleLayer);state.graticuleLayer=null;} if(dom.printGridLabels)dom.printGridLabels.innerHTML='';}
function degreeStep(span){if(span<=4)return .5; if(span<=8)return 1; if(span<=18)return 2; if(span<=35)return 5; return 10;}
function formatLon(lon){const hemi=lon>=0?'E':'W', abs=Math.abs(lon); return `${Number.isInteger(abs)?abs:abs.toFixed(1)}°${hemi}`;}
function formatLat(lat){const hemi=lat>=0?'N':'S', abs=Math.abs(lat); return `${Number.isInteger(abs)?abs:abs.toFixed(1)}°${hemi}`;}
function addGridLabel(side,x,y,text){if(!dom.printGridLabels||!dom.showPrintGridLabels.checked)return; const el=document.createElement('div'); el.className=`printGridLabel ${side}`; el.textContent=text; el.style.fontSize=`${dom.printGridLabelSize?.value||11}px`; if(side==='top'||side==='bottom')el.style.left=`${x}px`; else el.style.top=`${y}px`; dom.printGridLabels.appendChild(el);}
function buildGraticule(){
  clearGraticule(); if(!state.map||!state.print.active||!dom.showPrintGrid.checked)return;
  const b=state.map.getBounds(), west=b.getWest(), east=b.getEast(), south=b.getSouth(), north=b.getNorth();
  const step=Math.max(.5,degreeStep(Math.max(Math.abs(east-west),Math.abs(north-south))));
  const lon0=Math.ceil(west/step)*step, lat0=Math.ceil(south/step)*step;
  state.graticuleLayer=L.layerGroup().addTo(state.map);
  const w=dom.printMapField.clientWidth, h=dom.printMapField.clientHeight;
  for(let lon=lon0;lon<=east+.0001;lon+=step){const pts=[]; for(let i=0;i<=80;i++)pts.push([south+(north-south)*i/80,lon]); L.polyline(pts,{interactive:false,pane:'gridPane',color:'#475569',weight:.7,opacity:.34,dashArray:'2 5'}).addTo(state.graticuleLayer); if(dom.showPrintGridLabels.checked){const top=state.map.latLngToContainerPoint([north,lon]), bot=state.map.latLngToContainerPoint([south,lon]); addGridLabel('top',clamp(top.x,26,w-26),0,formatLon(Number(lon.toFixed(2)))); addGridLabel('bottom',clamp(bot.x,26,w-26),0,formatLon(Number(lon.toFixed(2))));}}
  for(let lat=lat0;lat<=north+.0001;lat+=step){const pts=[]; for(let i=0;i<=100;i++)pts.push([lat,west+(east-west)*i/100]); L.polyline(pts,{interactive:false,pane:'gridPane',color:'#475569',weight:.7,opacity:.34,dashArray:'2 5'}).addTo(state.graticuleLayer); if(dom.showPrintGridLabels.checked){const left=state.map.latLngToContainerPoint([lat,west]), right=state.map.latLngToContainerPoint([lat,east]); addGridLabel('left',0,clamp(left.y,20,h-20),formatLat(Number(lat.toFixed(2)))); addGridLabel('right',0,clamp(right.y,20,h-20),formatLat(Number(lat.toFixed(2))));}}
}
function metersPerPixelAtCenter(){const c=state.map.getCenter(), p1=state.map.latLngToContainerPoint(c), p2=L.point(p1.x+100,p1.y), ll2=state.map.containerPointToLatLng(p2); return c.distanceTo(ll2)/100;}
function niceDistance(m){const pow=Math.pow(10,Math.floor(Math.log10(Math.max(1,m)))), n=m/pow; if(n<2)return pow; if(n<5)return 2*pow; return 5*pow;}
function updateScaleBar(){if(!dom.printScale||!state.print.active)return; const targetPx=Math.max(120,Math.round(dom.printMapField.clientWidth*.16)); const mpp=metersPerPixelAtCenter(), meters=niceDistance(mpp*targetPx), width=Math.max(40,Math.round(meters/mpp)); dom.printScale.innerHTML=`<div class="scaleBarLine" style="width:${width}px"></div><b>${meters>=1000?(meters/1000)+' км':meters+' м'}</b>`;}
function getCurrentSummary(){const feats=state.currentJson?.features||[]; return {count:feats.length, topCount:new Set(feats.map(getTopAtd).filter(Boolean)).size, midCount:new Set(feats.map(getMidAtd).filter(Boolean)).size, uncertain:feats.filter(isUncertain).length, selected:state.selectedFeature?getName(state.selectedFeature):'нет'};}
function applyPaperSettings(){dom.printPage.dataset.format=dom.paperFormat?.value||'a3'; dom.printPage.dataset.orientation=dom.paperOrientation?.value||'landscape'; if(dom.printTitleText)dom.printTitleText.textContent=dom.printTitle?.value||'Карта'; if(dom.printGridLabelSizeValue)dom.printGridLabelSizeValue.textContent=dom.printGridLabelSize?.value||'11';}
function updatePrintLayoutElements(){
  if(!state.print.active)return; applyPaperSettings();
  if(dom.printLegend){dom.printLegend.style.display=dom.showPrintLegend.checked?'block':'none'; dom.printLegendBody.innerHTML=dom.legend.innerHTML||'<div class="muted">Нет данных.</div>';}
  if(dom.printNorth)dom.printNorth.style.display=dom.showPrintNorth.checked?'grid':'none';
  if(dom.printScale){dom.printScale.style.display=dom.showPrintScale.checked?'flex':'none'; updateScaleBar();}
  if(dom.printSource){dom.printSource.style.display=dom.showPrintSource.checked?'block':'none'; dom.printSourceText.innerHTML=`Срез: <b>${esc(state.currentMeta?.timeLabel||'—')}</b><br>${esc(displayTitle(state.currentMeta))}<br>Источник: ${esc(state.currentMeta?.file||'')}`;}
  if(dom.printSummaryBody){const s=getCurrentSummary(); dom.printSummaryBody.innerHTML=`<div class="summaryRows"><div><span>Период</span><b>${esc(state.currentMeta?.timeLabel||'—')}</b></div><div><span>Объектов</span><b>${fmt.format(s.count)}</b></div><div><span>Верхний уровень</span><b>${fmt.format(s.topCount)}</b></div><div><span>Средний уровень</span><b>${fmt.format(s.midCount)}</b></div><div><span>Спорных / неясных</span><b>${fmt.format(s.uncertain)}</b></div><div><span>Выбранный объект</span><b>${esc(compact(s.selected,60))}</b></div></div><div class="printHint">Экспорт: точный снимок этого листа.</div>`;}
  if(dom.showPrintGrid.checked)buildGraticule(); else clearGraticule();
}

function resetDraggablePositions(){document.querySelectorAll('.draggable').forEach(el=>{el.style.transform='';el.dataset.tx='0';el.dataset.ty='0'; const dx=el.dataset.defaultX,dy=el.dataset.defaultY,dr=el.dataset.defaultRight,db=el.dataset.defaultBottom; el.style.left=dx?dx+'px':''; el.style.top=dy?dy+'px':''; el.style.right=dr?dr+'px':''; el.style.bottom=db?db+'px':'';});}
function makeDraggable(el){if(!el||el.dataset.draggableReady==='1')return; el.dataset.draggableReady='1'; el.dataset.tx='0'; el.dataset.ty='0'; let sx=0,sy=0,stx=0,sty=0; const move=e=>{const page=dom.printPage.getBoundingClientRect(), rect=el.getBoundingClientRect(); let tx=stx+e.clientX-sx, ty=sty+e.clientY-sy; const left0=rect.left-stx, top0=rect.top-sty; tx=clamp(tx,8-(left0-page.left),page.width-rect.width-8-(left0-page.left)); ty=clamp(ty,8-(top0-page.top),page.height-rect.height-8-(top0-page.top)); el.dataset.tx=tx; el.dataset.ty=ty; el.style.transform=`translate(${tx}px, ${ty}px)`;}; const up=()=>{el.classList.remove('dragging'); window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);}; el.addEventListener('pointerdown',e=>{if(!e.target.closest('.dragHandle'))return; e.preventDefault(); el.classList.add('dragging'); sx=e.clientX; sy=e.clientY; stx=Number(el.dataset.tx||0); sty=Number(el.dataset.ty||0); window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);});}
function initDraggables(){if(state.print.draggablesReady)return; document.querySelectorAll('.draggable').forEach(makeDraggable); resetDraggablePositions(); state.print.draggablesReady=true;}

function enterPrintMode(){
  if(state.print.active)return; state.print.originalParent=$('app'); const mapEl=$('map'); state.print.originalNext=mapEl.nextSibling;
  document.body.classList.add('print-mode'); dom.printWorkspace.classList.remove('hidden'); applyPaperSettings(); dom.printMapSlot.appendChild(mapEl); state.print.active=true; initDraggables();
  setTimeout(()=>{state.map.invalidateSize(false); fitPrintExtent(); updatePrintLayoutElements();},160);
}
function exitPrintMode(){
  if(!state.print.active)return; clearGraticule(); const mapEl=$('map'); if(state.print.originalNext)state.print.originalParent.insertBefore(mapEl,state.print.originalNext); else state.print.originalParent.insertBefore(mapEl,state.print.originalParent.firstChild);
  dom.printWorkspace.classList.add('hidden'); document.body.classList.remove('print-mode'); state.print.active=false; setTimeout(()=>{state.map.invalidateSize(false); fitCurrentLayer(false);},160);
}

async function renderPrintCanvas(scale=2){
  if(!window.html2canvas){throw new Error('html2canvas не загрузился');}
  updatePrintLayoutElements();
  await new Promise(r=>setTimeout(r,180));
  return html2canvas(dom.printPage,{backgroundColor:'#ffffff',scale,useCORS:true,logging:false});
}
async function exportPrintPng(){
  const old=setStatus; setStatus('Подготовка PNG: снимаю текущий лист предпросмотра…');
  const canvas=await renderPrintCanvas(2);
  const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`admin-map-${state.currentMeta?.timeLabel||'layout'}.png`.replace(/\s+/g,'_'); a.click();
  setStatus(`PNG готов: <b>${esc(state.currentMeta?.timeLabel||'—')}</b>`);
}
async function printExactSnapshot(){
  setStatus('Подготовка PDF/печати: снимаю текущий лист предпросмотра…');
  const canvas=await renderPrintCanvas(2);
  const dataUrl=canvas.toDataURL('image/png');
  const orient=dom.paperOrientation.value==='portrait'?'portrait':'landscape';
  const format=dom.paperFormat.value.toUpperCase();
  const w=canvas.width, h=canvas.height;
  const win=window.open('', '_blank');
  if(!win){alert('Браузер заблокировал окно печати. Разреши всплывающие окна или используй экспорт PNG.');return;}
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Печать карты</title><style>@page{size:${format} ${orient};margin:0}html,body{margin:0;background:#fff;width:100%;height:100%}body{display:grid;place-items:center}img{display:block;max-width:100vw;max-height:100vh;width:auto;height:auto}</style></head><body><img src="${dataUrl}" width="${w}" height="${h}" onload="setTimeout(()=>{window.focus();window.print();},250)"></body></html>`);
  win.document.close();
  setStatus(`PDF/печать: открыт точный снимок предпросмотра.`);
}

function bind(){
  dom.category.addEventListener('change',()=>{applyCategory();selectLayer(state.currentId);});
  dom.layerSelect.addEventListener('change',e=>selectLayer(e.target.value));
  dom.mode.addEventListener('change',()=>selectLayer(state.currentId));
  [dom.showPrevious,dom.showHatch,dom.showLabels].forEach(x=>x.addEventListener('change',()=>selectLayer(state.currentId)));
  [dom.showWater,dom.showRivers].forEach(x=>x.addEventListener('change',updateHydro));
  dom.slider.addEventListener('input',e=>{const m=state.filtered[Number(e.target.value)]; if(m)selectLayer(m.id);});
  dom.prev.addEventListener('click',()=>{const i=currentIndex(); if(i>0)selectLayer(state.filtered[i-1].id);});
  dom.next.addEventListener('click',()=>{const i=currentIndex(); if(i<state.filtered.length-1)selectLayer(state.filtered[i+1].id);});
  dom.fitLayer.addEventListener('click',()=>fitCurrentLayer(true)); dom.fitProject.addEventListener('click',projectFit);
  dom.download.addEventListener('click',()=>{if(!state.currentMeta)return; const a=document.createElement('a'); a.href=state.currentMeta.file; a.download=state.currentMeta.file.split('/').pop(); a.click();});
  dom.search.addEventListener('input',()=>state.currentJson&&renderTable(state.currentJson.features||[]));
  dom.exportMode.addEventListener('click',enterPrintMode); dom.exitPrint.addEventListener('click',exitPrintMode); dom.fitPrintExtent.addEventListener('click',fitPrintExtent);
  [dom.printTitle,dom.paperFormat,dom.paperOrientation,dom.printDpi,dom.showPrintLegend,dom.showPrintScale,dom.showPrintNorth,dom.showPrintGrid,dom.showPrintGridLabels,dom.showPrintSource,dom.printGridLabelSize].filter(Boolean).forEach(el=>el.addEventListener('input',()=>{applyPaperSettings(); if(state.print.active){setTimeout(()=>{state.map.invalidateSize(false); updatePrintLayoutElements();},40);}}));
  dom.browserPrint.addEventListener('click',printExactSnapshot); dom.pngExport.addEventListener('click',exportPrintPng);
  state.map.on('moveend zoomend resize',()=>{if(state.print.active)updatePrintLayoutElements();});
}

async function init(){
  if(!window.L){alert('Leaflet не загрузился. Открой через GitHub Pages или локальный сервер.');return;}
  setStatus('Загрузка manifest…'); state.manifest=await loadJson('data/manifest.json'); state.layers=[...state.manifest.layers]; state.currentId=state.manifest.defaultLayerId;
  initMap(); bind(); applyCategory(); await drawHydro().catch(err=>setStatus(`Гидрография не загрузилась: ${esc(err.message)}`)); await selectLayer(state.currentId);
}
init().catch(err=>{console.error(err); setStatus(`<b>Ошибка:</b> ${esc(err.message)}`); alert('Ошибка загрузки: '+err.message);});
