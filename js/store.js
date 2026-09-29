/* ═══════════════════════════════════════════════════════════════
   store.js — camada de acesso aos REGISTROS DE CAMPO
   ───────────────────────────────────────────────────────────────
   Todo o app lê e grava registros de campo SOMENTE por aqui.
   Hoje os dados ficam no navegador (IndexedDB). No futuro, basta
   reescrever as funções deste arquivo para chamar a API (MongoDB
   local ou na nuvem) — o restante do código não precisa mudar.

   Formato de cada registro (igual ao que irá para o MongoDB):
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
   Fotos ficam em um "store" separado: { id, blob, tipo, criadoEm }.
   ═══════════════════════════════════════════════════════════════ */
const Store = (() => {
  const DB_NAME = 'campo-iam';
  const DB_VERSION = 1;
  const LEGACY_KEY = 'iam007_v3';           // formato antigo (localStorage)
  const LEGACY_DONE = 'iam007_v3_migrado';  // marca de migração concluída
  let db = null;

  /* ─── util ─────────────────────────────── */
  const agora = () => new Date().toISOString();
  function novoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // alternativa para navegadores antigos
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
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

  /* ─── backup ───────────────────────────── */
  const blobParaDataUrl = b => new Promise((ok, err) => {
    const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = () => err(rd.error); rd.readAsDataURL(b);
  });

  /** Monta o arquivo de backup: todos os registros (inclusive excluídos) + fotos. */
  async function gerarBackup() {
    const registros = await todos();
    const fotos = {};
    for (const f of registros) {
      for (const fid of (f.properties.fotos || [])) {
        if (fotos[fid]) continue;
        const b = await lerFoto(fid);
        if (b) fotos[fid] = await blobParaDataUrl(b);
      }
    }
    return {
      tipo: 'campo-iam-registros',
      versao: 1,
      exportadoEm: agora(),
      totalRegistros: registros.length,
      registros,
      fotos
    };
  }

  return { init, novoId, listarRegistros, salvarRegistro, excluirRegistro, salvarFoto, lerFoto, apagarFoto, gerarBackup };
})();
