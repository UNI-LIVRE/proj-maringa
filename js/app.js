/* ═══════════ LAYER DEFINITIONS ═══════════ */
const LDEFS = {
  lider_areas:  {label:'Áreas LIDER',       color:'#C87F00', type:'polygon'},
  prio_erosao:  {label:'Prioridade Erosão',  color:'#DC2626', type:'point'},
  ac_criticas:  {label:'Áreas Críticas (AC)',   color:'#B91C1C', type:'polygon'},
  ac_pontos:    {label:'Pontos Críticos META03', color:'#EF4444', type:'point'},
  ble_guaipo:   {label:'Cadastro BLE (Guaipó)', color:'#7C3AED', type:'point'},
  subbacias:    {label:'Subbacias IAM',      color:'#0E7490', type:'polygon'},
  hidrografia:  {label:'Hidrografia',        color:'#2563EB', type:'line'},
  campo:        {label:'Registros campo',    color:null,       type:'point'},
  sond_spt:     {label:'Sondagem SPT/SM',    color:'#1D4ED8', type:'point'},
  sond_ai:      {label:'Caract. Solo (AI)',  color:'#D97706', type:'point'},
  areas_prio:   {label:'Cadastro Microdrenagem', color:'#F97316', type:'polygon'},
  sec_feito:    {label:'Seção (concluída)',  color:'#059669', type:'point'},
  sec_pend:     {label:'Seção (pendente)',   color:'#9CA3AF', type:'point'},
};

/* ═══════════ DADOS (arquivos GeoJSON em /data) ═══════════ */
const PRIO_TOTAL = 50; // total de pontos de erosão previstos

// Cada camada vem de um arquivo em data/. Para atualizar os dados,
// basta editar/substituir o .geojson correspondente (coordenadas em [lng, lat]).
const DATA_FILES = {
  lider_areas: 'data/lider_areas.geojson',
  prio_erosao: 'data/prio_erosao.geojson',
  sond_spt:    'data/sond_spt.geojson',
  sond_ai:     'data/sond_ai.geojson',
  areas_prio:  'data/areas_prio.geojson',
  ac_criticas: 'data/ac_criticas.geojson',
  ac_pontos:   'data/ac_pontos.geojson',
  ble_guaipo:  'data/ble_guaipo.geojson',
  sec_feito:   'data/sec_feito.geojson',
  sec_pend:    'data/sec_pend.geojson',
  subbacias:   'data/subbacias.geojson',
  hidrografia: 'data/hidrografia.geojson',
};

let DATA_LIDER=[], DATA_PRIO=[], DATA_SPT=[], DATA_AI=[], DATA_AREASPRIO=[],
    DATA_AC_PGS=[], DATA_AC_PTS=[], DATA_BLE=[], DATA_SECFEITO=[], DATA_SECPEND=[],
    DATA_SUB=[], DATA_HIDRO=[];

// Converte GeoJSON para o formato interno usado pelo mapa:
//   pontos  -> {…propriedades, lat, lng}
//   linhas/polígonos -> {…propriedades, coords:[[lat,lng],…]}
function featuresToItems(gj){
  const flip = c => [c[1], c[0]];
  return (gj.features || []).filter(f => f && f.geometry).map(f => {
    const g = f.geometry, p = {...(f.properties || {})};
    if (g.type === 'Point') return {...p, lat: g.coordinates[1], lng: g.coordinates[0]};
    if (g.type === 'LineString') return {...p, coords: g.coordinates.map(flip)};
    if (g.type === 'Polygon') return {...p, coords: g.coordinates[0].map(flip)};
    if (g.type === 'MultiPolygon') return {...p, coords: g.coordinates.map(poly => poly.map(r => r.map(flip)))};
    if (g.type === 'MultiLineString') return {...p, coords: g.coordinates.map(l => l.map(flip))};
    return null;
  }).filter(Boolean);
}

