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
  areas_contrib:{label:'Áreas de contribuição (micro)', color:'#2E8B57', type:'polygon'},
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
  areas_contrib: 'data/areas_contribuicao.geojson',
};

let DATA_LIDER=[], DATA_PRIO=[], DATA_SPT=[], DATA_AI=[], DATA_AREASPRIO=[],
    DATA_AC_PGS=[], DATA_AC_PTS=[], DATA_BLE=[], DATA_SECFEITO=[], DATA_SECPEND=[],
    DATA_SUB=[], DATA_HIDRO=[], DATA_AREASCONTRIB=[];

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
  DATA_AREASCONTRIB = d.areas_contrib || [];
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
  let info=null;
  try{info=await Store.init();}
  catch(e){console.error('Armazenamento indisponível',e);}
  renderModo(info);

  // modo banco de dados: precisa entrar antes de ver qualquer dado
  if(info&&Store.temLogin){
    usuario=info.usuario||await pedirLogin();
    if(usuario.trocarSenha)usuario=await pedirSenha(true);
    renderUsuario();
  }

  await loadData();
  try{records=(await Store.listarRegistros()).map(featureToRec);}
  catch(e){console.error(e);toast('Não foi possível carregar os registros de campo: '+(e.message||e));}
  initMap();renderStats();renderPhases();renderLayers();renderList();

  if(info&&info.falhaApi)toast('API não respondeu — salvando só neste navegador.');
  else if(info&&info.migrados)toast(`${info.migrados} registro(s) antigo(s) convertido(s) para o novo formato ✓`);
  else if(!info)toast('Não foi possível abrir o armazenamento. Os registros não serão salvos.');
}

/* ═══════════ LOGIN ═══════════ */
let usuario=null, loginResolver=null, senhaResolver=null;

function pedirLogin(){
  if(loginResolver)return loginResolver.promise;
  let resolve;const promise=new Promise(r=>resolve=r);
  loginResolver={promise,resolve};
  document.getElementById('lErro').textContent='';
  document.getElementById('lSenha').value='';
  document.getElementById('loginOverlay').classList.add('open');
  setTimeout(()=>{const e=document.getElementById('lEmail');(e.value?document.getElementById('lSenha'):e).focus();},50);
  return promise;
}
async function doLogin(){
  const email=document.getElementById('lEmail').value.trim(),senha=document.getElementById('lSenha').value;
  const btn=document.getElementById('lBtn'),erro=document.getElementById('lErro');
  btn.disabled=true;erro.textContent='';
  try{
    const u=await Store.login(email,senha);
    document.getElementById('lSenha').value='';
    document.getElementById('loginOverlay').classList.remove('open');
    const r=loginResolver;loginResolver=null;r&&r.resolve(u);
  }catch(e){
    erro.textContent=e.status===401?'E-mail ou senha incorretos.':(e.message||'Não foi possível entrar.');
  }finally{btn.disabled=false;}
}
async function doLogout(){
  try{await Store.logout();}catch(e){}
  location.reload();
}

