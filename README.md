# PeopleLens AI V2.1

PWA per GitHub Pages che usa la fotocamera del telefono per contare persone e segnalare anomalie direttamente sul dispositivo.


## Novità V2.1

- tocca direttamente il riquadro di una persona per selezionarla
- evidenziazione gialla della traccia selezionata
- scheda LIVE sovrapposta al video con permanenza, velocità, postura e confidenza AI
- ultimo attraversamento ingresso/uscita con orario
- posizione rispetto alla linea e alla zona riservata
- livello anomalia per la singola traccia: Normale, Attenzione o Critico
- badge delle anomalie associate alla persona
- chiusura rapida della scheda e aggiornamento continuo finché la traccia resta disponibile

## Novità V2

- avvio immediato in visualizzazione fotocamera a schermo intero
- video `cover` a pieno schermo con HUD sovrapposto
- pulsante `✕` per tornare alla dashboard mantenendo la fotocamera attiva
- COCO-SSD per rilevamento persone e oggetti
- MoveNet MultiPose per scheletro corporeo e supporto al rilevamento di possibile caduta/persona a terra
- escalation se la postura a terra persiste
- fallback automatico al metodo geometrico se MoveNet non è disponibile
- heatmap locale delle zone più frequentate
- permanenza media delle tracce completate
- rilevamento di assembramento locale configurabile

## Funzioni già presenti

- conteggio persone visibili
- tracking anonimo con ID temporanei
- ingressi/uscite tramite linea virtuale
- presenti stimati, picco e affollamento
- zona riservata disegnabile sul video
- permanenza insolita
- movimento rapido
- aumento improvviso
- presenza fuori orario
- possibile oggetto incustodito
- camera scura/ostruita
- registro eventi locale IndexedDB
- esportazione CSV
- PWA installabile
- nessun riconoscimento facciale e nessuna fotografia salvata

## Pubblicazione GitHub Pages

Sostituisci i file della V1 con quelli della V2 mantenendo la cartella `icons`. In **Settings → Pages** usa `Deploy from a branch`, branch `main`, cartella `/ (root)`.

Dopo l'aggiornamento, se il telefono mostra ancora la V1, chiudi completamente la PWA/browser e riaprila: il Service Worker V2 usa una nuova cache.

## Uso a schermo intero

Premendo **Avvia**, PeopleLens entra subito in modalità immersiva e prova anche a usare la Fullscreen API del browser. Se il browser non concede il fullscreen nativo, la UI usa comunque una modalità immersiva CSS che occupa l'intera area disponibile. I controlli Stop, Fotocamera e Disegna zona restano sovrapposti al video.

## Privacy

L'elaborazione è locale. Gli ID `P1`, `P2`, ecc. sono temporanei. L'app non effettua riconoscimento facciale e non salva immagini.

## Nota sicurezza

Le anomalie sono indicatori da verificare. Il rilevamento di possibile caduta/persona a terra non sostituisce sistemi di sicurezza certificati o la verifica umana.
