# API — registros de campo

Servidor Node.js + MongoDB que guarda os registros de campo e as fotos.
A página (`index.html`) usa esta API automaticamente quando é aberta pelo
Live Server. No GitHub Pages ela continua salvando só no navegador.

## Primeira vez

1. Instale o **Node.js LTS** e o **MongoDB Community Server** (como serviço do Windows).
2. No terminal do VS Code:

   ```
   cd api
   npm install
   copy .env.example .env
   ```

   (no Mac/Linux: `cp .env.example .env`)

## Rodar

```
cd api
npm run dev
```

Deve aparecer `✔ API rodando em http://localhost:3000/api`.
Deixe esse terminal aberto e abra a página pelo Live Server.
O selo no cabeçalho mostra **● Banco de dados** quando está conectado.

Teste rápido no navegador: http://localhost:3000/api/saude

## Ver os dados

Abra o **MongoDB Compass**, conecte em `mongodb://127.0.0.1:27017`,
banco **campo_iam**:

- `registros` — um documento por registro de campo
- `fotos.files` / `fotos.chunks` — as fotos

## Carregar um backup no banco

```
npm run importar -- C:\caminho\campo-iam-backup-AAAA-MM-DD.json
```

Mostra só a prévia. Para gravar, repita com `--aplicar` no final.
Só insere registros novos; nunca altera nem apaga o que já está no banco.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/saude` | verifica API e banco |
| GET | `/api/registros` | registros ativos (`?incluirExcluidos=1` para todos) |
| GET | `/api/registros/:id` | um registro |
| PUT | `/api/registros/:id` | cria ou atualiza |
| DELETE | `/api/registros/:id` | exclusão marcada (não apaga) |
| POST | `/api/fotos` | envia uma imagem (corpo = arquivo) |
| GET | `/api/fotos/:id` | baixa a imagem |
| DELETE | `/api/fotos/:id` | apaga a imagem |

## Para a nuvem (futuro)

Mudam só as variáveis do `.env` no servidor: `MONGODB_URI` (ex.: MongoDB Atlas)
e `CORS_ORIGINS` (endereço do site). Na página, o endereço da API vai em
`js/config.js`. Antes de publicar, falta adicionar o login.
