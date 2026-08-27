# PeopleLens AI V3.0 — Setup rapido

## A. Solo più telefoni
1. Pubblica la cartella principale su GitHub Pages.
2. Crea un database Cloudflare D1 chiamato `peoplelens-sync`.
3. Apri la console D1 ed esegui `worker/schema.sql`.
4. Crea un Cloudflare Worker e usa il contenuto di `worker/worker.js`.
5. Aggiungi il binding D1:
   - nome binding: `DB`
   - database: `peoplelens-sync`
6. Aggiungi:
   - `ALLOWED_ORIGIN` = origine GitHub Pages, per esempio `https://nome.github.io`
   - secret `ROOM_TOKEN` = una chiave lunga scelta da te
7. Pubblica il Worker e copia il suo URL HTTPS.
8. Su ogni telefono, in PeopleLens:
   - abilita `Collega questo nodo`
   - assegna un nome diverso
   - usa lo stesso codice sito/stanza
   - inserisci lo stesso endpoint Worker
   - inserisci la stessa chiave
9. Apri `control-room.html` e usa gli stessi dati.

## B. Telecamera di sorveglianza che ha già HLS HTTPS
1. In PeopleLens scegli `Telecamera IP · HLS`.
2. Inserisci l'URL `.m3u8`.
3. Premi `Avvia`.
4. Se compare un errore CORS, il server della telecamera deve autorizzare l'origine GitHub Pages.

## C. Telecamera RTSP / ONVIF
1. Installa MediaMTX su un PC, mini-PC, NAS compatibile o Raspberry Pi nella stessa rete.
2. Parti da `bridge/mediamtx.yml.example`.
3. Inserisci l'URL RTSP della telecamera.
4. Esponi HLS in HTTPS con certificato valido o tramite reverse proxy HTTPS.
5. In PeopleLens usa l'URL:
   `https://TUO-BRIDGE/cam1/index.m3u8`

Non esporre direttamente RTSP su Internet.

## D. Analizzare il visualizzatore già aperto
Su desktop scegli `Schermo / finestra`.
Il browser chiederà quale finestra/scheda condividere. Seleziona il visualizzatore della telecamera.
PeopleLens analizzerà il flusso catturato e disegnerà i propri overlay.

Questa modalità richiede un'autorizzazione esplicita ogni volta e non è garantita sui browser mobili.

## E. Telecamera Arenti / firmware 5.2.6.x
1. Apri l'app della telecamera.
2. Vai in `Impostazioni > Funzioni avanzate > ONVIF`.
3. Abilita ONVIF e crea una password dedicata.
4. La telecamera espone normalmente:
   - ONVIF: porta `8000`
   - RTSP: porta `8554`
   - URL principale: `rtsp://admin:PASSWORD@IP:8554/Streaming/Channels/101`
5. In PeopleLens apri `Configura telecamera ONVIF / RTSP`, inserisci IP e password e premi `Genera configurazione`.
6. Avvia MediaMTX usando il file `mediamtx.yml` generato.
7. Esporre il bridge in HTTPS è necessario se PeopleLens è pubblicata su GitHub Pages HTTPS.
