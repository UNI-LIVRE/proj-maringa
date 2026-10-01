# API — registros de campo

Servidor Node.js + MongoDB que guarda os registros de campo e as fotos,
com login. A própria API também serve a página: abra **http://localhost:3000**.

O GitHub Pages (e o Live Server) continuam funcionando como demonstração:
sem login, salvando só no navegador.

## Primeira vez

1. Instale o **Node.js LTS** e o **MongoDB Community Server** (como serviço do Windows).
2. No terminal do VS Code:

   ```
   cd api
   npm install
   copy .env.example .env
   ```

   (no Mac/Linux: `cp .env.example .env`)

3. Crie o primeiro usuário (você, como administrador):

   ```
   npm run usuarios -- criar seu@email.com "Seu Nome" --admin
   ```

   Anote a **senha provisória** que aparece — ela não é mostrada de novo.

## Rodar

```
cd api
npm run dev
```

Abra **http://localhost:3000**, entre com o e-mail e a senha provisória
e crie a sua senha. Deixe o terminal aberto enquanto usa.

## Usuários (administrador)

| Comando | O que faz |
|---|---|
| `npm run usuarios -- criar email "Nome"` | cria usuário e mostra a senha provisória |
| `npm run usuarios -- criar email "Nome" --admin` | idem, como administrador |
| `npm run usuarios -- listar` | lista usuários, situação e último acesso |
| `npm run usuarios -- redefinir email` | nova senha provisória (para "esqueci a senha") |
| `npm run usuarios -- desativar email` | bloqueia o acesso e encerra as sessões abertas |
| `npm run usuarios -- ativar email` | libera de novo |

Passe a senha provisória por um canal seguro (pessoalmente, mensagem
direta). A pessoa é obrigada a trocá-la no primeiro acesso.

## Segurança

- Senhas guardadas só como hash (scrypt) — ninguém consegue ver a senha, nem no banco.
- Sessão em cookie `HttpOnly` + `SameSite=Strict`: o JavaScript da página não lê o cookie
  e outros sites não conseguem usá-lo. No banco fica só o hash da sessão.
- Sem login, **todas** as rotas de dados respondem 401 — no navegador, no Python, no Postman.
  As camadas do mapa (`/data`) também só abrem com login.
- Senha provisória: os dados ficam bloqueados até a troca, inclusive pela API.
- 5 senhas erradas numa conta → conta bloqueada 15 min; 30 erros do mesmo IP → IP bloqueado 15 min.
- Gravações vindas de outro site são recusadas (verificação de origem).
- Cada registro guarda quem criou, quem alterou por último e quem excluiu.
- A pasta `api/` (com o `.env`) nunca é servida para o navegador.

## Ver os dados

MongoDB Compass → `mongodb://127.0.0.1:27017` → banco **campo_iam**:

- `registros` — um documento por registro de campo (descrição dentro de `properties`)
- `fotos.files` / `fotos.chunks` — as fotos
- `usuarios` — contas (sem senha legível)
- `sessoes` — logins ativos (apagadas sozinhas quando vencem)

Lembre de clicar em **Find** para atualizar a lista de documentos.

## Carregar um backup no banco

```
npm run importar -- C:\caminho\campo-iam-backup-AAAA-MM-DD.json
```

Mostra só a prévia. Para gravar, repita com `--aplicar` no final.
Só insere registros novos; nunca altera nem apaga o que já está no banco.

## Rotas

| Método | Rota | Login? | O que faz |
|---|---|---|---|
| GET | `/api/saude` | não | verifica API e banco |
| POST | `/api/auth/login` | não | entra (`{ email, senha }`) |
| POST | `/api/auth/logout` | não | sai |
| GET | `/api/auth/eu` | não | quem está logado (401 se ninguém) |
| POST | `/api/auth/senha` | sim | troca a senha |
| GET | `/api/registros` | sim | registros ativos (`?incluirExcluidos=1` para todos) |
| GET | `/api/registros/:id` | sim | um registro |
| PUT | `/api/registros/:id` | sim | cria ou atualiza |
| DELETE | `/api/registros/:id` | sim | exclusão marcada (não apaga) |
| POST | `/api/fotos` | sim | envia imagem (corpo = arquivo) |
| GET | `/api/fotos/:id` | sim | baixa a imagem |
| DELETE | `/api/fotos/:id` | sim | apaga a imagem |

## Para a nuvem (futuro)

No servidor, o `.env` muda `MONGODB_URI` (Atlas) e ativa `NODE_ENV=production`
(cookie só por HTTPS, HSTS, IP real atrás do balanceador). O site passa a ser
aberto pelo endereço da API — não é preciso mexer no `config.js`.
