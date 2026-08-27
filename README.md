# PeopleLens AI

PWA per contare persone e segnalare anomalie usando la fotocamera del telefono e TensorFlow.js/COCO-SSD direttamente nel browser.

## Funzioni

- conteggio persone visibili in tempo reale
- tracking anonimo con ID temporanei
- ingressi e uscite tramite linea virtuale
- stima presenti, picco e percentuale di affollamento
- zona riservata disegnabile sul video
- anomalie: sovraffollamento, permanenza insolita, possibile caduta, movimento rapido, aumento improvviso, presenza fuori orario, oggetto incustodito, camera scura/ostruita
- storico eventi locale in IndexedDB
- esportazione CSV
- PWA installabile
- nessun riconoscimento facciale e nessuna immagine salvata

## Pubblicazione su GitHub Pages

1. Crea un repository, ad esempio `peoplelens-ai`.
2. Carica tutti i file mantenendo la cartella `icons`.
3. Apri **Settings → Pages**.
4. In **Build and deployment**, scegli **Deploy from a branch**.
5. Seleziona `main` e `/ (root)`, poi **Save**.
6. Apri l'URL HTTPS generato da GitHub Pages sul telefono.
7. Concedi il permesso alla fotocamera e premi **Avvia**.

> La fotocamera web richiede HTTPS (GitHub Pages lo fornisce).

## Calibrazione consigliata

- Posiziona il telefono fermo, preferibilmente in alto e con vista obliqua sull'ingresso.
- Evita controluce e sovrapposizioni eccessive tra persone.
- Regola `Linea ingresso` dove le persone passano una alla volta o in gruppi piccoli.
- Calibra la soglia di confidenza (55% è un buon punto di partenza).
- Considera “possibile caduta”, “movimento rapido” e “oggetto incustodito” come segnalazioni da verificare, non eventi certi.

## Privacy

PeopleLens AI non identifica persone, non usa riconoscimento facciale e non salva fotografie. Gli ID `P1`, `P2`, ecc. sono temporanei e servono solo al tracking mentre una persona resta nell'inquadratura.

## Tecnologia

- HTML/CSS/JavaScript puro
- TensorFlow.js 4.22.0
- COCO-SSD 2.2.2 (`lite_mobilenet_v2`)
- getUserMedia
- IndexedDB
- Service Worker / Web App Manifest

## Limiti

Non è un sistema di videosorveglianza certificato. Il conteggio e le anomalie possono essere influenzati da luce, prospettiva, occlusioni, prestazioni del telefono e qualità della fotocamera. La possibile caduta è attualmente una euristica basata sulla forma del bounding box e sulla sua persistenza.
