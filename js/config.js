/* ═══════════════════════════════════════════════════════════════
   config.js — onde os REGISTROS DE CAMPO são salvos
   ───────────────────────────────────────────────────────────────
   Este arquivo vale para o GitHub Pages e o Live Server:
   apiUrl vazio → registros salvos só neste navegador, sem login
   (modo demonstração).

   Quando a página é aberta pela API (http://localhost:3000 ou,
   no futuro, o endereço na nuvem), a própria API entrega outra
   versão deste arquivo com apiUrl: '/api' — e aí vale o banco
   de dados, com login. Não é preciso editar nada aqui.
   ═══════════════════════════════════════════════════════════════ */
window.CAMPO_CONFIG = {
  apiUrl: ''
};