async function loadData(){
  const entries = Object.entries(DATA_FILES);
  const results = await Promise.all(entries.map(async ([key, url]) => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return [key, featuresToItems(await r.json())];
    } catch (e) {
      console.error('Falha ao carregar', url, e);
      return [key, null];
    }
  }));
  const d = Object.fromEntries(results);
  const failed = results.filter(([, v]) => v === null).map(([k]) => k);
  DATA_LIDER = d.lider_areas || [];  DATA_PRIO = d.prio_erosao || [];
  DATA_SPT = d.sond_spt || [];       DATA_AI = d.sond_ai || [];
  DATA_AREASPRIO = d.areas_prio || []; DATA_AC_PGS = d.ac_criticas || [];
  DATA_AC_PTS = d.ac_pontos || [];   DATA_BLE = d.ble_guaipo || [];
  DATA_SECFEITO = d.sec_feito || []; DATA_SECPEND = d.sec_pend || [];
  DATA_SUB = d.subbacias || [];      DATA_HIDRO = d.hidrografia || [];
  if (failed.length) {
    const local = location.protocol === 'file:';
    toast(local
      ? 'Os dados não carregam abrindo o arquivo direto. Use o Live Server no VS Code.'
      : 'Falha ao carregar: ' + failed.join(', '));
  }
}

const PHASES=[
  {id:'diagnostico',name:'Diagnóstico e Cadastro'},
  {id:'topografia',name:'Levantamento Topográfico'},
  {id:'hidrologico',name:'Estudo Hidrológico'},
  {id:'plano',name:'Plano de Ação Climática'},
  {id:'relatorio',name:'Relatório Final'},
];
const SCOL={concluido:'#1A9B6C',em_andamento:'#C87F00',nao_iniciado:'#6B7280',problema:'#DC2626'};
const SLBL={concluido:'Concluído',em_andamento:'Em andamento',nao_iniciado:'Não iniciado',problema:'Problema'};
const PHLBL={diagnostico:'Diagnóstico',topografia:'Topografia',hidrologico:'Hidrológico',plano:'Plano',relatorio:'Relatório'};

/* ═══════════ STATE ═══════════ */
let map, records=[], lgps={}, lvis={};
let mode='view', currentPhotos=[];
let searchTimer=null, searchBusy=false;
let pendingImport=null, legendCollapsed=false;

/* ═══════════ INIT ═══════════ */
async function init(){
  await loadData();
  try{const r=localStorage.getItem('iam007_v3');if(r)records=JSON.parse(r);}catch(e){}
  initMap();renderStats();renderPhases();renderLayers();renderList();
}
function saveRecs(){try{localStorage.setItem('iam007_v3',JSON.stringify(records));}catch(e){}}

/* ═══════════ MAP ═══════════ */

function addAcCriticas(){
  DATA_AC_PGS.forEach(p=>{
    L.polygon(p.coords,{color:'#B91C1C',weight:2,fillColor:'#B91C1C',fillOpacity:0.25,dashArray:'5,4'})
      .bindPopup(`<b>${esc(p.name)}</b><br>Área Crítica META03`)
      .addTo(lgps['ac_criticas']);
  });
}
function addAcPontos(){
  DATA_AC_PTS.forEach(p=>{
    const ic=L.divIcon({html:`<svg width="16" height="16" viewBox="0 0 16 16"><polygon points="8,1 15,15 1,15" fill="#EF4444" stroke="#fff" stroke-width="1.5"/></svg>`,className:'',iconSize:[16,16],iconAnchor:[8,15]});
    L.marker([p.lat,p.lng],{icon:ic})
      .bindPopup(`<b>${esc(p.name)}</b><br>Ponto Crítico META03`)
      .addTo(lgps['ac_pontos']);
  });
}
function addBleGuaipo(){
  DATA_BLE.forEach(p=>{
    const ic=L.divIcon({html:`<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#7C3AED" stroke="#fff" stroke-width="1.5"/></svg>`,className:'',iconSize:[14,14],iconAnchor:[7,7]});
    L.marker([p.lat,p.lng],{icon:ic})
      .bindPopup(`<b>${esc(p.name)}</b><br>Boca de Lobo — Microdrenagem Guaipó`)
      .addTo(lgps['ble_guaipo']);
  });
}

function initMap(){
  map=L.map('map',{center:[-23.425,-51.935],zoom:13});
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{
    attribution:'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, USGS',
    maxZoom:19
  }).addTo(map);

  Object.keys(LDEFS).forEach(k=>{lgps[k]=L.layerGroup().addTo(map);lvis[k]=true;});

  addLider(); addPrio(); addSubbacias(); addAcCriticas(); addAcPontos(); addBleGuaipo(); addHidro();
  addSondSpt(); addSondAi(); addSecFeito(); addSecPend();
  records.forEach(r=>addPinMkr(r));

  map.on('click',e=>{
    if(mode!=='pin')return;
    openForm({lat:e.latlng.lat,lng:e.latlng.lng});
  });
}

