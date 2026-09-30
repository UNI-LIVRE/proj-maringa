/* ═══════════════════════════════════════════════════════════════
   store.js — camada de acesso aos REGISTROS DE CAMPO
   ───────────────────────────────────────────────────────────────
   Todo o app lê e grava registros de campo SOMENTE por aqui.
   Existem dois "destinos", com as mesmas funções:

     • API     → servidor Node + MongoDB (pasta api/ do repositório)
     • Navegador → IndexedDB, só neste navegador (usado no GitHub Pages)

   Qual usar é definido em js/config.js. Se a API estiver configurada
   mas não responder, o app avisa e usa o navegador.

   Formato de cada registro (o mesmo nos dois destinos):
   {
     type: "Feature",
     id: "uuid",
     geometry: { type: "Point", coordinates: [lng, lat] } | null,
     properties: {
       rua, bairro, fase, status, atividade, tecnico, data, obs,
       fotos: ["id-da-foto", …],
       criadoEm, atualizadoEm,          // ISO 8601
       excluido: false, excluidoEm: null // exclusão é marcada, não apagada
     }
   }
   ═══════════════════════════════════════════════════════════════ */

function novoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // alternativa para navegadores antigos
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ═══════════ DESTINO 1: NAVEGADOR (IndexedDB) ═══════════ */
const StoreNavegador = (() => {
  const DB_NAME = 'campo-iam';
  const DB_VERSION = 1;
  const LEGACY_KEY = 'iam007_v3';           // formato antigo (localStorage)
  const LEGACY_DONE = 'iam007_v3_migrado';  // marca de migração concluída
  let db = null;

  /* ─── util ─────────────────────────────── */
  const agora = () => new Date().toISOString();
  function tx(stores, mode, fn) {
    return new Promise((ok, err) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => ok(out);
      t.onerror = () => err(t.error);
      t.onabort = () => err(t.error || new Error('Transação abortada'));
      out = fn(t);
    });
  }

  /* ─── abertura do banco ────────────────── */
  function abrir() {
    return new Promise((ok, err) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('registros')) d.createObjectStore('registros', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos', { keyPath: 'id' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }

  async function init() {
    db = await abrir();
    // pede ao navegador para não apagar os dados quando faltar espaço
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    const migrados = await migrarLegado();
    return { migrados };
  }


  /* ─── migração do formato antigo ───────────
     Converte os registros salvos no localStorage (versão anterior)
     para o formato novo. O dado antigo NÃO é apagado: fica como
     cópia de segurança até alguém removê-lo manualmente.            */
  async function migrarLegado() {
    if (localStorage.getItem(LEGACY_DONE)) return 0;
    let antigos = [];
    try { antigos = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); } catch (e) { antigos = []; }
    if (!Array.isArray(antigos) || !antigos.length) { localStorage.setItem(LEGACY_DONE, agora()); return 0; }

    const existentes = new Set((await todos()).map(f => f.id));
    let n = 0;
    for (const r of antigos) {
      if (!r || !r.id || existentes.has(String(r.id))) continue;
      const fotoIds = [];
      for (const dataUrl of (r.fotos || [])) {
        try { fotoIds.push(await salvarFoto(await (await fetch(dataUrl)).blob())); } catch (e) {}
      }
      const ts = /^r(\d{12,})$/.exec(r.id);            // ids antigos: 'r' + Date.now()
      const criado = ts ? new Date(+ts[1]).toISOString() : agora();
      await gravar({
        type: 'Feature',
        id: String(r.id),
        geometry: (isFinite(r.lat) && isFinite(r.lng) && r.lat !== null && r.lng !== null)
          ? { type: 'Point', coordinates: [+r.lng, +r.lat] } : null,
        properties: {
          rua: r.rua || '', bairro: r.bairro || '', fase: r.fase || 'diagnostico',
          status: r.status || 'nao_iniciado', atividade: r.ativ || '', tecnico: r.tec || '',
          data: r.data || '', obs: r.obs || '', fotos: fotoIds,
          criadoEm: criado, atualizadoEm: criado, excluido: false, excluidoEm: null,
          origem: 'migracao-v3'
        }
      });
      n++;
    }
    localStorage.setItem(LEGACY_DONE, agora());
    return n;
  }

  /* ─── registros ────────────────────────── */
  function todos() {
    return new Promise((ok, err) => {
      const r = db.transaction('registros').objectStore('registros').getAll();
      r.onsuccess = () => ok(r.result || []); r.onerror = () => err(r.error);
    });
  }
  function gravar(feature) {
    return tx(['registros'], 'readwrite', t => { t.objectStore('registros').put(feature); });
  }
  function buscar(id) {
    return new Promise((ok, err) => {
      const r = db.transaction('registros').objectStore('registros').get(id);
      r.onsuccess = () => ok(r.result || null); r.onerror = () => err(r.error);
    });
  }

  /** Lista os registros ativos (não excluídos). */
  async function listarRegistros() {
    return (await todos()).filter(f => !f.properties.excluido);
  }

  /** Cria ou atualiza. Recebe {id?, geometry, properties}; devolve o registro salvo. */
  async function salvarRegistro(dados) {
    const id = dados.id || novoId();
    const anterior = dados.id ? await buscar(id) : null;
    const t = agora();
    const feature = {
      type: 'Feature',
      id,
      geometry: dados.geometry || null,
      properties: {
        ...(anterior ? anterior.properties : {}),
        ...dados.properties,
        criadoEm: anterior ? anterior.properties.criadoEm : t,
        atualizadoEm: t,
        excluido: false,
        excluidoEm: null
      }
    };
    await gravar(feature);
    return feature;
  }

  /** Exclusão marcada (soft delete): o registro some do mapa, mas não é apagado. */
  async function excluirRegistro(id) {
    const f = await buscar(id);
    if (!f) return;
    const t = agora();
    f.properties.excluido = true;
    f.properties.excluidoEm = t;
    f.properties.atualizadoEm = t;
    await gravar(f);
  }

  /* ─── fotos ────────────────────────────── */
  async function salvarFoto(blob) {
    const id = novoId();
    await tx(['fotos'], 'readwrite', t => { t.objectStore('fotos').put({ id, blob, tipo: blob.type, criadoEm: agora() }); });
    return id;
  }
  function lerFoto(id) {
    return new Promise((ok, err) => {
      const r = db.transaction('fotos').objectStore('fotos').get(id);
      r.onsuccess = () => ok(r.result ? r.result.blob : null); r.onerror = () => err(r.error);
    });
  }
  function apagarFoto(id) {
    return tx(['fotos'], 'readwrite', t => { t.objectStore('fotos').delete(id); });
  }

  return { init, todos, listarRegistros, salvarRegistro, excluirRegistro, salvarFoto, lerFoto, apagarFoto };
})();

