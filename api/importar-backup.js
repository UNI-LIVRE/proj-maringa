/* ═══════════════════════════════════════════════════════════════
   Carga de um arquivo de backup (botão "⬇ Backup") no MongoDB.

   Uso:
     npm run importar -- caminho/campo-iam-backup-AAAA-MM-DD.json
       → só mostra a PRÉVIA (não grava nada)
     npm run importar -- caminho/arquivo.json --aplicar
       → grava de verdade

   Regras (seguras por padrão):
   • só INSERE registros cujo id ainda não existe no banco;
   • nunca sobrescreve nem apaga nada que já está no banco;
   • registros inválidos são listados e ignorados, um a um;
   • registros excluídos no backup entram como excluídos
     (assim não "ressuscitam" depois).
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });   // lê o api/.env de qualquer pasta
const fs = require('fs');
const path = require('path');
const { conectar, uriSemSenha } = require('./db');
const { validarId, validarRegistro } = require('./registro');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'campo_iam';

function lerBackup(arquivo) {
  let bk;
  try { bk = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
  catch (e) { throw new Error(`não consegui ler ${arquivo}: ${e.message}`); }
  if (!bk || bk.tipo !== 'campo-iam-registros') throw new Error('este arquivo não é um backup do Campo IAM');
  if (bk.versao !== 1) throw new Error(`versão de backup não suportada: ${bk.versao}`);
  if (!Array.isArray(bk.registros)) throw new Error('backup sem lista de registros');
  return bk;
}

function dataUrlParaBuffer(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const tipo = m[1] || 'image/jpeg';
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { tipo, buf };
}

/** Separa o backup em: novos, já existentes e inválidos. Não grava nada. */
async function planejar(bk, registros) {
  const novos = [], existentes = [], invalidos = [];
  const vistos = new Set();
  for (const [i, f] of bk.registros.entries()) {
    const rotulo = `#${i + 1}${f && f.properties && f.properties.rua ? ' (' + f.properties.rua + ')' : ''}`;
    if (!f || !validarId(f.id)) { invalidos.push(`${rotulo}: id inválido`); continue; }
    if (vistos.has(f.id)) { invalidos.push(`${rotulo}: id repetido no arquivo`); continue; }
    vistos.add(f.id);

    const { erros, geometry, properties } = validarRegistro(f);
    if (erros.length) { invalidos.push(`${rotulo}: ${erros.join('; ')}`); continue; }

    if (await registros.findOne({ _id: f.id }, { projection: { _id: 1 } })) { existentes.push(f.id); continue; }

    const p = f.properties || {};
    const agora = new Date().toISOString();
    novos.push({
      _id: f.id,
      type: 'Feature',
      geometry,
      properties: {
        ...properties,
        criadoEm: p.criadoEm || agora,
        atualizadoEm: p.atualizadoEm || p.criadoEm || agora,
        excluido: !!p.excluido,
        excluidoEm: p.excluido ? (p.excluidoEm || agora) : null,
        origem: 'backup',
        importadoEm: agora,
      },
    });
  }
  return { novos, existentes, invalidos };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const arquivo = args.find(a => !a.startsWith('--'));
  if (!arquivo) {
    console.log('Uso: npm run importar -- caminho/do/backup.json [--aplicar]');
    process.exit(1);
  }

  const bk = lerBackup(path.resolve(arquivo));
  const conexao = await conectar(MONGODB_URI, MONGODB_DB);
  try {
    const { registros, fotos } = conexao;
    const plano = await planejar(bk, registros);

    // fotos usadas pelos registros novos
    const fotoIds = [...new Set(plano.novos.flatMap(d => d.properties.fotos))];
    const fotosNovas = [], fotosFaltando = [];
    for (const id of fotoIds) {
      if (await fotos.find({ _id: id }).next()) continue;          // já está no banco
      if (bk.fotos && bk.fotos[id]) fotosNovas.push(id); else fotosFaltando.push(id);
    }

    console.log(`\nBackup: ${path.basename(arquivo)}  (exportado em ${bk.exportadoEm || '?'})`);
    console.log(`Banco:  ${MONGODB_DB}  em ${uriSemSenha(MONGODB_URI)}\n`);
    console.log(`  ${plano.novos.length} registro(s) novo(s) para inserir`);
    console.log(`     (${plano.novos.filter(d => d.properties.excluido).length} deles marcados como excluídos)`);
    console.log(`  ${plano.existentes.length} registro(s) já existem no banco → não serão alterados`);
    console.log(`  ${plano.invalidos.length} registro(s) inválido(s) → ignorados`);
    console.log(`  ${fotosNovas.length} foto(s) para inserir` + (fotosFaltando.length ? `, ${fotosFaltando.length} referenciada(s) mas ausente(s) no arquivo` : ''));
    for (const m of plano.invalidos) console.log('     ✖ ' + m);

    if (!aplicar) {
      console.log('\nPRÉVIA — nada foi gravado. Para gravar, rode de novo com --aplicar\n');
      return;
    }
    if (!plano.novos.length) { console.log('\nNada para inserir.\n'); return; }

    for (const id of fotosNovas) {
      const d = dataUrlParaBuffer(bk.fotos[id]);
      if (!d) { console.log('     ✖ foto ' + id + ' ilegível, ignorada'); continue; }
      await new Promise((ok, falha) => {
        fotos.openUploadStreamWithId(id, id, { metadata: { tipo: d.tipo, criadoEm: new Date().toISOString(), origem: 'backup' } })
          .on('finish', ok).on('error', falha).end(d.buf);
      });
    }
    const r = await registros.insertMany(plano.novos, { ordered: false });
    console.log(`\n✔ ${r.insertedCount} registro(s) e ${fotosNovas.length} foto(s) inseridos.\n`);
  } finally {
    await conexao.client.close();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('\n✖ ' + e.message + '\n'); process.exit(1); });
}
module.exports = { lerBackup, planejar, dataUrlParaBuffer };
