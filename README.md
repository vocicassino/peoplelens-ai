# PeopleLens AI V2.5

PWA per GitHub Pages che usa la fotocamera del telefono per conteggio anonimo, tracking locale e rilevamento di anomalie.

## Novità V2.5

- **Controllo rapido varchi in fullscreen**: durante la telecamera a schermo intero compare la barra `V1`, `V2`, `V3`… fino a `V6`.
- Tocca il corpo di un varco per renderlo **attivo** senza uscire dalla fotocamera.
- Tocca **⏻ / ○** per attivare o disattivare il conteggio del singolo varco.
- Ogni pulsante mostra in tempo reale i conteggi **IN / OUT** del relativo passaggio.
- Il varco selezionato è evidenziato sia nella barra sia sulla linea disegnata nel video.
- La barra si nasconde automaticamente durante **Calibra varco** e **Disegna zona**, così non ostacola i tocchi sul video.
- Tutte le funzioni multi-varco della V2.4 sono mantenute.

## Varchi e calibrazione

1. Avvia la fotocamera: l'immagine passa a schermo intero.
2. Premi **⌁ Calibra varco** e tocca i due estremi reali del passaggio.
3. Puoi creare fino a **6 varchi indipendenti**.
4. Ogni varco può essere orizzontale, verticale o diagonale e dispone di direzione IN e direzione consentita proprie.
5. Trascina **A**, **B** o **✥ SPOSTA** per rifinire la linea.
6. Usa la barra V1–V6 in fullscreen per passare rapidamente da un varco all'altro o metterne uno OFF.

## Funzioni principali

- COCO-SSD per rilevamento persone e oggetti.
- MoveNet MultiPose con fallback geometrico.
- Conteggio persone, ingressi, uscite, presenti stimati, picco e affollamento.
- Scheda persona LIVE con ID temporaneo, postura, velocità, confidenza e anomalie.
- Follow e traiettoria temporale.
- Zona riservata, movimento ripetitivo, sosta prolungata, direzione vietata, possibile caduta/persona a terra, permanenza insolita, movimento rapido, picchi, assembramenti, fuori orario, possibile oggetto incustodito e camera scura/ostruita.
- Heatmap locale, registro IndexedDB ed esportazione CSV.
- Nessun riconoscimento facciale e nessuna fotografia salvata.

## Aggiornamento GitHub Pages

Sostituisci i file della versione precedente con quelli di questa cartella, compresa la cartella `icons`. Il Service Worker usa la cache `peoplelens-shell-v2.5.0`. Dopo il deploy chiudi completamente la PWA/browser e riaprila.

## Nota

Le anomalie sono indicatori probabilistici da verificare e non sostituiscono sistemi di sicurezza certificati o la verifica umana.
