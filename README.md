# PeopleLens AI V2.7 — Veicoli + Face Detection anonimo

PWA per conteggio persone, tracking anonimo, varchi IN/OUT, Long Range, rilevamento veicoli e anomalie direttamente sul dispositivo.

## Novità V2.7

- Riconosce e distingue **persona, auto, moto e bicicletta** con COCO-SSD.
- Mostra conteggi LIVE separati e riquadri con etichette diverse sul video.
- Aggiunge **Face Detection** con BlazeFace: i volti sono rilevati ma **non identificati biometricamente**.
- Ogni volto riceve un ID temporaneo `F1`, `F2`… e, quando possibile, viene associato alla traccia persona `P1`, `P2`… della stessa inquadratura.
- Pulsante **🙂 Volti** in fullscreen con scheda LIVE dedicata.
- Selezionando un volto nella scheda o direttamente sul video, il suo riquadro viene evidenziato.
- Le miniature volto sono ritagli LIVE del fotogramma corrente e **non vengono salvate**.
- Mantiene tutte le funzioni V2.6: Long Range, Zona AI prioritaria, multi-varco, Pose AI, anomalie, heatmap, tracking e CSV.

## Privacy

La V2.7 non contiene riconoscimento dell'identità, confronto con gallerie di persone, nomi automatici o database biometrici. Il modulo volto serve solo a rilevare e seguire anonimamente un volto nella sessione corrente.

## Installazione GitHub Pages

Carica tutti i file nella root del repository e abilita GitHub Pages da `Settings > Pages > Deploy from a branch > main / root`. Dopo un aggiornamento chiudi completamente la PWA/browser e riaprila per caricare la cache `peoplelens-shell-v2.7.0`.

## Modelli

- TensorFlow.js
- COCO-SSD: persone / auto / moto / biciclette / oggetti
- MoveNet MultiPose: postura
- BlazeFace: rilevamento volto anonimo

## Nota

Il rilevamento può sbagliare con distanza elevata, poca luce, occlusioni, forti prospettive o dispositivi poco potenti. Non è un sistema di sicurezza certificato.
