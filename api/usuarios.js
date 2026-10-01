/* ═══════════════════════════════════════════════════════════════
   Gerenciar usuários (uso do administrador, pelo terminal)

   npm run usuarios -- criar email@exemplo.com "Nome Completo" [--admin]
   npm run usuarios -- listar
   npm run usuarios -- redefinir email@exemplo.com
   npm run usuarios -- desativar email@exemplo.com
   npm run usuarios -- ativar email@exemplo.com

   (O mesmo pode ser feito pela tela "Usuários" da página, por um administrador.)

   "criar" e "redefinir" mostram uma SENHA PROVISÓRIA uma única vez.
   Passe-a para a pessoa por um canal seguro; ela será obrigada a
   trocar no primeiro acesso.
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const { conectar } = require('./db');
const { criarContas } = require('./contas');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'campo_iam';

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
  const contas = criarContas(conexao);
  const [acao, ...resto] = args;
  const flags = resto.filter(a => a.startsWith('--'));
  const [email, nome] = resto.filter(a => !a.startsWith('--'));
  if (['redefinir', 'desativar', 'ativar'].includes(acao) && !email) throw new Error('informe o e-mail');

  switch (acao) {
    case 'criar': {
      if (!nome || !String(nome).trim()) throw new Error('informe o nome entre aspas, ex.: "Maria Silva"');
      const papel = flags.includes('--admin') ? 'admin' : 'usuario';
      const r = await contas.criar({ email, nome, papel });
      console.log(`\n✔ Usuário criado (${papel === 'admin' ? 'administrador' : 'usuário'}).`);
      mostrarSenha(r.usuario.email, r.senhaProvisoria);
      return;
    }
    case 'listar': {
      const lista = await contas.listar();
      if (!lista.length) { console.log('\nNenhum usuário cadastrado.\n'); return; }
      console.log('');
      for (const u of lista) {
        const estado = !u.ativo ? 'DESATIVADO' : (u.trocarSenha ? 'aguardando 1º acesso' : 'ativo');
        console.log(`  ${u.nome.padEnd(28)} ${u.email.padEnd(34)} ${u.papel.padEnd(8)} ${estado}` +
          (u.ultimoAcesso ? `  · último acesso ${u.ultimoAcesso.slice(0, 16).replace('T', ' ')}` : ''));
      }
      console.log('');
      return;
    }
    case 'redefinir': {
      const r = await contas.redefinirSenha({ email });
      console.log(`\n✔ Senha de ${r.usuario.nome} redefinida.`);
      mostrarSenha(r.usuario.email, r.senhaProvisoria);
      return;
    }
    case 'desativar':
    case 'ativar': {
      // pelo terminal não há "autor": serve também para emergências
      const u = await contas.definirAtivo({ email }, acao === 'ativar', null);
      console.log(`\n✔ ${u.nome} ${u.ativo ? 'reativado' : 'desativado (não consegue mais entrar)'}.\n`);
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