function pedirSenha(obrigatoria){
  if(senhaResolver)return senhaResolver.promise;
  let resolve;const promise=new Promise(r=>resolve=r);
  senhaResolver={promise,resolve};
  ['sAtual','sNova','sConf'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('sUser').value=usuario?usuario.email:'';
  document.getElementById('sErro').textContent='';
  document.getElementById('sAviso').style.display=obrigatoria?'block':'none';
  document.getElementById('sFechar').style.display=obrigatoria?'none':'';
  document.getElementById('sTitulo').textContent=obrigatoria?'Crie sua senha':'Trocar senha';
  document.getElementById('senhaOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('sAtual').focus(),50);
  return promise;
}
function openSenha(){pedirSenha(false).then(u=>{if(u){usuario=u;renderUsuario();toast('Senha alterada ✓');}});}
function closeSenha(){
  document.getElementById('senhaOverlay').classList.remove('open');
  const r=senhaResolver;senhaResolver=null;r&&r.resolve(null);
}
async function doTrocarSenha(){
  const atual=document.getElementById('sAtual').value,nova=document.getElementById('sNova').value,conf=document.getElementById('sConf').value;
  const erro=document.getElementById('sErro'),btn=document.getElementById('sBtn');
  erro.textContent='';
  if(nova!==conf){erro.textContent='As duas senhas novas não são iguais.';return;}
  if(nova.length<10){erro.textContent='A nova senha precisa ter pelo menos 10 caracteres.';return;}
  btn.disabled=true;
  try{
    const u=await Store.trocarSenha(atual,nova);
    document.getElementById('senhaOverlay').classList.remove('open');
    const r=senhaResolver;senhaResolver=null;r&&r.resolve(u);
  }catch(e){erro.textContent=e.message?e.message.charAt(0).toUpperCase()+e.message.slice(1)+'.':'Não foi possível trocar a senha.';}
  finally{btn.disabled=false;}
}
function renderUsuario(){
  const el=document.getElementById('userEl');if(!el)return;
  if(!usuario){el.style.display='none';return;}
  document.getElementById('adminBtn').style.display=usuario.papel==='admin'?'':'none';
  document.getElementById('userBtn').textContent='👤 '+usuario.nome.split(' ')[0];
  document.getElementById('userBtn').title=usuario.nome+' ('+usuario.email+') — clique para trocar a senha';
  el.style.display='inline-flex';
}
/* ═══════════ USUÁRIOS (só administradores) ═══════════ */
let listaUsuarios=[];
function openUsuarios(){
  esconderSenhaProv();
  document.getElementById('uErro').textContent='';
  document.getElementById('usuariosOverlay').classList.add('open');
  carregarUsuarios();
}
function closeUsuarios(){
  esconderSenhaProv();   // a senha provisória não fica na tela depois de fechar
  document.getElementById('usuariosOverlay').classList.remove('open');
}
async function carregarUsuarios(){
  try{listaUsuarios=(await Store.admin.listar()).usuarios;renderUsuarios();}
  catch(e){erroUsuarios(e);}
}
function erroUsuarios(e){
  if(e&&(e.status===401))return; // a tela de login já aparece
  const msg=e&&e.message?e.message:'falha na operação';
  document.getElementById('uErro').textContent=msg.charAt(0).toUpperCase()+msg.slice(1)+'.';
}
function fmtData(iso){return iso?new Date(iso).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';}
function renderUsuarios(){
  const corpo=document.getElementById('uLista');
  if(!listaUsuarios.length){corpo.innerHTML='<tr><td colspan="5" style="padding:10px 4px;color:var(--text-muted)">Nenhum usuário.</td></tr>';return;}
  const bt='class="btn btn-o" type="button" style="padding:3px 8px;font-size:11px;margin:2px"';
  corpo.innerHTML=listaUsuarios.map(u=>{
    const eu=usuario&&u.id===usuario.id;
    const sit=!u.ativo?['Desativado','var(--red)']:(u.trocarSenha?['Aguardando 1º acesso','var(--amber)']:['Ativo','var(--green)']);
    const acoes=eu?'<span style="font-size:11px;color:var(--text-muted)">(você)</span>':[
      `<button ${bt} onclick="redefinirUsuario('${u.id}')">Redefinir senha</button>`,
      `<button ${bt} onclick="alternarPapel('${u.id}')">${u.papel==='admin'?'Tornar usuário':'Tornar admin'}</button>`,
      `<button class="btn btn-o" type="button" style="padding:3px 8px;font-size:11px;margin:2px${u.ativo?';color:var(--red)':''}" onclick="alternarAtivo('${u.id}')">${u.ativo?'Desativar':'Reativar'}</button>`
    ].join('');
    return `<tr style="border-top:1px solid var(--border)${u.ativo?'':';opacity:.6'}">
      <td style="padding:8px 4px"><b>${esc(u.nome)}</b><br><span style="font-size:11px;color:var(--text-muted)">${esc(u.email)}</span></td>
      <td style="padding:8px 4px">${u.papel==='admin'?'Administrador':'Usuário'}</td>
      <td style="padding:8px 4px;color:${sit[1]};white-space:nowrap">${sit[0]}</td>
      <td style="padding:8px 4px;white-space:nowrap">${fmtData(u.ultimoAcesso)}</td>
      <td style="padding:6px 4px;text-align:right">${acoes}</td></tr>`;
  }).join('');
}
async function criarUsuario(){
  const nome=document.getElementById('uNome').value.trim(),email=document.getElementById('uEmail').value.trim(),papel=document.getElementById('uPapel').value;
  const btn=document.getElementById('uCriarBtn');
  document.getElementById('uErro').textContent='';esconderSenhaProv();
  if(papel==='admin'&&!confirm(`${nome} terá acesso total, inclusive a esta tela de usuários. Confirmar como administrador?`))return;
  btn.disabled=true;
  try{
    const r=await Store.admin.criar({nome,email,papel});
    document.getElementById('uForm').reset();
    mostrarSenhaProv(`Usuário <b>${esc(r.usuario.nome)}</b> cadastrado. Senha provisória para <b>${esc(r.usuario.email)}</b>:`,r.senhaProvisoria);
    await carregarUsuarios();
  }catch(e){erroUsuarios(e);}
  finally{btn.disabled=false;}
}
async function redefinirUsuario(id){
  const u=listaUsuarios.find(x=>x.id===id);if(!u)return;
  if(!confirm(`Gerar uma nova senha provisória para ${u.nome}?\n\nA senha atual deixa de funcionar e a pessoa é desconectada.`))return;
  document.getElementById('uErro').textContent='';esconderSenhaProv();
  try{
    const r=await Store.admin.redefinir(id);
    mostrarSenhaProv(`Nova senha provisória de <b>${esc(r.usuario.nome)}</b> (${esc(r.usuario.email)}):`,r.senhaProvisoria);
    await carregarUsuarios();
  }catch(e){erroUsuarios(e);}
}
async function alternarAtivo(id){
  const u=listaUsuarios.find(x=>x.id===id);if(!u)return;
  if(u.ativo&&!confirm(`Desativar ${u.nome}?\n\nA pessoa é desconectada e não consegue mais entrar. Os registros dela continuam no sistema.`))return;
  document.getElementById('uErro').textContent='';
  try{await Store.admin.atualizar(id,{ativo:!u.ativo});await carregarUsuarios();toast(u.ativo?`${u.nome} desativado`:`${u.nome} reativado ✓`);}
  catch(e){erroUsuarios(e);}
}
async function alternarPapel(id){
  const u=listaUsuarios.find(x=>x.id===id);if(!u)return;
  const novo=u.papel==='admin'?'usuario':'admin';
  if(!confirm(novo==='admin'?`Tornar ${u.nome} administrador?\n\nTerá acesso a esta tela e poderá gerenciar todos os usuários.`:`Retirar o acesso de administrador de ${u.nome}?`))return;
  document.getElementById('uErro').textContent='';
  try{await Store.admin.atualizar(id,{papel:novo});await carregarUsuarios();}
  catch(e){erroUsuarios(e);}
}
function mostrarSenhaProv(textoHtml,senha){
  document.getElementById('uSenhaTxt').innerHTML=textoHtml;
  document.getElementById('uSenha').textContent=senha;
  document.getElementById('uSenhaBox').style.display='block';
}
function esconderSenhaProv(){
  document.getElementById('uSenha').textContent='';
  document.getElementById('uSenhaBox').style.display='none';
}
async function copiarSenhaProv(){
  const s=document.getElementById('uSenha').textContent;
  try{await navigator.clipboard.writeText(s);toast('Senha copiada ✓');}
  catch(e){toast('Não foi possível copiar; selecione e copie manualmente.');}
}

// a sessão venceu no meio do uso → volta ao login sem perder o que está na tela
window.addEventListener('campo:precisa-login',()=>{
  if(loginResolver)return;
  toast('Sua sessão expirou. Entre de novo e repita a última ação.');
  pedirLogin().then(async u=>{usuario=u;if(u.trocarSenha)usuario=await pedirSenha(true);renderUsuario();});
});
window.addEventListener('campo:precisa-trocar-senha',()=>{pedirSenha(true).then(u=>{if(u){usuario=u;renderUsuario();}});});

/* Indicador no cabeçalho: onde os registros estão sendo salvos */
function renderModo(info){
  const el=document.getElementById('modoEl');if(!el)return;
  let txt,cor,dica;
  if(info&&info.modo==='api'){
    txt='● Banco de dados';cor='#1A9B6C';dica='Registros salvos no banco de dados, compartilhados com a equipe';
    const n=document.getElementById('noteEl');
    if(n)n.innerHTML='<strong>● Conectado ao banco de dados</strong>Os registros ficam salvos no servidor e a equipe toda vê as mesmas informações.';
  }
  else if(info&&info.modo==='navegador'){
    txt=info.falhaApi?'● Navegador (API offline)':'● Navegador';cor=info.falhaApi?'#C87F00':'#6B7280';
    dica='Registros salvos só neste navegador'+(info.falhaApi?' — a API em '+info.apiUrl+' não respondeu':'');
  }else{txt='● Sem armazenamento';cor='#DC2626';dica='Os registros não estão sendo salvos';}
  el.textContent=txt;el.title=dica;el.style.color=cor;el.style.border='1px solid '+cor;
}

/* Conversão entre o formato salvo (GeoJSON Feature, ver store.js)
   e o formato "achatado" que o mapa e a lista usam internamente. */
function featureToRec(f){
  const p=f.properties||{},c=f.geometry&&f.geometry.coordinates;
  return{id:f.id,lat:c?c[1]:null,lng:c?c[0]:null,rua:p.rua||'',bairro:p.bairro||'',
    fase:p.fase||'diagnostico',status:p.status||'nao_iniciado',ativ:p.atividade||'',tec:p.tecnico||'',
    data:p.data||'',obs:p.obs||'',fotos:p.fotos||[],criadoEm:p.criadoEm,atualizadoEm:p.atualizadoEm,
    por:(p.atualizadoPor||p.criadoPor||{}).nome||''};
}

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

  addLider(); addPrio(); addSubbacias(); addAreasPrio(); addAcCriticas(); addAreasContrib(); addAcPontos(); addBleGuaipo(); addHidro();
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
/* popup das seções topográficas (feitas e pendentes) */
function corDrenagem(d){
  if(/ok$/i.test(d))return'#059669';           // Tubular/Ponte/Celular/BLE OK
  if(/assoread/i.test(d))return'#C87F00';
  return'#6B7280';                             // Pendente, Não existente…
}
function popupSecao(p,feito){
  const linha=(txt,estilo)=>`<br><span style="font-size:11px;${estilo||'color:#555'}">${txt}</span>`;
  let h=`<b>${esc(p.name)}</b>`;
  if(p.cod)h+=linha(esc(p.cod));
  if(p.bacia||p.micro)h+=linha(esc(p.bacia)+(p.bacia&&p.micro?' — ':'')+esc(p.micro));
  h+=feito?linha('✓ Topografia Concluída','color:#059669;font-weight:600'):linha('⏳ Topografia Pendente','color:#DC2626;font-weight:600');
  if(p.drenagem)h+=linha(`Drenagem: <b style="color:${corDrenagem(p.drenagem)}">${esc(p.drenagem)}</b>`);
  if(typeof p.subida==='boolean')h+=linha(`Subida: <b>${p.subida?'sim':'não'}</b>`);
  return h;
}
function addSecFeito(){
  DATA_SECFEITO.forEach(p=>{
    L.marker([p.lat,p.lng],{icon:mkSecFeitoIcon()}).bindPopup(popupSecao(p,true)).addTo(lgps['sec_feito']);
  });
}
function addSecPend(){
  DATA_SECPEND.forEach(p=>{
    L.marker([p.lat,p.lng],{icon:mkSecPendIcon()}).bindPopup(popupSecao(p,false)).addTo(lgps['sec_pend']);
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
      ${r.por?`<div style="font-size:11px;color:#9CA3AF;margin-top:4px">Atualizado por ${esc(r.por)}${r.atualizadoEm?' em '+new Date(r.atualizadoEm).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):''}</div>`:''}
      <button onclick="openForm('${r.id}')" style="margin-top:8px;width:100%;padding:5px;background:#1A9B6C;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">Editar</button>
    </div>`)
    .addTo(lgps['campo']);
  r._mkr=m;
}

/* ═══════════ ÁREAS DE CONTRIBUIÇÃO (micro) ═══════════
   Polígonos coloridos pelo status, com filtro por status no menu lateral.
   Dados: data/areas_contribuicao.geojson (id, status, bacia, area_ha).        */
const AC_STATUS={
  'Aprovado':    {cor:'#2E8B57',fill:.45,um:'aprovada',    varios:'aprovadas'},
  'Realizada':   {cor:'#1F6FB5',fill:.5, um:'realizada',   varios:'realizadas'},
  'Não aprovado':{cor:'#9CA3AF',fill:.3, um:'não aprovada',varios:'não aprovadas'},
};
const acOcultos=new Set();   // status desmarcados no filtro
let acItens=[];              // [{p, layer}]
const fmtHa=n=>n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});

function addAreasContrib(){
  acItens=DATA_AREASCONTRIB.map(p=>{
    const st=AC_STATUS[p.status]||AC_STATUS['Não aprovado'];
    const layer=L.polygon(p.coords,{color:st.cor,weight:1.4,fillColor:st.cor,fillOpacity:st.fill})
      .bindPopup(`<b style="font-size:13px">Área de contribuição nº ${esc(p.id)}</b>`+
        `<br><span style="font-size:11px;font-weight:600;color:${st.cor}">${esc(p.status)}</span>`+
        `<br><span style="font-size:12px;color:#555">${p.bacia?esc(p.bacia):'Bacia não informada'}</span>`+
        `<br><span style="font-size:12px;color:#555">${fmtHa(+p.area_ha||0)} ha</span>`)
      .bindTooltip(String(p.id),{permanent:true,direction:'center',className:'ac-lbl'});
    layer.addTo(lgps['areas_contrib']);
    return {p,layer};
  });
  // números sobre os polígonos só com o mapa aproximado (evita poluir a visão geral)
  const rotulos=()=>map.getContainer().classList.toggle('sem-rotulos',map.getZoom()<14);
  map.on('zoomend',rotulos);rotulos();
  renderAreasContrib();
}
function acVisivel(it){return !acOcultos.has(it.p.status);}
function acAplicarFiltro(){
  acItens.forEach(it=>{
    const g=lgps['areas_contrib'];
    if(acVisivel(it)){if(!g.hasLayer(it.layer))g.addLayer(it.layer);}
    else if(g.hasLayer(it.layer))g.removeLayer(it.layer);
  });
  renderAreasContrib();
}
function acToggleStatus(s){acOcultos.has(s)?acOcultos.delete(s):acOcultos.add(s);acAplicarFiltro();}
function acLimpar(){acOcultos.clear();acAplicarFiltro();}
function acEnquadrar(){
  const vis=acItens.filter(acVisivel);if(!vis.length)return;
  if(!lvis['areas_contrib'])toggleLayer('areas_contrib');
  map.flyToBounds(L.featureGroup(vis.map(it=>it.layer)).getBounds(),{padding:[40,40],duration:.7});
}
function renderAreasContrib(){
  const el=document.getElementById('areasContribEl');if(!el)return;
  const total=acItens.length,vis=acItens.filter(acVisivel);
  const ha=vis.reduce((t,it)=>t+(+it.p.area_ha||0),0);
  const por={};Object.keys(AC_STATUS).forEach(s=>por[s]={n:0,ha:0});
  acItens.forEach(it=>{const q=por[it.p.status];if(q){q.n++;q.ha+=(+it.p.area_ha||0);}});
  const det=Object.keys(AC_STATUS).map(s=>[s,vis.filter(it=>it.p.status===s).length]).filter(x=>x[1])
    .map(([s,n])=>`<span><i class="mini" style="background:${AC_STATUS[s].cor}"></i>${n} ${n===1?AC_STATUS[s].um:AC_STATUS[s].varios}</span>`).join('');
  const ligada=lvis['areas_contrib']!==false;
  el.innerHTML=`<div class="fcard">
    <div class="layer-row" onclick="toggleLayer('areas_contrib')">
      <input type="checkbox" id="chk_areas_contrib"${ligada?' checked':''} onclick="event.stopPropagation()" onchange="toggleLayer('areas_contrib')">
      <span class="llabel fcard-tit">${LDEFS.areas_contrib.label}</span>
      <span class="lcount">${vis.length===total?total:vis.length+'/'+total}</span>
    </div>
    <div class="flab">Status</div>
    ${Object.keys(AC_STATUS).map(s=>{const off=acOcultos.has(s),c=AC_STATUS[s].cor;
      return `<label class="fopt${off?' off':''}"><input type="checkbox"${off?'':' checked'} onchange="acToggleStatus('${s}')">
        <span class="sw" style="background:${c}${s==='Não aprovado'?'55':'aa'};border-color:${c}"></span>
        <span>${s}</span><span class="n">${por[s].n}</span><span class="ha">${fmtHa(por[s].ha)} ha</span></label>`;}).join('')}
    <div class="fsum">
      <div class="t"><b>${vis.length}</b> de ${total} áreas &nbsp;·&nbsp; <b>${fmtHa(ha)} ha</b></div>
      ${det?`<div class="det">${det}</div>`:''}
      <div class="bt"><button class="fbtn p" onclick="acEnquadrar()"${vis.length&&ligada?'':' disabled'}>Enquadrar no mapa</button>
        <button class="fbtn" onclick="acLimpar()"${acOcultos.size?'':' disabled'}>Limpar filtro</button></div>
    </div></div>`;
  // legenda flutuante
  Object.keys(AC_STATUS).forEach(s=>{const e=document.getElementById('legAc_'+s.replace(/\W/g,''));if(e)e.textContent=por[s].n;});
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
  renderTodas();
}
function buildLRows(keys){
  return keys.map(k=>{
    const d=LDEFS[k],sw=buildSw(k,d),cnt=lcount(k);
    return `<div class="layer-row" onclick="toggleLayer('${k}')">
      <input type="checkbox" id="chk_${k}"${lvis[k]!==false?' checked':''} onclick="event.stopPropagation()" onchange="toggleLayer('${k}')">
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
  if(k==='areas_contrib') return DATA_AREASCONTRIB.length;
  return records.filter(r=>r.lat).length;
}
function toggleLayer(k){
  lvis[k]=!lvis[k];
  const c=document.getElementById('chk_'+k);if(c)c.checked=lvis[k];
  lvis[k]?map.addLayer(lgps[k]):map.removeLayer(lgps[k]);
  if(k==='areas_contrib')renderAreasContrib();
  renderTodas();
}
/* liga/desliga uma camada para um estado definido (sem inverter) */
function setLayer(k,v){if(!!lvis[k]!==!!v)toggleLayer(k);}
/* "Mostrar todas as camadas": desmarcar limpa o mapa de uma vez */
function setTodas(v){Object.keys(LDEFS).forEach(k=>setLayer(k,v));renderTodas();}
function renderTodas(){
  const chk=document.getElementById('chkTodas');if(!chk)return;
  const keys=Object.keys(LDEFS),on=keys.filter(k=>lvis[k]).length;
  chk.checked=on===keys.length;
  chk.indeterminate=on>0&&on<keys.length;   // traço: algumas ligadas
  const c=document.getElementById('todasCount');if(c)c.textContent=on+'/'+keys.length;
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
    const dica=pr.length
      ? `${p.name}: ${d} de ${pr.length} registro(s) concluído(s)`
      : `${p.name}: nenhum registro ainda`;
    return`<div class="prow" title="${esc(dica)}"><span class="pname">${esc(p.name)}</span><span class="ppct">${pct}%</span><div class="pbar"><div class="pfill" style="width:${pct}%"></div></div></div>`;
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
async function openForm(arg){
  let rec=null;
  if(typeof arg==='string')rec=records.find(r=>r.id===arg);
  else if(arg&&arg.lat)rec=arg;
  document.getElementById('formTitle').textContent=rec&&rec.id?'Editar registro':'Novo registro';
  document.getElementById('fId').value=rec&&rec.id?rec.id:'';
  document.getElementById('fLat').value=rec&&rec.lat!=null?rec.lat:'';
  document.getElementById('fLng').value=rec&&rec.lng!=null?rec.lng:'';
  document.getElementById('fRua').value=rec?rec.rua||'':'';
  document.getElementById('fBairro').value=rec?rec.bairro||'':'';
  document.getElementById('fFase').value=rec?rec.fase||'diagnostico':'diagnostico';
  document.getElementById('fStatus').value=rec?rec.status||'nao_iniciado':'nao_iniciado';
  document.getElementById('fAtiv').value=rec?rec.ativ||'':'';
  document.getElementById('fTec').value=rec?rec.tec||'':'';
  document.getElementById('fData').value=rec?rec.data||today():today();
  document.getElementById('fObs').value=rec?rec.obs||'':'';
  document.getElementById('delBtn').style.display=rec&&rec.id?'block':'none';
  setMode('view');
  // fotos já salvas: carrega do armazenamento local
  clearPhotos();
  for(const fid of (rec&&rec.fotos)||[]){
    try{const b=await Store.lerFoto(fid);if(b)currentPhotos.push({id:fid,blob:b,url:URL.createObjectURL(b)});}catch(e){}
  }
  renderPStrip();
  document.getElementById('formOverlay').classList.add('open');
}
function closeForm(){document.getElementById('formOverlay').classList.remove('open');clearPhotos();}
function today(){const d=new Date();return new Date(d-d.getTimezoneOffset()*60000).toISOString().split('T')[0];}

async function saveRec(){
  const id=document.getElementById('fId').value||null;
  const latS=document.getElementById('fLat').value.trim(),lngS=document.getElementById('fLng').value.trim();
  const lat=parseFloat(latS),lng=parseFloat(lngS);
  // validação das coordenadas
  if((latS&&!lngS)||(!latS&&lngS)){toast('Preencha latitude e longitude, ou deixe as duas em branco.');return;}
  if(latS&&(isNaN(lat)||isNaN(lng)||lat<-90||lat>90||lng<-180||lng>180)){toast('Coordenadas inválidas.');return;}
  if(latS&&(lat<-23.7||lat>-23.1||lng<-52.3||lng>-51.6)&&!confirm('Este ponto está fora da região de Maringá. Salvar mesmo assim?'))return;

  const anterior=id?records.find(r=>r.id===id):null;
  try{
    // grava as fotos novas (as removidas só são apagadas depois que o registro for salvo)
    const fotoIds=[];
    for(const f of currentPhotos){f.id=f.id||await Store.salvarFoto(f.blob);fotoIds.push(f.id);}

    const feature=await Store.salvarRegistro({
      id,
      geometry:latS?{type:'Point',coordinates:[lng,lat]}:null,
      properties:{
        rua:document.getElementById('fRua').value.trim(),
        bairro:document.getElementById('fBairro').value.trim(),
        fase:document.getElementById('fFase').value,
        status:document.getElementById('fStatus').value,
        atividade:document.getElementById('fAtiv').value.trim(),
        tecnico:document.getElementById('fTec').value.trim(),
        data:document.getElementById('fData').value,
        obs:document.getElementById('fObs').value.trim(),
        fotos:fotoIds
      }
    });
    for(const fid of (anterior&&anterior.fotos)||[]){
      if(!fotoIds.includes(fid))Store.apagarFoto(fid).catch(e=>console.warn('Foto não apagada',fid,e));
    }
    const rec=featureToRec(feature);
    const idx=records.findIndex(r=>r.id===rec.id);
    if(idx>=0){if(records[idx]._mkr)lgps['campo'].removeLayer(records[idx]._mkr);records[idx]=rec;}
    else records.push(rec);
    if(rec.lat!=null&&rec.lng!=null)addPinMkr(rec);
    renderStats();renderPhases();renderLayers();renderList();
    closeForm();toast('Registro salvo ✓');
  }catch(e){
    console.error(e);
    if(e&&(e.status===401||e.status===403))return; // a tela de login/troca de senha já explica
    toast('Erro ao salvar: '+(e&&e.name==='QuotaExceededError'?'sem espaço no navegador.':(e.message||e)));
  }
}
async function deleteRec(){
  const id=document.getElementById('fId').value;if(!id)return;
  if(!confirm('Excluir este registro?'))return;
  try{await Store.excluirRegistro(id);}catch(e){console.error(e);if(e.status!==401&&e.status!==403)toast('Erro ao excluir');return;}
  const idx=records.findIndex(r=>r.id===id);
  if(idx>=0){if(records[idx]._mkr)lgps['campo'].removeLayer(records[idx]._mkr);records.splice(idx,1);}
  renderStats();renderPhases();renderLayers();renderList();closeForm();toast('Excluído');
}

/* photos — ficam no IndexedDB (ver store.js), reduzidas para no máx. 1600 px */
function clearPhotos(){currentPhotos.forEach(f=>f.url&&URL.revokeObjectURL(f.url));currentPhotos=[];}
function renderPStrip(){
  const el=document.getElementById('pstrip');
  el.innerHTML=currentPhotos.map((f,i)=>`<img class="pthumb" src="${f.url}" title="Clique para remover" onclick="rmPhoto(${i})">`).join('')
    +(currentPhotos.length<5?`<div class="padd" onclick="document.getElementById('photoInp').click()">+</div>`:'');
}
async function addPhotos(inp){
  const files=Array.from(inp.files).slice(0,5-currentPhotos.length);inp.value='';
  for(const f of files){
    const blob=await shrinkImage(f);
    currentPhotos.push({id:null,blob,url:URL.createObjectURL(blob)});
  }
  renderPStrip();
}
function rmPhoto(i){const f=currentPhotos.splice(i,1)[0];if(f&&f.url)URL.revokeObjectURL(f.url);renderPStrip();}
function shrinkImage(file,max=1600,quality=0.82){
  return new Promise(ok=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const k=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>ok(b&&b.size<file.size?b:file),'image/jpeg',quality);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);ok(file);};
    img.src=url;
  });
}

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
  // Importação para registros de campo desativada até ser refeita com validação e mesclagem por id.
  if(tgt==='campo'){toast('Importação para registros de campo está desativada no momento.');return;}
  const rows=pendingImport.type==='csv'?pendingImport.rows:(pendingImport.gj.features||[]).map(f=>{
    if(!f.geometry||f.geometry.type!=='Point')return null;
    const[lng,lat]=f.geometry.coordinates;return{lat:lat+'',lng:lng+'',name:(f.properties?.name||f.properties?.nome||'')}; 
  }).filter(Boolean);
  rows.forEach(row=>{
    const lat=parseFloat(row.lat||row.latitude),lng=parseFloat(row.lng||row.longitude||row.lon);if(isNaN(lat)||isNaN(lng))return;
    const name=row.name||row.nome||'Importado';
    if(tgt==='campo'){return;}
    else{L.marker([lat,lng],{icon:mkPrioIcon()}).bindPopup(`<b>${esc(name)}</b>`).addTo(lgps[tgt]);}
    cnt++;
  });
  renderStats();renderPhases();renderLayers();renderList();toast(`${cnt} item(ns) importado(s) ✓`);closeImport();
}

/* ═══════════ EXPORT ═══════════ */
async function exportBackup(){
  try{
    const bk=await Store.gerarBackup();
    const blob=new Blob([JSON.stringify(bk,null,1)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`campo-iam-backup-${today()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    toast(`Backup gerado: ${bk.totalRegistros} registro(s), ${Object.keys(bk.fotos).length} foto(s) ✓`);
  }catch(e){console.error(e);toast('Erro ao gerar o backup');}
}
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