/* ─── Icons ─────────── */
function mkDiamond(c){c=c||'#7C3AED';
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><polygon points="10,1 19,10 10,19 1,10" fill="${c}" stroke="white" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" fill="white"/></svg>`,
    className:'',iconSize:[20,20],iconAnchor:[10,10],popupAnchor:[0,-12]});}
function mkPrioIcon(){
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><polygon points="11,1 21,11 11,21 1,11" fill="#DC2626" stroke="white" stroke-width="1.5"/><circle cx="11" cy="11" r="3" fill="white"/></svg>`,
    className:'',iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-13]});}
function mkPinIcon(status){
  const c=SCOL[status]||'#6B7280';
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34"><path d="M13 0C5.82 0 0 5.82 0 13C0 22.75 13 34 13 34S26 22.75 26 13C26 5.82 20.18 0 13 0Z" fill="${c}" stroke="white" stroke-width="1.5"/><circle cx="13" cy="13" r="5.5" fill="white"/></svg>`,
    className:'',iconSize:[26,34],iconAnchor:[13,34],popupAnchor:[0,-36]});}

/* ─── Add real layers ─────────── */
function addLider(){
  DATA_LIDER.forEach(p=>{
    L.polygon(p.coords,{color:'#C87F00',weight:2.5,dashArray:'8,5',fillColor:'#C87F00',fillOpacity:0.10})
     .bindPopup(`<b>Levantamento LIDER</b><br>${esc(p.name||'')}`)
     .addTo(lgps['lider_areas']);
  });
}
function addPrio(){
  DATA_PRIO.forEach(p=>{
    L.marker([p.lat,p.lng],{icon:mkPrioIcon()})
     .bindPopup(`<b style="font-size:13px">${esc(p.name)}</b>${p.desc?'<br><span style="font-size:12px;color:#555">'+esc(p.desc)+'</span>':''}<br><span style="font-size:11px;color:#DC2626;font-weight:600">Prioridade Erosão</span>`)
     .addTo(lgps['prio_erosao']);
  });
}
function addSubbacias(){
  DATA_SUB.forEach(p=>{
    L.polygon(p.coords,{color:'#0E7490',weight:1.5,fillColor:'#0E7490',fillOpacity:0.07})
     .bindPopup(`<b>${esc(p.name||'Subbacia')}</b><br>Subbacia hidrográfica IAM`)
     .addTo(lgps['subbacias']);
  });
}
function addHidro(){
  DATA_HIDRO.forEach(ln=>{
    L.polyline(ln.coords,{color:'#2563EB',weight:2.5,opacity:.75})
     .bindPopup(`<b>Hidrografia</b>${ln.name?'<br>'+esc(ln.name):''}`)
     .addTo(lgps['hidrografia']);
  });
}
function addAreasPrio(){
  DATA_AREASPRIO.forEach(p=>{
    L.polygon(p.coords,{color:'#F97316',weight:2,dashArray:'6,4',fillColor:'#F97316',fillOpacity:0.18})
     .bindPopup(`<b>Área Prioritária — Microdrenagem</b>${p.name?'<br><span style="font-size:12px;color:#555">'+esc(p.name)+'</span>':''}<br><span style="font-size:11px;color:#F97316;font-weight:600">Meta 03 — Área de contribuição prioritária</span>`)
     .addTo(lgps['areas_prio']);
  });
}
function mkSptIcon(isSM){
  const c=isSM?'#7C3AED':'#1D4ED8';
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="${c}" stroke="white" stroke-width="1.5"/><line x1="10" y1="3" x2="10" y2="17" stroke="white" stroke-width="2"/><line x1="3" y1="10" x2="17" y2="10" stroke="white" stroke-width="2"/></svg>`,
    className:'',iconSize:[20,20],iconAnchor:[10,10],popupAnchor:[0,-12]});}
function mkAiIcon(){
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect x="1" y="1" width="16" height="16" rx="3" fill="#D97706" stroke="white" stroke-width="1.5"/><text x="9" y="13" text-anchor="middle" fill="white" font-size="9" font-weight="bold">AI</text></svg>`,
    className:'',iconSize:[18,18],iconAnchor:[9,9],popupAnchor:[0,-11]});}
function mkSecFeitoIcon(){
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><polygon points="10,1 19,10 10,19 1,10" fill="#059669" stroke="white" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" fill="white"/></svg>`,
    className:'',iconSize:[20,20],iconAnchor:[10,10],popupAnchor:[0,-12]});}
