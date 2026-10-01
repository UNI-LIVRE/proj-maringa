/* ═══════════════════════════════════════════════════════════════
   auth.js — senhas, sessões e proteção das rotas
   ───────────────────────────────────────────────────────────────
   • Senhas: guardadas só como hash scrypt (com "sal" aleatório).
     Nem quem tem acesso ao banco consegue ver a senha.
   • Sessão: ao entrar, o navegador recebe um cookie "HttpOnly"
     (o JavaScript da página não consegue lê-lo). No banco fica só o
     hash do cookie, então um vazamento do banco não dá acesso.
   • Tentativas: 5 senhas erradas numa conta → conta bloqueada por 15 min.
     30 erros vindos do mesmo IP → IP bloqueado por 15 min.
     (limites diferentes para uma pessoa errando não travar o escritório todo)
   ═══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');

const COOKIE = 'campo_sid';
const SENHA_MIN = 10;
const MAX_POR_EMAIL = 5;   // erros seguidos numa mesma conta
const MAX_POR_IP = 30;     // erros vindos de um mesmo endereço (ex.: robô testando várias contas)
const BLOQUEIO_MS = 15 * 60 * 1000;

/* ─── senhas ─────────────────────────────── */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashSenha(senha) {
  return new Promise((ok, falha) => {
    const sal = crypto.randomBytes(16);
    crypto.scrypt(senha, sal, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, chave) => {
      if (err) return falha(err);
      ok(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('base64')}$${chave.toString('base64')}`);
    });
  });
}

function conferirSenha(senha, guardado) {
  return new Promise(ok => {
    const partes = String(guardado || '').split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return ok(false);
    const [, N, r, p, sal, hash] = partes;
    const esperado = Buffer.from(hash, 'base64');
    crypto.scrypt(String(senha), Buffer.from(sal, 'base64'), esperado.length, { N: +N, r: +r, p: +p }, (err, chave) => {
      ok(!err && crypto.timingSafeEqual(chave, esperado));
    });
  });
}

// usado quando o e-mail não existe, para a resposta demorar o mesmo tempo
// (assim não dá para descobrir quais e-mails têm conta)
let HASH_FALSO = null;
hashSenha(crypto.randomBytes(12).toString('hex')).then(h => { HASH_FALSO = h; });

function validarNovaSenha(senha, { email, atual } = {}) {
  if (typeof senha !== 'string' || senha.length < SENHA_MIN) return `a senha precisa ter pelo menos ${SENHA_MIN} caracteres`;
  if (senha.length > 200) return 'senha longa demais';
  if (email && senha.toLowerCase().includes(String(email).split('@')[0].toLowerCase())) return 'a senha não pode conter o e-mail';
  if (atual && senha === atual) return 'a nova senha precisa ser diferente da atual';
  if (/^(.)\1+$/.test(senha)) return 'senha fraca demais';
  return null;
}

/** Senha provisória legível, sem caracteres ambíguos (0/O, 1/l). */
function senhaProvisoria(tamanho = 14) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(tamanho);
  let s = '';
  for (const b of bytes) s += alfabeto[b % alfabeto.length];
  return s.slice(0, 4) + '-' + s.slice(4, 9) + '-' + s.slice(9);
}

const normalizarEmail = e => String(e || '').trim().toLowerCase();

/* ─── sessões ────────────────────────────── */
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function lerCookie(req, nome) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function criarAuth({ usuarios, sessoes, config }) {
  const DIAS = config.sessaoDias;
  const SEGURO = config.cookieSeguro;

  function gravarCookie(res, token, expira) {
    const partes = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (SEGURO) partes.push('Secure');
    partes.push(expira ? `Expires=${expira.toUTCString()}` : 'Max-Age=0');
    res.append('Set-Cookie', partes.join('; '));
  }

  async function abrirSessao(req, res, usuario) {
    const token = crypto.randomBytes(32).toString('base64url');
    const agora = new Date();
    const expira = new Date(agora.getTime() + DIAS * 86400000);
    await sessoes.insertOne({
      _id: hashToken(token), usuarioId: usuario._id, criadoEm: agora, expiraEm: expira,
      ip: req.ip, navegador: String(req.get('User-Agent') || '').slice(0, 200),
    });
    gravarCookie(res, token, expira);
  }

  async function fecharSessao(req, res) {
    const token = lerCookie(req, COOKIE);
    if (token) await sessoes.deleteOne({ _id: hashToken(token) });
    gravarCookie(res, '', null);
  }

  /** Descobre quem está logado (ou null). */
  async function usuarioDaSessao(req) {
    const token = lerCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    const sessao = await sessoes.findOne({ _id: hashToken(token), expiraEm: { $gt: new Date() } });
    if (!sessao) return null;
    const usuario = await usuarios.findOne({ _id: sessao.usuarioId });
    if (!usuario || !usuario.ativo) return null;
    req.sessaoId = sessao._id;
    return usuario;
  }

  /** Middleware: só deixa passar quem está logado (e já trocou a senha provisória). */
  async function exigirLogin(req, res, next) {
    const u = await usuarioDaSessao(req);
    if (!u) return res.status(401).json({ erro: 'é preciso entrar no sistema' });
    if (u.trocarSenha) return res.status(403).json({ erro: 'troque a senha provisória antes de continuar', trocarSenha: true });
    req.usuario = u;
    next();
  }
  /** Igual, mas aceita quem ainda está com senha provisória (só para a troca de senha). */
  async function exigirLoginTrocaPendente(req, res, next) {
    const u = await usuarioDaSessao(req);
    if (!u) return res.status(401).json({ erro: 'é preciso entrar no sistema' });
    req.usuario = u;
    next();
  }

  /* ─── limite de tentativas (em memória) ─── */
  const falhas = new Map(); // chave → { n, ate }
  function bloqueado(chave) {
    const f = falhas.get(chave);
    if (!f) return 0;
    if (f.ate && f.ate > Date.now()) return Math.ceil((f.ate - Date.now()) / 60000);
    if (f.ate && f.ate <= Date.now()) falhas.delete(chave);
    return 0;
  }
  function registrarFalha(chave) {
    const max = chave.startsWith('ip:') ? MAX_POR_IP : MAX_POR_EMAIL;
    const f = falhas.get(chave) || { n: 0, ate: 0 };
    f.n++;
    if (f.n >= max) { f.ate = Date.now() + BLOQUEIO_MS; f.n = 0; }
    falhas.set(chave, f);
  }
  setInterval(() => { const t = Date.now(); for (const [k, f] of falhas) if (f.ate && f.ate < t) falhas.delete(k); }, 600000).unref();

  const publico = u => ({ id: u._id, nome: u.nome, email: u.email, papel: u.papel, trocarSenha: !!u.trocarSenha });

  /* ─── rotas /api/auth ───────────────────── */
  function rotas(router) {
    router.post('/auth/login', async (req, res) => {
      const email = normalizarEmail(req.body && req.body.email);
      const senha = req.body && req.body.senha;
      if (!email || typeof senha !== 'string' || !senha) return res.status(400).json({ erro: 'informe e-mail e senha' });

      const chaves = ['email:' + email, 'ip:' + req.ip];
      const espera = Math.max(...chaves.map(bloqueado));
      if (espera) return res.status(429).json({ erro: `muitas tentativas. Tente de novo em ${espera} min.` });

      const u = await usuarios.findOne({ email });
      const certo = await conferirSenha(senha, u ? u.senhaHash : HASH_FALSO);
      if (!u || !certo || !u.ativo) {
        chaves.forEach(registrarFalha);
        return res.status(401).json({ erro: 'e-mail ou senha incorretos' });
      }
      falhas.delete('email:' + email);   // acertou: zera o contador da conta
      await usuarios.updateOne({ _id: u._id }, { $set: { ultimoAcesso: new Date().toISOString() } });
      await abrirSessao(req, res, u);
      res.json({ usuario: publico(u) });
    });

    router.post('/auth/logout', async (req, res) => {
      await fecharSessao(req, res);
      res.status(204).end();
    });

    router.get('/auth/eu', async (req, res) => {
      const u = await usuarioDaSessao(req);
      if (!u) return res.status(401).json({ erro: 'não autenticado' });
      res.json({ usuario: publico(u) });
    });

    router.post('/auth/senha', exigirLoginTrocaPendente, async (req, res) => {
      const { senhaAtual, novaSenha } = req.body || {};
      const u = req.usuario;
      if (!(await conferirSenha(senhaAtual, u.senhaHash))) return res.status(400).json({ erro: 'a senha atual está incorreta' });
      const problema = validarNovaSenha(novaSenha, { email: u.email, atual: senhaAtual });
      if (problema) return res.status(400).json({ erro: problema });
      await usuarios.updateOne({ _id: u._id }, {
        $set: { senhaHash: await hashSenha(novaSenha), trocarSenha: false, senhaAlteradaEm: new Date().toISOString() },
      });
      // encerra as outras sessões dessa pessoa (outros aparelhos)
      await sessoes.deleteMany({ usuarioId: u._id, _id: { $ne: req.sessaoId } });
      res.json({ usuario: publico({ ...u, trocarSenha: false }) });
    });
  }

  return { rotas, exigirLogin, usuarioDaSessao };
}

module.exports = {
  criarAuth, hashSenha, conferirSenha, validarNovaSenha, senhaProvisoria, normalizarEmail,
  SENHA_MIN,
};
