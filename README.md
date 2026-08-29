# PeopleLens AI V3.0

PWA per GitHub Pages che analizza video localmente con TensorFlow.js.

## Novità V3.0

### 1. Più telefoni / nodi
Ogni telefono continua a fare l'AI sul proprio dispositivo e può inviare alla **Control Room** soltanto:
- persone visibili, presenti, IN/OUT
- auto, moto e bici
- conteggi per varco
- anomalie attive
- stato/nome della sorgente

Non vengono inviati automaticamente video, foto o ritagli dei volti.

Per la sincronizzazione è incluso `worker/`, un piccolo Cloudflare Worker con D1. GitHub Pages da solo non può fare da server realtime condiviso.

### 2. Telecamera di sorveglianza
PeopleLens V3.0.2 supporta:
- `Fotocamera telefono`
- `Schermo / finestra` tramite Screen Capture, quando il browser lo supporta
- `Telecamera IP · HLS`

Se la telecamera espone soltanto RTSP/ONVIF, usa il bridge incluso in `bridge/` basato su MediaMTX per trasformare RTSP in HLS/WebRTC.

L'app non si inietta automaticamente sopra qualsiasi sito del produttore: i browser impediscono in molti casi di leggere i pixel di video cross-origin. La modalità consigliata è aprire il flusso direttamente in PeopleLens. Su desktop la modalità `Schermo / finestra` permette invece di scegliere manualmente la finestra del visualizzatore e analizzarne la cattura.

## Installazione GitHub Pages
Carica il contenuto di questa cartella nella root del repository e abilita Pages da `main / root`.

## Control Room
Apri:
`control-room.html`

Inserisci:
- Endpoint Sync
- Codice sito/stanza
- Chiave stanza

Gli stessi dati devono essere impostati su ogni telefono PeopleLens.

## Worker di sincronizzazione
Vedi `worker/README.md`.

## Telecamere RTSP
Vedi `bridge/README.md`.

## Nota HTTPS / CORS
GitHub Pages viene servito in HTTPS. Un flusso HLS HTTP può essere bloccato dal browser come mixed content. Per l'analisi il video deve inoltre essere leggibile da Canvas/TensorFlow, quindi il server del flusso deve autorizzare CORS per l'origine GitHub Pages.

## Privacy
Il modulo volto della V3.0 resta di rilevamento/tracking anonimo e non determina l'identità reale delle persone. Le miniature live non vengono archiviate dall'app.

### V3.0.2 — Local Bridge
Per un PeopleLens Bridge nella stessa rete del telefono puoi usare un URL come `http://192.168.1.40:8888/cam1/index.m3u8`. L’app esegue un test del Bridge e, sui browser compatibili, fa attivare il permesso **Accesso alla rete locale**. Per endpoint non locali continua a essere richiesto HTTPS.