function mkSecPendIcon(){
  return L.divIcon({html:`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><polygon points="10,1 19,10 10,19 1,10" fill="white" stroke="#9CA3AF" stroke-width="2"/><circle cx="10" cy="10" r="2.5" fill="#9CA3AF"/></svg>`,
    className:'',iconSize:[20,20],iconAnchor:[10,10],popupAnchor:[0,-12]});}
function addSondSpt(){
  DATA_SPT.forEach(p=>{
    const isSM=p.name.startsWith('SM');
    L.marker([p.lat,p.lng],{icon:mkSptIcon(isSM)})
     .bindPopup(`<b>${esc(p.name)}</b><br><span style="font-size:11px;color:#1D4ED8;font-weight:600">${isSM?'Presssiômetro Ménard':'Sondagem SPT'}</span><br><span style="font-size:11px;color:#555">${esc(p.ponto)}</span>${p.ensaio?'<br><span style="font-size:11px">'+esc(p.ensaio)+'</span>':''}<br><span style="font-size:11px;color:#059669;font-weight:600">✓ ${esc(p.status)}</span>`)
     .addTo(lgps['sond_spt']);
  });
}
function addSondAi(){
  DATA_AI.forEach(p=>{
    L.marker([p.lat,p.lng],{icon:mkAiIcon()})
     .bindPopup(`<b>${esc(p.name)}</b><br><span style="font-size:11px;color:#D97706;font-weight:600">Caracterização de Solo</span><br><span style="font-size:11px;color:#555">${esc(p.ponto)}</span>${p.ensaio?'<br><span style="font-size:11px">'+esc(p.ensaio)+'</span>':''}<br><span style="font-size:11px;color:#059669;font-weight:600">✓ ${esc(p.status)}</span>`)
     .addTo(lgps['sond_ai']);
  });
}
function addSecFeito(){
  DATA_SECFEITO.forEach(p=>{
    L.marker([p.lat,p.lng],{icon:mkSecFeitoIcon()})
     .bindPopup(`<b>${esc(p.name)}</b>${p.cod?'<br><span style="font-size:11px;color:#555">'+esc(p.cod)+'</span>':''}<br><span style="font-size:11px;color:#555">${esc(p.bacia)}${p.micro?' — '+esc(p.micro):''}</span><br><span style="font-size:11px;color:#059669;font-weight:600">✓ Topografia Concluída</span>`)
     .addTo(lgps['sec_feito']);
  });
}
function addSecPend(){
  DATA_SECPEND.forEach(p=>{
    L.marker([p.lat,p.lng],{icon:mkSecPendIcon()})
     .bindPopup(`<b>${esc(p.name)}</b>${p.cod?'<br><span style="font-size:11px;color:#555">'+esc(p.cod)+'</span>':''}<br><span style="font-size:11px;color:#555">${esc(p.bacia)}${p.micro?' — '+esc(p.micro):''}</span><br><span style="font-size:11px;color:#DC2626;font-weight:600">⏳ Topografia Pendente</span>`)
     .addTo(lgps['sec_pend']);
  });
}
function addPinMkr(r){
  if(!r.lat||!r.lng)return;
  const m=L.marker([r.lat,r.lng],{icon:mkPinIcon(r.status)})
    .bindPopup(`<div style="min-width:170px"><b style="font-size:14px">${esc(r.rua)}</b>
      <div style="margin-top:5px"><span style="background:${SCOL[r.status]};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px">${SLBL[r.status]}</span></div>
      <div style="font-size:12px;color:#374151;margin-top:5px">${esc(r.ativ||'')} · ${PHLBL[r.fase]||''}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:3px">👷 ${esc(r.tec)} · ${r.data||''}</div>
      ${r.obs?`<div style="font-size:12px;color:#374151;margin-top:4px;font-style:italic">${esc(r.obs)}</div>`:''}
      <button onclick="openForm('${r.id}')" style="margin-top:8px;width:100%;padding:5px;background:#1A9B6C;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">Editar</button>
    </div>`)
    .addTo(lgps['campo']);
  r._mkr=m;
}

