# V3.0.1

- Corretto errore bloccante ES module: doppia dichiarazione `stopTracks()` in `app.js`.
- Cache PWA aggiornata a `peoplelens-shell-v3.0.1` per forzare il caricamento dei file corretti.
- Nessuna funzione V3 rimossa.

# V3.0
- Multi-nodo: collegamento di più telefoni alla stessa Control Room.
- Cloudflare Worker + D1 opzionale per sincronizzare metadati ogni ~1,5 s.
- Nuova pagina `control-room.html` con stato online/offline, conteggi e anomalie per nodo.
- Sorgenti video: fotocamera telefono, Screen Capture desktop, HLS.
- Supporto a telecamere RTSP/ONVIF tramite bridge MediaMTX -> HLS.
- Verifica HTTPS/mixed-content e test accesso pixel/CORS per i flussi remoti.
- Nessun invio automatico di video o volti alla Control Room.
- Cache PWA aggiornata a `peoplelens-shell-v3.0.0`.

# PeopleLens AI V2.8

- Conteggio IN/OUT separato per auto, moto e biciclette.
- Statistiche per singolo varco e totali di sessione.
- Riepilogo giornaliero ricostruito dal registro locale.
- CSV esteso con classe/direzione veicolo e contatori dedicati.
- Tracking veicoli aggiornato con posizione precedente e stato varco.

# V2.7 — Veicoli + Face Detection anonimo

- Distinzione LIVE tra persone, auto, moto e biciclette.
- Tracker separato per veicoli.
- Nuovo HUD con conteggi per categoria.
- BlazeFace per rilevare volti senza identificarne l’identità.
- ID volto temporanei F1, F2… e associazione alla traccia P quando geometricamente compatibile.
- Scheda Volti LIVE con miniature non persistenti e selezione/evidenziazione sul video.
- Cache Service Worker aggiornata a V2.7.
- Export CSV rinominato per V2.7.

---

# V2.6 — Long Range

- Aggiunte modalità AI: Veloce, Bilanciata e Lunga distanza.
- Analisi a crop/settori per aumentare la dimensione relativa delle persone lontane.
- Aggiunta Zona AI prioritaria disegnabile direttamente sul video.
- Fusione delle rilevazioni full/crop tramite IoU per ridurre i duplicati.
- Colori diversi per rilevazioni FULL, LR e LR prioritaria.
- Badge LIVE con sorgenti di analisi (`AI FULL`, `AI FULL+PRIORITY`, `AI FULL+T1`, ecc.).
- Pulsante rapido per cambiare modalità AI durante la ripresa.
- Richiesta fotocamera fino a 1920×1080 come valore ideale.
- Supporto zoom hardware quando esposto dal browser/dispositivo.
- Zona AI salvata nelle impostazioni locali e rimovibile dalla dashboard.
- Cache Service Worker aggiornata a V2.6.
- Export CSV rinominato per V2.6.

# V2.5

- Controllo rapido multi-varco in fullscreen.
- Selezione e attivazione/disattivazione V1/V2/V3… direttamente sulla telecamera.

# V2.4

- Calibrazione varco con due tocchi.
- Fino a 6 varchi indipendenti.

# V2.3

- Linea IN/OUT libera, ruotabile e spostabile.

# V2.2

- Follow persona e traiettoria.
- Movimento ripetitivo, sosta prolungata in zona e direzione vietata.

# V2.1

- Scheda persona LIVE.

# V2

- Fullscreen, MoveNet Pose AI, heatmap e rilevamento anomalie esteso.

## V3.0 camera preset update
- Helper ONVIF/RTSP integrato nella dashboard.
- Preset Arenti P2/P2T/P2F (ONVIF 8000, RTSP 8554, channel 101/102).
- Generatore URL RTSP senza memorizzare la password ONVIF.
- Generatore/scaricamento configurazione `mediamtx.yml`.
- Impostazione automatica della sorgente HLS quando è disponibile un bridge HTTPS.
