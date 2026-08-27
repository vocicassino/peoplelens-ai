# PeopleLens AI V2.6 — Long Range

PWA per conteggio persone, tracking anonimo, varchi IN/OUT e rilevamento anomalie direttamente sul dispositivo. Non esegue riconoscimento facciale e non salva fotografie.

## Novità V2.6

### 🔭 Long Range AI
Tre modalità selezionabili anche durante la visualizzazione LIVE:

- **⚡ Veloce** — analizza il fotogramma completo, ideale per persone vicine e FPS più alti.
- **⚖ Bilanciata** — fotogramma completo + Zona AI prioritaria; se la zona non è impostata analizza a rotazione anche un settore ingrandito.
- **🔭 Lunga distanza** — fotogramma completo + Zona AI prioritaria + settori ingranditi a rotazione. È più sensibile alle persone piccole ma usa più potenza e riduce gli FPS.

Le rilevazioni provenienti da crop ingranditi vengono riportate alle coordinate originali e fuse con NMS/IoU per ridurre i doppi conteggi.

### 🎯 Zona AI prioritaria
Premi **Zona AI** e trascina un rettangolo direttamente sul video (ad esempio marciapiede, cancello o ingresso lontano). In modalità Bilanciata/Lunga distanza quel rettangolo viene analizzato separatamente, così una persona lontana occupa una porzione maggiore dell'immagine data al modello.

Sul video:
- verde = rilevazione fotogramma completo;
- azzurro `LR🎯` = rilevazione dalla Zona AI prioritaria;
- viola `LR` = rilevazione da un settore Long Range;
- giallo = persona selezionata;
- rosso = possibile condizione critica/caduta.

### 🔍 Zoom hardware
Se la fotocamera/browser espone la capability `zoom`, compaiono i controlli **− / x / +** in fullscreen. Lo zoom viene applicato alla traccia video reale tramite `MediaStreamTrack.applyConstraints()`. Su dispositivi che non lo espongono i controlli restano nascosti.

### 📷 Acquisizione
La fotocamera richiede fino a 1920×1080 come risoluzione ideale. Il browser/telefono può comunque fornire una risoluzione inferiore.

## Funzioni mantenute

- fullscreen automatico all'avvio;
- tracking anonimo P1, P2…;
- scheda LIVE e Follow con traiettoria;
- fino a 6 varchi indipendenti;
- linea IN/OUT libera, ruotabile e calibrabile con due tocchi;
- controllo rapido V1/V2/V3… in fullscreen;
- conteggio IN/OUT e presenti stimati;
- Pose AI / MoveNet MultiPose;
- caduta/persona a terra, permanenza, movimento rapido, zona riservata, aumento improvviso, fuori orario, oggetto incustodito, camera oscurata, assembramento, movimento ripetitivo, sosta in zona e direzione vietata;
- heatmap locale;
- registro eventi ed esportazione CSV;
- PWA installabile.

## Suggerimento per persone lontane

1. Inquadra la zona interessata con la fotocamera posteriore.
2. Premi **🔭 Lunga distanza**.
3. Premi **🎯 Zona AI** e disegna un rettangolo solo su strada/marciapiede/varco da controllare.
4. Se disponibile, usa lo zoom hardware senza esagerare per non restringere troppo il campo.
5. Mantieni inizialmente la confidenza intorno al 50–55%. Abbassarla troppo aumenta i falsi positivi.

## GitHub Pages

Carica il contenuto della cartella `peoplelens-ai` nella root del repository. In **Settings → Pages** usa `Deploy from a branch`, branch `main`, cartella `/ (root)`.

Il Service Worker V2.6 usa la cache `peoplelens-shell-v2.6.0`. Dopo l'aggiornamento chiudi completamente la PWA/browser e riaprila.

## Limiti

Il Long Range migliora la probabilità di rilevare persone piccole, ma non può ricreare dettagli che la fotocamera non ha registrato. Distanza estrema, controluce, occlusioni, mosso e persone di pochissimi pixel possono ancora non essere rilevati. L'app non è un sistema di sicurezza certificato.