/* ═══════════ LAYER TOGGLES ═══════════ */
function renderLayers(){
  const m01=['lider_areas','prio_erosao','sond_spt','sond_ai'];
  const m03=['areas_prio','ac_criticas','ac_pontos','ble_guaipo','sec_feito','sec_pend'];
  const base=['subbacias','hidrografia'];
  document.getElementById('layersM01El').innerHTML=buildLRows(m01);
  document.getElementById('layersM03El').innerHTML=buildLRows(m03);
  document.getElementById('layersBaseEl').innerHTML=buildLRows(base);
  document.getElementById('layersCampoEl').innerHTML=buildLRows(['campo']);
}
function buildLRows(keys){
  return keys.map(k=>{
    const d=LDEFS[k],sw=buildSw(k,d),cnt=lcount(k);
    return `<div class="layer-row" onclick="toggleLayer('${k}')">
      <input type="checkbox" id="chk_${k}" checked onclick="event.stopPropagation()" onchange="toggleLayer('${k}')">
      <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${sw}</div>
      <span class="llabel">${d.label}</span>
      <span class="lcount">${cnt}</span>
    </div>`;
  }).join('');
}
function buildSw(k,d){
  if(k==='lider_areas')return`<svg width="14" height="14"><rect x="1" y="1" width="12" height="12" fill="rgba(200,127,0,.2)" stroke="${d.color}" stroke-width="2" stroke-dasharray="3,2"/></svg>`;
  if(k==='prio_erosao')return`<svg width="14" height="14"><polygon points="7,1 13,7 7,13 1,7" fill="${d.color}" stroke="white" stroke-width="1"/><circle cx="7" cy="7" r="2" fill="white"/></svg>`;  if(k==='areas_prio')return`<svg width="14" height="14"><polygon points="7,1 13,7 7,13 1,7" fill="rgba(249,115,22,.25)" stroke="#F97316" stroke-width="2" stroke-dasharray="3,2"/></svg>`;
  if(k==='sond_spt')return`<svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="${d.color}" stroke="white" stroke-width="1.5"/><line x1="7" y1="2" x2="7" y2="12" stroke="white" stroke-width="1.5"/></svg>`;
  if(k==='sond_ai')return`<svg width="14" height="14"><rect x="1" y="1" width="12" height="12" rx="2" fill="${d.color}" stroke="white" stroke-width="1.5"/></svg>`;
  if(k==='sec_feito')return`<svg width="14" height="14"><polygon points="7,1 13,7 7,13 1,7" fill="${d.color}" stroke="white" stroke-width="1.2"/></svg>`;
  if(k==='sec_pend') return`<svg width="14" height="14"><polygon points="7,1 13,7 7,13 1,7" fill="none" stroke="${d.color}" stroke-width="2"/></svg>`;
  if(k==='subbacias')return`<svg width="14" height="14"><rect x="1" y="1" width="12" height="12" fill="rgba(14,116,144,.12)" stroke="${d.color}" stroke-width="2"/></svg>`;
  if(k==='hidrografia')return`<svg width="14" height="5"><line x1="0" y1="2.5" x2="14" y2="2.5" stroke="${d.color}" stroke-width="2.5"/></svg>`;
  if(k==='ac_criticas')return`<svg width="14" height="14"><rect x="1" y="1" width="12" height="12" fill="rgba(185,28,28,.2)" stroke="#B91C1C" stroke-width="2" stroke-dasharray="4,2"/></svg>`;
  if(k==='ac_pontos')return`<svg width="14" height="14"><polygon points="7,1 13,13 1,13" fill="#EF4444" stroke="white" stroke-width="1.2"/></svg>`;
  if(k==='ble_guaipo')return`<svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#7C3AED" stroke="white" stroke-width="1.5"/></svg>`;
  return`<svg width="10" height="14"><path d="M5 0C2.24 0 0 2.24 0 5C0 8.75 5 14 5 14S10 8.75 10 5C10 2.24 7.76 0 5 0Z" fill="#1A9B6C"/></svg>`;
}
function lcount(k){
  if(k==='lider_areas') return DATA_LIDER.length;
  if(k==='prio_erosao') return DATA_PRIO.length;
  if(k==='subbacias')   return DATA_SUB.length;
  if(k==='hidrografia') return DATA_HIDRO.length;
  if(k==='sond_spt')    return DATA_SPT.length;
  if(k==='sond_ai')     return DATA_AI.length;
  if(k==='areas_prio')  return DATA_AREASPRIO.length;
  if(k==='sec_feito')   return DATA_SECFEITO.length;
  if(k==='sec_pend')    return DATA_SECPEND.length;
  if(k==='ac_criticas') return DATA_AC_PGS.length;
  if(k==='ac_pontos')   return DATA_AC_PTS.length;
  if(k==='ble_guaipo')  return DATA_BLE.length;
  return records.filter(r=>r.lat).length;
}
function toggleLayer(k){
  lvis[k]=!lvis[k];
  const c=document.getElementById('chk_'+k);if(c)c.checked=lvis[k];
  lvis[k]?map.addLayer(lgps[k]):map.removeLayer(lgps[k]);
}

