/* ═══════════════════════════════════════════════════════════════
   config.js — onde os REGISTROS DE CAMPO são salvos
   ───────────────────────────────────────────────────────────────
   apiUrl vazio      → salva só neste navegador (IndexedDB)
   apiUrl preenchido → salva no MongoDB, pela API (pasta api/)

   Padrão atual:
   • aberto pelo Live Server (localhost / 127.0.0.1) → API local
   • aberto no GitHub Pages ou outro endereço       → navegador

   Quando a API estiver na nuvem, troque o '' pelo endereço dela,
   ex.: 'https://campo-iam-api.exemplo.com/api'
   ═══════════════════════════════════════════════════════════════ */
window.CAMPO_CONFIG = {
  apiUrl: ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:3000/api'
    : ''
};
