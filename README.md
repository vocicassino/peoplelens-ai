# PeopleLens AI V2.8 — Veicoli + Face Detection anonimo

PWA per conteggio persone, tracking anonimo, varchi IN/OUT, Long Range, rilevamento veicoli e anomalie direttamente sul dispositivo.

## Funzioni incluse

- Riconosce e distingue **persona, auto, moto e bicicletta** con COCO-SSD.
- Mostra conteggi LIVE separati e riquadri con etichette diverse sul video.
- Aggiunge **Face Detection** con BlazeFace: i volti sono rilevati ma **non identificati biometricamente**.
- Ogni volto riceve un ID temporaneo `F1`, `F2`… e, quando possibile, viene associato alla traccia persona `P1`, `P2`… della stessa inquadratura.
- Pulsante **🙂 Volti** in fullscreen con scheda LIVE dedicata.
- Selezionando un volto nella scheda o direttamente sul video, il suo riquadro viene evidenziato.
- Le miniature volto sono ritagli LIVE del fotogramma corrente e **non vengono salvate**.
- Mantiene Long Range, Zona AI prioritaria, multi-varco, Pose AI, anomalie, heatmap, tracking e CSV.
- **V2.8:** conta i transiti IN/OUT di auto, moto e biciclette per ogni varco e mostra riepiloghi di sessione e giornalieri.

## Privacy

La V2.8 non contiene riconoscimento dell'identità, confronto con gallerie di persone, nomi automatici o database biometrici. Il modulo volto serve solo a rilevare e seguire anonimamente un volto nella sessione corrente.

## Installazione GitHub Pages

Carica tutti i file nella root del repository e abilita GitHub Pages da `Settings > Pages > Deploy from a branch > main / root`. Dopo un aggiornamento chiudi completamente la PWA/browser e riaprila per caricare la cache `peoplelens-shell-v2.8.0`.

## Modelli

- TensorFlow.js
- COCO-SSD: persone / auto / moto / biciclette / oggetti
- MoveNet MultiPose: postura
- BlazeFace: rilevamento volto anonimo

## Nota

Il rilevamento può sbagliare con distanza elevata, poca luce, occlusioni, forti prospettive o dispositivi poco potenti. Non è un sistema di sicurezza certificato.


## V2.8 · Transiti veicoli
- Auto, moto e biciclette hanno tracking separato dalle persone.
- Ogni attraversamento di un varco viene contato come IN/OUT per classe.
- Conteggi di sessione, riepilogo per singolo varco e totale giornaliero derivato dal registro locale.
- Il CSV include classe veicolo, direzione e snapshot dei totali.
- I transiti dei veicoli non modificano il conteggio delle persone presenti.