/* ═══════════ STATS & PHASES ═══════════ */
function renderStats(){
  const total=records.length,done=records.filter(r=>r.status==='concluido').length;
  document.getElementById('statsEl').innerHTML=`
    <div class="scard"><div class="v" style="color:var(--amber)">${DATA_LIDER.length}</div><div class="l">Áreas LIDER</div></div>
    <div class="scard"><div class="v" style="color:var(--red)">${DATA_PRIO.length}<span style="font-size:11px;color:var(--text-muted)">/${PRIO_TOTAL}</span></div><div class="l">Erosão (mapeados)</div></div>
    <div class="scard"><div class="v" style="color:#1D4ED8">${DATA_SPT.length+DATA_AI.length}</div><div class="l">Sondagens</div></div>
    <div class="scard"><div class="v" style="color:#059669">${DATA_SECFEITO.length}/${DATA_SECFEITO.length+DATA_SECPEND.length}</div><div class="l">Seções (concl.)</div></div>`;
}
function renderPhases(){
  document.getElementById('phaseEl').innerHTML=PHASES.map(p=>{
    const pr=records.filter(r=>r.fase===p.id),d=pr.filter(r=>r.status==='concluido').length;
    const pct=pr.length?Math.round(d/pr.length*100):0;
    return`<div class="prow"><span class="pname">${p.name}</span><div class="pbar"><div class="pfill" style="width:${pct}%"></div></div><span class="ppct">${pct}%</span></div>`;
  }).join('');
}

/* ═══════════ RECORD LIST ═══════════ */
function renderList(){
  const el=document.getElementById('recList');
  el.innerHTML=records.map(r=>`<div class="reccard" onclick="flyTo('${r.id}')"><div class="rectop"><div class="recdot" style="background:${SCOL[r.status]||'#6B7280'}"></div><span class="recaddr">${esc(r.rua||'Sem endereço')}</span><span class="recphase">${PHLBL[r.fase]||r.fase}</span></div><div class="recmeta">${esc(r.tec||'')}${r.data?' · '+r.data:''}${r.bairro?' · '+esc(r.bairro):''}</div></div>`).join('');
}
function flyTo(id){const r=records.find(x=>x.id===id);if(!r||!r.lat)return;map.flyTo([r.lat,r.lng],16,{duration:.7});setTimeout(()=>r._mkr&&r._mkr.openPopup(),800);}

