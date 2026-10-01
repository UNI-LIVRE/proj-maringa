/* ═══════════════════════════════════════════════════════════════
   Gerenciar usuários (uso do administrador, pelo terminal)

   npm run usuarios -- criar email@exemplo.com "Nome Completo" [--admin]
   npm run usuarios -- listar
   npm run usuarios -- redefinir email@exemplo.com
   npm run usuarios -- desativar email@exemplo.com
   npm run usuarios -- ativar email@exemplo.com

   "criar" e "redefinir" mostram uma SENHA PROVISÓRIA uma única vez.
   Passe-a para a pessoa por um canal seguro; ela será obrigada a
   trocar no primeiro acesso.
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const crypto = require('crypto');
const { conectar } = require('./db');
const { hashSenha, senhaProvisoria, normalizarEmail } = require('./auth');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'campo_iam';
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AJUDA = `
Uso:
  npm run usuarios -- criar email@exemplo.com "Nome Completo" [--admin]
  npm run usuarios -- listar
  npm run usuarios -- redefinir email@exemplo.com
  npm run usuarios -- desativar email@exemplo.com
  npm run usuarios -- ativar email@exemplo.com
`;

function mostrarSenha(email, senha) {
  console.log(`\n  E-mail:           ${email}`);
  console.log(`  Senha provisória: ${senha}\n`);
  console.log('  Esta senha não será mostrada de novo. A pessoa terá que trocá-la no primeiro acesso.\n');
}

async function executar(conexao, args) {
  const { usuarios, sessoes } = conexao;
  const [acao, ...resto] = args;
  const flags = resto.filter(a => a.startsWith('--'));
  const [emailBruto, nome] = resto.filter(a => !a.startsWith('--'));
  const email = normalizarEmail(emailBruto);

  async function buscar() {
    if (!email) throw new Error('informe o e-mail');
    const u = await usuarios.findOne({ email });
    if (!u) throw new Error(`não existe usuário com o e-mail ${email}`);
    return u;
  }

  switch (acao) {
    case 'criar': {
      if (!EMAIL_OK.test(email)) throw new Error('e-mail inválido');
      if (!nome || !nome.trim()) throw new Error('informe o nome entre aspas, ex.: "Maria Silva"');
      if (await usuarios.findOne({ email })) throw new Error(`já existe um usuário com o e-mail ${email}`);
      const senha = senhaProvisoria();
      await usuarios.insertOne({
        _id: crypto.randomUUID(), email, nome: nome.trim().slice(0, 120),
        papel: flags.includes('--admin') ? 'admin' : 'usuario',
        senhaHash: await hashSenha(senha), trocarSenha: true, ativo: true,
        criadoEm: new Date().toISOString(),
      });
      console.log(`\n✔ Usuário criado (${flags.includes('--admin') ? 'administrador' : 'usuário'}).`);
      mostrarSenha(email, senha);
      return;
    }
    case 'listar': {
      const lista = await usuarios.find({}).sort({ nome: 1 }).toArray();
      if (!lista.length) { console.log('\nNenhum usuário cadastrado.\n'); return; }
      console.log('');
      for (const u of lista) {
        const estado = !u.ativo ? 'DESATIVADO' : (u.trocarSenha ? 'aguardando 1º acesso' : 'ativo');
        console.log(`  ${u.nome.padEnd(28)} ${u.email.padEnd(34)} ${(u.papel || 'usuario').padEnd(8)} ${estado}` +
          (u.ultimoAcesso ? `  · último acesso ${u.ultimoAcesso.slice(0, 16).replace('T', ' ')}` : ''));
      }
      console.log('');
      return;
    }
    case 'redefinir': {
      const u = await buscar();
      const senha = senhaProvisoria();
      await usuarios.updateOne({ _id: u._id }, { $set: { senhaHash: await hashSenha(senha), trocarSenha: true } });
      await sessoes.deleteMany({ usuarioId: u._id });   // derruba sessões abertas
      console.log(`\n✔ Senha de ${u.nome} redefinida.`);
      mostrarSenha(email, senha);
      return;
    }
    case 'desativar':
    case 'ativar': {
      const u = await buscar();
      const ativo = acao === 'ativar';
      await usuarios.updateOne({ _id: u._id }, { $set: { ativo } });
      if (!ativo) await sessoes.deleteMany({ usuarioId: u._id });
      console.log(`\n✔ ${u.nome} ${ativo ? 'reativado' : 'desativado (não consegue mais entrar)'}.\n`);
      return;
    }
    default:
      console.log(AJUDA);
  }
}

async function main() {
  const conexao = await conectar(MONGODB_URI, MONGODB_DB);
  try { await executar(conexao, process.argv.slice(2)); }
  finally { await conexao.client.close(); }
}

if (require.main === module) {
  main().catch(e => {
    console.error('\n✖ ' + (e.message.includes('ECONNREFUSED') ? 'MongoDB não está rodando.' : e.message) + '\n');
    process.exit(1);
  });
}
module.exports = { executar };
