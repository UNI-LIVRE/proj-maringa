/* ═══════════════════════════════════════════════════════════════
   API dos registros de campo — Campo IAM · Maringá
   Rodar:  npm install   (só na primeira vez)
           npm run dev   (reinicia sozinho quando o código muda)
   Abrir:  http://localhost:3000   ← a própria API serve a página

   Rotas públicas:
     GET    /api/saude
     POST   /api/auth/login           { email, senha }
     POST   /api/auth/logout
     GET    /api/auth/eu              → quem está logado
   Rotas que exigem login:
     POST   /api/auth/senha           { senhaAtual, novaSenha }
     /api/admin/usuarios…             → tela de usuários (só administradores, ver admin.js)
     GET    /api/registros            (?incluirExcluidos=1)
     GET    /api/registros/:id
     PUT    /api/registros/:id        → cria ou atualiza
     DELETE /api/registros/:id        → exclusão marcada (não apaga)
     POST   /api/fotos                → envia imagem (corpo = arquivo)
     GET    /api/fotos/:id
     DELETE /api/fotos/:id
     GET    /data/*.geojson           → camadas do mapa
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });   // lê o api/.env de qualquer pasta
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { conectar, paraFeature, uriSemSenha } = require('./db');
const { validarId, validarRegistro } = require('./registro');
const { criarAuth } = require('./auth');
const { criarRotasAdmin } = require('./admin');

const PRODUCAO = process.env.NODE_ENV === 'production';
const CONFIG = {
  porta: Number(process.env.PORT) || 3000,
  // 127.0.0.1 = só este computador acessa a porta diretamente.
  // Na nuvem, o Caddy (HTTPS) recebe o acesso de fora e repassa para cá.
  host: (process.env.HOST || '127.0.0.1').trim(),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'campo_iam',
  sessaoDias: Number(process.env.SESSAO_DIAS) || 7,
  // em produção (HTTPS) o cookie só trafega criptografado
  cookieSeguro: process.env.COOKIE_SEGURO ? process.env.COOKIE_SEGURO === '1' : PRODUCAO,
  // atrás de um balanceador/proxy (nuvem), para saber o IP real de quem acessa
  trustProxy: process.env.TRUST_PROXY || (PRODUCAO ? 1 : false),
  // como o acesso de um usuário novo é entregue: 'senha' (provisória, na tela) ou 'email' (futuro)
  conviteModo: (process.env.CONVITE_MODO || 'senha').trim().toLowerCase(),
};
if (!['senha', 'email'].includes(CONFIG.conviteModo)) {
  console.warn(`⚠ CONVITE_MODO="${CONFIG.conviteModo}" não reconhecido; usando "senha".`);
  CONFIG.conviteModo = 'senha';
}
const RAIZ_SITE = path.join(__dirname, '..');   // pasta com index.html, css/, js/, data/
const TIPOS_FOTO = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
const MAX_FOTO = 15 * 1024 * 1024; // 15 MB

const quem = u => ({ id: u._id, nome: u.nome });

function criarApp(conexao) {
  const { registros, fotos, db } = conexao;
  const auth = criarAuth({ ...conexao, config: CONFIG });
  const app = express();
  app.disable('x-powered-by');
  if (CONFIG.trustProxy) app.set('trust proxy', CONFIG.trustProxy);

  /* ─── cabeçalhos de segurança ───────────── */
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    });
    if (CONFIG.cookieSeguro) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  /* ─── gravações só a partir da própria página ───
     Bloqueia outro site tentando agir em nome de quem está logado. */
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origem = req.get('Origin');
    if (origem) {
      let host = null;
      try { host = new URL(origem).host; } catch (e) {}
      if (host !== req.get('Host')) return res.status(403).json({ erro: 'origem não permitida' });
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();

  api.get('/saude', async (req, res) => {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  });

  auth.rotas(api);

  /* daqui para baixo, tudo exige login */
  api.use(auth.exigirLogin);

  /* tela "Usuários" — só administradores */
  api.use('/admin', criarRotasAdmin(conexao, CONFIG));

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
    set['properties.atualizadoPor'] = quem(req.usuario);
    set['properties.excluido'] = false;
    set['properties.excluidoEm'] = null;

    const doc = await registros.findOneAndUpdate(
      { _id: id },
      { $set: set, $setOnInsert: { 'properties.criadoEm': agora, 'properties.criadoPor': quem(req.usuario) } },
      { upsert: true, returnDocument: 'after' },
    );
    res.status(existente ? 200 : 201).json(paraFeature(doc));
  });

  api.delete('/registros/:id', async (req, res) => {
    if (!validarId(req.params.id)) return res.status(400).json({ erro: 'id inválido' });
    const agora = new Date().toISOString();
    const r = await registros.updateOne(
      { _id: req.params.id },
      { $set: { 'properties.excluido': true, 'properties.excluidoEm': agora, 'properties.excluidoPor': quem(req.usuario), 'properties.atualizadoEm': agora } },
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
      fotos.openUploadStreamWithId(id, id, { metadata: { tipo, criadoEm: new Date().toISOString(), criadoPor: quem(req.usuario) } })
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

  /* ─── a página ──────────────────────────────
     Só estas pastas são servidas. A pasta api/ (com o .env) NUNCA é exposta. */
  app.get('/js/config.js', (req, res) => {
    // quando a página vem da API, os registros vão para a API (com login)
    res.type('application/javascript').set('Cache-Control', 'no-cache')
      .send("window.CAMPO_CONFIG = { apiUrl: '/api' };\n");
  });
  const estatico = { dotfiles: 'deny', index: false, fallthrough: true };
  app.use('/css', express.static(path.join(RAIZ_SITE, 'css'), estatico));
  app.use('/js', express.static(path.join(RAIZ_SITE, 'js'), estatico));
  // as camadas do mapa são dados do cliente → só com login
  app.use('/data', auth.exigirLogin, express.static(path.join(RAIZ_SITE, 'data'), estatico));
  app.get(['/', '/index.html'], (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(RAIZ_SITE, 'index.html'));
  });

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
    conexao = await conectar(CONFIG.mongoUri, CONFIG.mongoDb);
  } catch (e) {
    console.error(`\n✖ Não foi possível conectar ao MongoDB em ${uriSemSenha(CONFIG.mongoUri)}`);
    if (/^mongodb\+srv:/.test(CONFIG.mongoUri))
      console.error('  Atlas: confira usuário/senha no .env e se o IP deste servidor está liberado em Network Access.');
    else
      console.error('  Verifique se o MongoDB está instalado e o serviço "MongoDB Server" está rodando.');
    console.error('  Detalhe:', String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, uriSemSenha), '\n');
    process.exit(1);
  }
  const total = await conexao.usuarios.countDocuments({});
  const app = criarApp(conexao);
  const servidor = app.listen(CONFIG.porta, CONFIG.host, () => {
    const local = ['127.0.0.1', 'localhost', '::1'].includes(CONFIG.host) ? 'localhost' : CONFIG.host;
    console.log(`\n✔ Campo IAM rodando em http://${local}:${CONFIG.porta}  (banco "${CONFIG.mongoDb}"${PRODUCAO ? ', modo produção' : ''})`);
    if (!total) console.log('  ⚠ Nenhum usuário cadastrado. Crie o primeiro com:\n    npm run usuarios -- criar seu@email.com "Seu Nome" --admin');
    console.log('');
  });
  servidor.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`\n✖ A porta ${CONFIG.porta} já está em uso. Feche o outro programa ou mude PORT no .env.\n`);
    else console.error(e);
    process.exit(1);
  });
  const encerrar = () => servidor.close(() => conexao.client.close().then(() => process.exit(0)));
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

if (require.main === module) iniciar();
module.exports = { criarApp };