/* ═══════════ DESTINO 2: API (Node + MongoDB) ═══════════ */
const StoreApi = (() => {
  let base = '';

  async function chamar(caminho, opcoes = {}) {
    const r = await fetch(base + caminho, opcoes);
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const j = await r.json(); if (j && j.erro) msg = j.erro; } catch (e) {}
      const erro = new Error(msg); erro.status = r.status; throw erro;
    }
    return r;
  }
  const json = (metodo, corpo) => ({ method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

  async function init(url) {
    base = String(url).replace(/\/+$/, '');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try { await chamar('/saude', { signal: ctrl.signal }); } finally { clearTimeout(t); }
    return { migrados: 0 };
  }

  const todos = async () => (await chamar('/registros?incluirExcluidos=1')).json();
  const listarRegistros = async () => (await chamar('/registros')).json();

  async function salvarRegistro(dados) {
    const id = dados.id || novoId();   // o id nasce no navegador, igual ao modo local
    const r = await chamar('/registros/' + encodeURIComponent(id),
      json('PUT', { geometry: dados.geometry || null, properties: dados.properties }));
    return r.json();
  }
  async function excluirRegistro(id) {
    try { await chamar('/registros/' + encodeURIComponent(id), { method: 'DELETE' }); }
    catch (e) { if (e.status !== 404) throw e; }
  }

  async function salvarFoto(blob) {
    const r = await chamar('/fotos', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
    return (await r.json()).id;
  }
  async function lerFoto(id) {
    try { return await (await chamar('/fotos/' + encodeURIComponent(id))).blob(); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function apagarFoto(id) {
    try { await chamar('/fotos/' + encodeURIComponent(id), { method: 'DELETE' }); }
    catch (e) { if (e.status !== 404) throw e; }
  }

  return { init, todos, listarRegistros, salvarRegistro, excluirRegistro, salvarFoto, lerFoto, apagarFoto };
})();

/* ═══════════ STORE: o que o app usa ═══════════ */
const Store = (() => {
  let destino = null;
  let modo = null;       // 'api' | 'navegador'
  let apiUrl = '';

  /** Escolhe o destino. Devolve { modo, apiUrl, migrados, falhaApi }. */
  async function init() {
    const cfg = window.CAMPO_CONFIG || {};
    apiUrl = cfg.apiUrl || '';
    let falhaApi = null;
    if (apiUrl) {
      try {
        const r = await StoreApi.init(apiUrl);
        destino = StoreApi; modo = 'api';
        return { modo, apiUrl, migrados: r.migrados, falhaApi };
      } catch (e) {
        falhaApi = e.name === 'AbortError' ? 'a API não respondeu' : (e.message || String(e));
        console.warn('API indisponível em', apiUrl, '→ usando o navegador.', e);
      }
    }
    const r = await StoreNavegador.init();
    destino = StoreNavegador; modo = 'navegador';
    return { modo, apiUrl, migrados: r.migrados, falhaApi };
  }

  const blobParaDataUrl = b => new Promise((ok, err) => {
    const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = () => err(rd.error); rd.readAsDataURL(b);
  });

  /** Arquivo de backup: todos os registros (inclusive excluídos) + fotos. */
  async function gerarBackup() {
    const registros = await destino.todos();
    const fotos = {};
    for (const f of registros) {
      for (const fid of (f.properties.fotos || [])) {
        if (fotos[fid]) continue;
        const b = await destino.lerFoto(fid);
        if (b) fotos[fid] = await blobParaDataUrl(b);
      }
    }
    return {
      tipo: 'campo-iam-registros',
      versao: 1,
      exportadoEm: new Date().toISOString(),
      origem: modo,
      totalRegistros: registros.length,
      registros,
      fotos
    };
  }

  return {
    init,
    get modo() { return modo; },
    get apiUrl() { return apiUrl; },
    novoId,
    listarRegistros: () => destino.listarRegistros(),
    salvarRegistro: d => destino.salvarRegistro(d),
    excluirRegistro: id => destino.excluirRegistro(id),
    salvarFoto: b => destino.salvarFoto(b),
    lerFoto: id => destino.lerFoto(id),
    apagarFoto: id => destino.apagarFoto(id),
    gerarBackup
  };
})();
