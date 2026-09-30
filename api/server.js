/* ═══════════════════════════════════════════════════════════════
   API dos registros de campo — Campo IAM · Maringá
   Rodar:  npm install   (só na primeira vez)
           npm run dev   (reinicia sozinho quando o código muda)

   Rotas:
     GET    /api/saude                    → verifica API + banco
     GET    /api/registros                → registros ativos
     GET    /api/registros?incluirExcluidos=1
     GET    /api/registros/:id
     PUT    /api/registros/:id            → cria ou atualiza
     DELETE /api/registros/:id            → exclusão marcada (não apaga)
     POST   /api/fotos                    → envia imagem (corpo = arquivo)
     GET    /api/fotos/:id
     DELETE /api/fotos/:id
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { conectar, paraFeature } = require('./db');
const { validarId, validarRegistro } = require('./registro');

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'campo_iam';
const ORIGENS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const TIPOS_FOTO = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
const MAX_FOTO = 15 * 1024 * 1024; // 15 MB

function criarApp({ registros, fotos, db }) {
  const app = express();

  // Quem pode chamar a API a partir do navegador
  app.use(cors({
    origin(origem, cb) {
      if (!origem) return cb(null, true); // chamadas fora do navegador (curl, scripts)
      const liberado = ORIGENS.length ? ORIGENS.includes(origem) : LOCALHOST.test(origem);
      cb(null, liberado);
    },
  }));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();

  api.get('/saude', async (req, res) => {
    await db.command({ ping: 1 });
    res.json({ ok: true, banco: db.databaseName });
  });

  /* ─── registros ─────────────────────────── */
  api.get('/registros', async (req, res) => {
    const filtro = req.query.incluirExcluidos === '1' ? {} : { 'properties.excluido': { $ne: true } };
    const docs = await registros.find(filtro).sort({ 'properties.criadoEm': 1 }).toArray();
    res.json(docs.map(paraFeature));
  });

  api.get('/registros/:id', async (req, res) => {
    if (!validarId(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
    const doc = await registros.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ erro: 'registro não encontrado' });
    res.json(paraFeature(doc));
  });

  api.put('/registros/:id', async (req, res) => {
    const id = req.params.id;
    if (!validarId(id)) return res.status(400).json({ erro: 'id inválido' });
    const { erros, geometry, properties } = validarRegistro(req.body);
    if (erros.length) return res.status(400).json({ erro: erros.join('; '), erros });

    const existente = await registros.findOne({ _id: id }, { projection: { 'properties.excluido': 1 } });
    // um registro excluído não "ressuscita" por uma gravação
    if (existente && existente.properties && existente.properties.excluido) {
      return res.status(410).json({ erro: 'este registro foi excluído' });
    }

    const agora = new Date().toISOString();
    const set = { type: 'Feature', geometry };
    for (const [k, v] of Object.entries(properties)) set['properties.' + k] = v;
    set['properties.atualizadoEm'] = agora;
    set['properties.excluido'] = false;
    set['properties.excluidoEm'] = null;

    const doc = await registros.findOneAndUpdate(
      { _id: id },
      { $set: set, $setOnInsert: { 'properties.criadoEm': agora } },
      { upsert: true, returnDocument: 'after' },
    );
    res.status(existente ? 200 : 201).json(paraFeature(doc));
  });

  api.delete('/registros/:id', async (req, res) => {
    if (!validarId(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
    const agora = new Date().toISOString();
    const r = await registros.updateOne(
      { _id: req.params.id },
      { $set: { 'properties.excluido': true, 'properties.excluidoEm': agora, 'properties.atualizadoEm': agora } },
    );
    if (!r.matchedCount) return res.status(404).json({ erro: 'registro não encontrado' });
    res.status(204).end();
  });

  /* ─── fotos (GridFS) ────────────────────── */
  api.post('/fotos', express.raw({ type: 'image/*', limit: MAX_FOTO }), async (req, res) => {
    const tipo = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_FOTO.test(tipo)) return res.status(415).json({ erro: 'formato de imagem não suportado' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ erro: 'imagem vazia' });

    const id = crypto.randomUUID();
    await new Promise((ok, falha) => {
      fotos.openUploadStreamWithId(id, id, { metadata: { tipo, criadoEm: new Date().toISOString() } })
        .on('finish', ok).on('error', falha)
        .end(req.body);
    });
    res.status(201).json({ id });
  });

  api.get('/fotos/:id', async (req, res) => {
    if (!validarId(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
    const arq = await fotos.find({ _id: req.params.id }).next();
    if (!arq) return res.status(404).json({ erro: 'foto não encontrada' });
    res.set('Content-Type', (arq.metadata && arq.metadata.tipo) || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=31536000, immutable'); // a foto nunca muda
    fotos.openDownloadStream(arq._id).on('error', () => res.destroy()).pipe(res);
  });

  api.delete('/fotos/:id', async (req, res) => {
    if (!validarId(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
    try { await fotos.delete(req.params.id); }
    catch (e) { return res.status(404).json({ erro: 'foto não encontrada' }); }
    res.status(204).end();
  });

  api.use((req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

  app.use('/api', api);
  app.get('/', (req, res) => res.type('text').send('API Campo IAM rodando. Teste: /api/saude'));

  // erros inesperados
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'arquivo grande demais' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ erro: 'erro interno da API' });
  });

  return app;
}

async function iniciar() {
  let conexao;
  try {
    conexao = await conectar(MONGODB_URI, MONGODB_DB);
  } catch (e) {
    console.error(`\n✖ Não foi possível conectar ao MongoDB em ${MONGODB_URI}`);
    console.error('  Verifique se o MongoDB está instalado e o serviço "MongoDB Server" está rodando.');
    console.error('  Detalhe:', e.message, '\n');
    process.exit(1);
  }
  const app = criarApp(conexao);
  const servidor = app.listen(PORT, () => {
    console.log(`\n✔ API rodando em http://localhost:${PORT}/api  (banco "${MONGODB_DB}")`);
    console.log(`  Teste no navegador: http://localhost:${PORT}/api/saude\n`);
  });
  servidor.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`\n✖ A porta ${PORT} já está em uso. Feche o outro programa ou mude PORT no .env.\n`);
    else console.error(e);
    process.exit(1);
  });
  const encerrar = () => servidor.close(() => conexao.client.close().then(() => process.exit(0)));
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

if (require.main === module) iniciar();
module.exports = { criarApp };
