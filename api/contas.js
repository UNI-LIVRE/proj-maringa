/* ═══════════════════════════════════════════════════════════════
   contas.js — regras de gerenciamento de usuários
   Usado pela tela "Usuários" (rotas /api/admin) e pelo comando
   "npm run usuarios". As regras ficam num lugar só.

   Travas de segurança:
   • ninguém desativa a própria conta nem tira o próprio papel de admin;
   • sempre sobra pelo menos um administrador ativo;
   • redefinir senha, desativar ou trocar o papel encerra as sessões abertas.
   ═══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { hashSenha, senhaProvisoria, normalizarEmail } = require('./auth');

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAPEIS = ['usuario', 'admin'];

class ErroConta extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

/** Dados que podem sair para a tela (nunca o hash da senha). */
function publico(u) {
  return {
    id: u._id, nome: u.nome, email: u.email, papel: u.papel || 'usuario',
    ativo: !!u.ativo, trocarSenha: !!u.trocarSenha,
    criadoEm: u.criadoEm || null, ultimoAcesso: u.ultimoAcesso || null,
  };
}

function criarContas({ usuarios, sessoes }) {
  async function buscar({ id, email }) {
    const u = id ? await usuarios.findOne({ _id: id }) : await usuarios.findOne({ email: normalizarEmail(email) });
    if (!u) throw new ErroConta(id ? 'usuário não encontrado' : `não existe usuário com o e-mail ${normalizarEmail(email)}`, 404);
    return u;
  }

  async function adminsAtivos() {
    return (await usuarios.find({ papel: 'admin', ativo: true }).toArray()).length;
  }

  async function listar() {
    const lista = await usuarios.find({}).sort({ nome: 1 }).toArray();
    return lista.map(publico);
  }

  /** Cria a conta e devolve { usuario, senhaProvisoria }. */
  async function criar({ email, nome, papel = 'usuario' }, autor) {
    email = normalizarEmail(email);
    nome = String(nome || '').trim();
    if (!EMAIL_OK.test(email) || email.length > 200) throw new ErroConta('e-mail inválido');
    if (!nome) throw new ErroConta('informe o nome');
    if (nome.length > 120) throw new ErroConta('nome longo demais');
    if (!PAPEIS.includes(papel)) throw new ErroConta('papel inválido');
    if (await usuarios.findOne({ email })) throw new ErroConta(`já existe um usuário com o e-mail ${email}`, 409);

    const senha = senhaProvisoria();
    const doc = {
      _id: crypto.randomUUID(), email, nome, papel,
      senhaHash: await hashSenha(senha), trocarSenha: true, ativo: true,
      criadoEm: new Date().toISOString(), criadoPor: autor ? { id: autor._id, nome: autor.nome } : 'terminal',
    };
    try { await usuarios.insertOne(doc); }
    catch (e) { if (e.code === 11000) throw new ErroConta(`já existe um usuário com o e-mail ${email}`, 409); throw e; }
    return { usuario: publico(doc), senhaProvisoria: senha };
  }

  /** Gera nova senha provisória e derruba as sessões abertas. */
  async function redefinirSenha(alvo) {
    const u = await buscar(alvo);
    const senha = senhaProvisoria();
    await usuarios.updateOne({ _id: u._id }, { $set: { senhaHash: await hashSenha(senha), trocarSenha: true } });
    await sessoes.deleteMany({ usuarioId: u._id });
    return { usuario: publico({ ...u, trocarSenha: true }), senhaProvisoria: senha };
  }

  async function definirAtivo(alvo, ativo, autor) {
    const u = await buscar(alvo);
    if (!ativo && autor && autor._id === u._id) throw new ErroConta('você não pode desativar a sua própria conta');
    if (!ativo && u.papel === 'admin' && u.ativo && (await adminsAtivos()) <= 1) {
      throw new ErroConta('é preciso manter pelo menos um administrador ativo');
    }
    await usuarios.updateOne({ _id: u._id }, { $set: { ativo: !!ativo } });
    if (!ativo) await sessoes.deleteMany({ usuarioId: u._id });
    return publico({ ...u, ativo: !!ativo });
  }

  async function definirPapel(alvo, papel, autor) {
    if (!PAPEIS.includes(papel)) throw new ErroConta('papel inválido');
    const u = await buscar(alvo);
    if (papel !== 'admin' && autor && autor._id === u._id) throw new ErroConta('você não pode retirar o seu próprio acesso de administrador');
    if (papel !== 'admin' && u.papel === 'admin' && u.ativo && (await adminsAtivos()) <= 1) {
      throw new ErroConta('é preciso manter pelo menos um administrador ativo');
    }
    await usuarios.updateOne({ _id: u._id }, { $set: { papel } });
    if (papel !== u.papel) await sessoes.deleteMany({ usuarioId: u._id });
    return publico({ ...u, papel });
  }

  async function renomear(alvo, nome) {
    nome = String(nome || '').trim();
    if (!nome || nome.length > 120) throw new ErroConta('nome inválido');
    const u = await buscar(alvo);
    await usuarios.updateOne({ _id: u._id }, { $set: { nome } });
    return publico({ ...u, nome });
  }

  return { listar, criar, redefinirSenha, definirAtivo, definirPapel, renomear };
}

module.exports = { criarContas, ErroConta, publico, PAPEIS };
