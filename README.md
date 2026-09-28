# Campo IAM · Maringá

Painel de acompanhamento de campo do Contrato 007/2025 (IAM / UNILIVRE) —
mapa interativo com as camadas das Metas 01 (Estabilidade de Encostas) e
03 (Microdrenagem Urbana), base cartográfica e registros de campo.

Site publicado via GitHub Pages.

## Estrutura

```
index.html      estrutura da página (cabeçalho, barra lateral, mapa, formulários)
css/style.css   aparência
js/app.js       lógica do mapa, camadas, formulário, importação/exportação
data/           uma camada por arquivo GeoJSON
```

| Arquivo | Camada | Geometria |
|---|---|---|
| `lider_areas.geojson` | Áreas LIDER (Meta 01) | Polygon |
| `prio_erosao.geojson` | Prioridade Erosão (Meta 01) | Point |
| `sond_spt.geojson` | Sondagem SPT/SM (Meta 01) | Point |
| `sond_ai.geojson` | Caracterização de solo (Meta 01) | Point |
| `areas_prio.geojson` | Cadastro Microdrenagem (Meta 03) | Polygon |
| `ac_criticas.geojson` | Áreas Críticas (Meta 03) | Polygon |
| `ac_pontos.geojson` | Pontos Críticos (Meta 03) | Point |
| `ble_guaipo.geojson` | Bocas de lobo – Guaipó (Meta 03) | Point |
| `sec_feito.geojson` | Seções topográficas concluídas | Point |
| `sec_pend.geojson` | Seções topográficas pendentes | Point |
| `subbacias.geojson` | Sub-bacias IAM | Polygon |
| `hidrografia.geojson` | Hidrografia | LineString |

## Rodar localmente

Os dados são carregados com `fetch`, que **não funciona** abrindo o
`index.html` com duplo clique (`file://`). Use um servidor local:

- **VS Code:** instale a extensão *Live Server*, clique com o botão direito no
  `index.html` → *Open with Live Server*.
- **Terminal:** `python -m http.server 8000` e abra http://localhost:8000

## Atualizar uma camada

1. No QGIS, exporte a camada como **GeoJSON** em **EPSG:4326 (WGS 84)**.
   Atenção: no GeoJSON a ordem é `[longitude, latitude]`.
2. Mantenha os nomes de atributos que o mapa usa (ex.: `name`; nas seções
   `cod`, `bacia`, `micro`; nas sondagens `ponto`, `ensaio`, `status`).
3. Substitua o arquivo em `data/`, teste com o Live Server, faça commit e push.
   O GitHub Pages atualiza o site em 1–2 minutos.

## Registros de campo

Os registros criados pelo botão "Marcar ponto" ficam salvos apenas no
navegador de quem os criou (`localStorage`). Para compartilhar, use
"⬇ CSV" (copia para a área de transferência).
