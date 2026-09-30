/* Regras de validação de um registro de campo.
   Usadas pela API (server.js) e pelo script de carga (importar-backup.js).

   Para adicionar um campo novo ao formulário (ex.: "subbacia"),
   inclua-o em TEXTOS abaixo — campos fora desta lista são ignorados. */

const FASES = ['diagnostico', 'topografia', 'hidrologico', 'plano', 'relatorio'];
const STATUS = ['concluido', 'em_andamento', 'nao_iniciado', 'problema'];

// campo de texto → tamanho máximo
const TEXTOS = { rua: 200, bairro: 120, atividade: 500, tecnico: 120, obs: 2000 };

const MAX_FOTOS = 5;
// UUID (registros novos) ou ids antigos como "r1727000000000"
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function validarId(id) {
  return typeof id === 'string' && ID_VALIDO.test(id);
}

/**
 * Valida e limpa {geometry, properties} vindos do navegador.
 * Devolve { erros: [...], geometry, properties }.
 * Campos controlados pelo servidor (criadoEm, atualizadoEm, excluido…) não são aceitos daqui.
 */
function validarRegistro(entrada) {
  const erros = [];
  const e = entrada || {};

  // geometria: ponto [lng, lat] ou null
  let geometry = null;
  if (e.geometry != null) {
    const g = e.geometry;
    const c = g && g.coordinates;
    if (!g || g.type !== 'Point' || !Array.isArray(c) || c.length < 2) {
      erros.push('geometry deve ser um Point com [longitude, latitude] ou null');
    } else {
      const lng = Number(c[0]), lat = Number(c[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        erros.push('coordenadas inválidas');
      } else {
        geometry = { type: 'Point', coordinates: [lng, lat] };
      }
    }
  }

  const p = e.properties || {};
  const properties = {};

  for (const [campo, max] of Object.entries(TEXTOS)) {
    const v = p[campo] == null ? '' : p[campo];
    if (typeof v !== 'string') { erros.push(`${campo} deve ser texto`); continue; }
    if (v.length > max) { erros.push(`${campo} excede ${max} caracteres`); continue; }
    properties[campo] = v.trim();
  }

  properties.fase = p.fase || 'diagnostico';
  if (!FASES.includes(properties.fase)) erros.push(`fase inválida (use: ${FASES.join(', ')})`);

  properties.status = p.status || 'nao_iniciado';
  if (!STATUS.includes(properties.status)) erros.push(`status inválido (use: ${STATUS.join(', ')})`);

  properties.data = p.data || '';
  if (properties.data && !/^\d{4}-\d{2}-\d{2}$/.test(properties.data)) erros.push('data deve estar no formato AAAA-MM-DD');

  const fotos = p.fotos == null ? [] : p.fotos;
  if (!Array.isArray(fotos) || fotos.length > MAX_FOTOS || !fotos.every(validarId)) {
    erros.push(`fotos deve ser uma lista de até ${MAX_FOTOS} ids`);
  } else {
    properties.fotos = fotos;
  }

  return { erros, geometry, properties };
}

module.exports = { FASES, STATUS, TEXTOS, MAX_FOTOS, validarId, validarRegistro };
