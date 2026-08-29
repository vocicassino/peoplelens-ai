# PeopleLens Sync Worker

Il sito principale resta su GitHub Pages. Questo Worker serve soltanto per sincronizzare più nodi PeopleLens.

## Risorse
- 1 Cloudflare Worker
- 1 database D1 con binding `DB`
- secret `ROOM_TOKEN`
- variabile `ALLOWED_ORIGIN` con l'origine GitHub Pages, ad esempio `https://nome.github.io`

## Schema D1
Esegui `schema.sql` sul database D1.

## API
- `POST /api/push` — aggiornamento di un nodo
- `GET /api/nodes?room=CODICE` — stato di tutti i nodi
- `GET /api/health`
- `POST /api/cleanup`

Tutte le API, esclusa health, richiedono:
`Authorization: Bearer <ROOM_TOKEN>`

Il Worker non riceve video, foto o ritagli volto. Riceve solo metadati numerici, varchi e nomi delle anomalie.
