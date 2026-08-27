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
