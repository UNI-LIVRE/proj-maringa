/* ═══════════════════════════════════════════════════════════════
   admin.js — rotas da tela "Usuários" (só administradores)

     GET   /api/admin/usuarios
     POST  /api/admin/usuarios                 { email, nome, papel }
     POST  /api/admin/usuarios/:id/redefinir
     PATCH /api/admin/usuarios/:id             { ativo?, papel?, nome? }

   Como o acesso é entregue depende de CONVITE_MODO (.env):
     senha → a senha provisória volta na resposta e aparece na tela
     email → (futuro) o sistema envia um link por e-mail
   ═══════════════════════════════════════════════════════════════ */
const express = require('express');
const { criarContas, ErroConta } = require('./contas');
const { validarId } = require('./registro');

function criarRotasAdmin(conexao, { conviteModo }) {
  const contas = criarContas(conexao);
  const router = express.Router();

  // só administradores (o login já foi exigido antes de chegar aqui)
  router.use((req, res, next) => {
    if (!req.usuario || req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'acesso restrito a administradores' });
    next();
  });
  router.param('id', (req, res, next, id) => (validarId(id) ? next() : res.status(400).json({ erro: 'id inválido' })));

  /** Entrega do acesso: hoje mostra a senha; com e-mail, enviará o convite. */
  function entregar(resultado) {
    if (conviteModo === 'senha') return { usuario: resultado.usuario, senhaProvisoria: resultado.senhaProvisoria };
    // ponto de troca para o passo 2 (convite por e-mail)
    throw new ErroConta('envio de convites por e-mail ainda não está configurado', 501);
  }

  router.get('/usuarios', async (req, res) => {
    res.json({ usuarios: await contas.listar(), conviteModo });
  });

  router.post('/usuarios', async (req, res) => {
    const { email, nome, papel } = req.body || {};
    res.status(201).json(entregar(await contas.criar({ email, nome, papel }, req.usuario)));
  });

  router.post('/usuarios/:id/redefinir', async (req, res) => {
    if (req.params.id === req.usuario._id) {
      throw new ErroConta('para a sua própria conta, use "Trocar senha" (clique no seu nome no topo)');
    }
    res.json(entregar(await contas.redefinirSenha({ id: req.params.id })));
  });

  router.patch('/usuarios/:id', async (req, res) => {
    const { ativo, papel, nome } = req.body || {};
    const alvo = { id: req.params.id };
    let u = null;
    if (nome !== undefined) u = await contas.renomear(alvo, nome);
    if (papel !== undefined) u = await contas.definirPapel(alvo, papel, req.usuario);
    if (ativo !== undefined) u = await contas.definirAtivo(alvo, !!ativo, req.usuario);
    if (!u) throw new ErroConta('nada para alterar');
    res.json({ usuario: u });
  });

  // erros das regras de conta viram mensagens para a tela
  router.use((err, req, res, next) => {
    if (err instanceof ErroConta) return res.status(err.status).json({ erro: err.message });
    next(err);
  });

  return router;
}

module.exports = { criarRotasAdmin };