/* ═══════════ SEARCH ═══════════ */
function onSearchInput(){
  clearTimeout(searchTimer);
  const q=document.getElementById('sinp').value.trim();
  if(q.length<3){document.getElementById('sres').style.display='none';return;}
  searchTimer=setTimeout(doSearch,450);
}
async function doSearch(){
  if(searchBusy)return;
  const q=document.getElementById('sinp').value.trim();if(!q)return;
  searchBusy=true;document.getElementById('sspin').style.display='block';
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q+', Maringá, Paraná, Brasil')}&format=json&limit=5&countrycodes=br`,{headers:{'Accept-Language':'pt-BR'}});
    const d=await r.json();showSRes(d);
  }catch(e){toast('Erro na busca');}
  finally{searchBusy=false;document.getElementById('sspin').style.display='none';}
}
function showSRes(data){
  const el=document.getElementById('sres');
  if(!data.length){el.innerHTML='<div class="sresitem" style="color:var(--text-muted)">Nenhum resultado</div>';el.style.display='block';return;}
  el.innerHTML=data.map(r=>`<div class="sresitem" onclick="goToRes(${r.lat},${r.lon},'${esc(r.display_name.split(',')[0])}')">${esc(r.display_name.split(',').slice(0,3).join(', '))}</div>`).join('');
  el.style.display='block';
}
function goToRes(lat,lng,name){map.setView([lat,lng],16);document.getElementById('sres').style.display='none';document.getElementById('sinp').value=name;}
document.addEventListener('click',e=>{if(!e.target.closest('.sbox'))document.getElementById('sres').style.display='none';});

/* ═══════════ MODE ═══════════ */
function setMode(m){
  mode=m;
  document.getElementById('mbview').classList.toggle('on',m==='view');
  document.getElementById('mbpin').classList.toggle('on',m==='pin');
  map.getContainer().style.cursor=m==='pin'?'crosshair':'';
}

/* ═══════════ RECORD FORM ═══════════ */
function openForm(arg){
  let rec=null;
  if(typeof arg==='string')rec=records.find(r=>r.id===arg);
  else if(arg&&arg.lat)rec=arg;
  document.getElementById('formTitle').textContent=rec&&rec.id?'Editar registro':'Novo registro';
  document.getElementById('fId').value=rec&&rec.id?rec.id:'';
  document.getElementById('fLat').value=rec?rec.lat||'':'';
  document.getElementById('fLng').value=rec?rec.lng||'':'';
  document.getElementById('fRua').value=rec?rec.rua||'':'';
  document.getElementById('fBairro').value=rec?rec.bairro||'':'';
  document.getElementById('fFase').value=rec?rec.fase||'diagnostico':'diagnostico';
  document.getElementById('fStatus').value=rec?rec.status||'nao_iniciado':'nao_iniciado';
  document.getElementById('fAtiv').value=rec?rec.ativ||'':'';
  document.getElementById('fTec').value=rec?rec.tec||'':'';
  document.getElementById('fData').value=rec?rec.data||today():today();
  document.getElementById('fObs').value=rec?rec.obs||'':'';
  renderPStrip(rec?rec.fotos||[]:[]);
  document.getElementById('delBtn').style.display=rec&&rec.id?'block':'none';
  document.getElementById('formOverlay').classList.add('open');
  setMode('view');
}
function closeForm(){document.getElementById('formOverlay').classList.remove('open');}
function today(){return new Date().toISOString().split('T')[0];}

function saveRec(){
  const id=document.getElementById('fId').value||('r'+Date.now());
  const lat=parseFloat(document.getElementById('fLat').value);
  const lng=parseFloat(document.getElementById('fLng').value);
  const rec={id,lat:isNaN(lat)?null:lat,lng:isNaN(lng)?null:lng,
    rua:document.getElementById('fRua').value.trim(),
    bairro:document.getElementById('fBairro').value.trim(),
    fase:document.getElementById('fFase').value,
    status:document.getElementById('fStatus').value,
    ativ:document.getElementById('fAtiv').value.trim(),
    tec:document.getElementById('fTec').value.trim(),
    data:document.getElementById('fData').value,
    obs:document.getElementById('fObs').value.trim(),
    fotos:currentPhotos};
  const idx=records.findIndex(r=>r.id===id);
  if(idx>=0){if(records[idx]._mkr)lgps['campo'].removeLayer(records[idx]._mkr);records[idx]=rec;}
  else records.push(rec);
  if(rec.lat&&rec.lng)addPinMkr(rec);
  saveRecs();renderStats();renderPhases();renderLayers();renderList();
  closeForm();toast('Registro salvo ✓');
}
function deleteRec(){
  const id=document.getElementById('fId').value;if(!id)return;
  if(!confirm('Excluir este registro?'))return;
  const idx=records.findIndex(r=>r.id===id);
  if(idx>=0){if(records[idx]._mkr)lgps['campo'].removeLayer(records[idx]._mkr);records.splice(idx,1);}
  saveRecs();renderStats();renderPhases();renderLayers();renderList();closeForm();toast('Excluído');
}

/* photos */
function renderPStrip(fotos){
  currentPhotos=[...fotos];
  const el=document.getElementById('pstrip');
  el.innerHTML=currentPhotos.map((f,i)=>`<img class="pthumb" src="${f}" title="Clique para remover" onclick="rmPhoto(${i})">`).join('')
    +(currentPhotos.length<5?`<div class="padd" onclick="document.getElementById('photoInp').click()">+</div>`:'');
}
function addPhotos(inp){
  Array.from(inp.files).slice(0,5-currentPhotos.length).forEach(f=>{
    const rd=new FileReader();rd.onload=e=>{currentPhotos.push(e.target.result);renderPStrip(currentPhotos);};rd.readAsDataURL(f);
  });inp.value='';
}
function rmPhoto(i){currentPhotos.splice(i,1);renderPStrip(currentPhotos);}

/* ═══════════ IMPORT ═══════════ */
function openImport(){document.getElementById('importOverlay').classList.add('open');}
function closeImport(){document.getElementById('importOverlay').classList.remove('open');document.getElementById('iresult').innerHTML='';document.getElementById('ilayerrow').style.display='none';document.getElementById('iconfirm').style.display='none';pendingImport=null;}
function handleDrop(e){e.preventDefault();document.getElementById('izone').classList.remove('drag');const f=e.dataTransfer.files[0];if(f)procFile(f);}
function handleIFile(inp){const f=inp.files[0];if(f)procFile(f);inp.value='';}
function procFile(file){
  const ext=file.name.split('.').pop().toLowerCase();
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      if(ext==='csv'){const rows=parseCSV(e.target.result);pendingImport={type:'csv',rows};document.getElementById('iresult').innerHTML=`<span style="color:var(--green)">✓ ${rows.length} linhas encontradas.</span>`;}
      else if(ext==='geojson'||ext==='json'){const gj=JSON.parse(e.target.result);pendingImport={type:'geojson',gj};document.getElementById('iresult').innerHTML=`<span style="color:var(--green)">✓ GeoJSON com ${gj.features?.length||0} feições.</span>`;}
      else{document.getElementById('iresult').innerHTML='<span style="color:var(--red)">Formato não suportado.</span>';return;}
      document.getElementById('ilayerrow').style.display='block';document.getElementById('iconfirm').style.display='inline-flex';
    }catch(err){document.getElementById('iresult').innerHTML=`<span style="color:var(--red)">Erro: ${err.message}</span>`;}
  };rd.readAsText(file);
}
function parseCSV(text){
  const lines=text.trim().split('\n');if(!lines.length)return[];
  const hdrs=lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/"/g,''));
  return lines.slice(1).map(line=>{const vals=line.split(',').map(v=>v.trim().replace(/"/g,''));const o={};hdrs.forEach((h,i)=>o[h]=vals[i]||'');return o;}).filter(r=>r.lat&&r.lng);
}
function confirmImport(){
  if(!pendingImport)return;const tgt=document.getElementById('ilayer').value;let cnt=0;
  const rows=pendingImport.type==='csv'?pendingImport.rows:(pendingImport.gj.features||[]).map(f=>{
    if(!f.geometry||f.geometry.type!=='Point')return null;
    const[lng,lat]=f.geometry.coordinates;return{lat:lat+'',lng:lng+'',name:(f.properties?.name||f.properties?.nome||'')}; 
  }).filter(Boolean);
  rows.forEach(row=>{
    const lat=parseFloat(row.lat||row.latitude),lng=parseFloat(row.lng||row.longitude||row.lon);if(isNaN(lat)||isNaN(lng))return;
    const name=row.name||row.nome||'Importado';
    if(tgt==='campo'){const r={id:'i'+Date.now()+Math.random(),lat,lng,rua:name,bairro:'',fase:'diagnostico',ativ:'Importado',status:'nao_iniciado',tec:'',data:today(),obs:'',fotos:[]};records.push(r);addPinMkr(r);}
    else{L.marker([lat,lng],{icon:mkPrioIcon()}).bindPopup(`<b>${esc(name)}</b>`).addTo(lgps[tgt]);}
    cnt++;
  });
  saveRecs();renderStats();renderPhases();renderLayers();renderList();toast(`${cnt} item(ns) importado(s) ✓`);closeImport();
}

/* ═══════════ EXPORT ═══════════ */
function exportCSV(){
  const rows=[['id','lat','lng','rua','bairro','fase','status','atividade','tecnico','data','obs'],...records.map(r=>[r.id,r.lat,r.lng,r.rua,r.bairro,r.fase,r.status,r.ativ,r.tec,r.data,r.obs])];
  const csv=rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  navigator.clipboard.writeText(csv).then(()=>toast('CSV copiado para a área de transferência ✓')).catch(()=>toast('Erro ao copiar CSV'));
}

/* ═══════════ LEGEND / THEME ═══════════ */
function toggleLegend(){legendCollapsed=!legendCollapsed;document.getElementById('flegbody').style.display=legendCollapsed?'none':'';document.getElementById('flegtoggle').textContent=legendCollapsed?'▼':'▲';}
function toggleTheme(){const h=document.documentElement;h.setAttribute('data-theme',h.getAttribute('data-theme')==='dark'?'light':'dark');}

/* ═══════════ UTILS ═══════════ */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
let toastTm;
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTm);toastTm=setTimeout(()=>el.classList.remove('show'),3000);}

document.addEventListener('DOMContentLoaded',init);
