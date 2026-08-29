# Telecamere di sorveglianza con PeopleLens

## Caso migliore: la telecamera fornisce HLS HTTPS
Inserisci direttamente l'URL `.m3u8` in PeopleLens.

## Telecamera RTSP / ONVIF
I browser non leggono normalmente RTSP direttamente. Avvia MediaMTX su un PC, mini-PC o Raspberry Pi nella stessa rete della telecamera e configura `mediamtx.yml`.

MediaMTX legge RTSP e lo rende disponibile al browser come HLS o WebRTC. PeopleLens V3.0.2 usa HLS per poter analizzare direttamente il tag `<video>`.

Esempio:
- camera: `rtsp://user:pass@192.168.1.50:554/...`
- MediaMTX: path `cam1`
- PeopleLens: `https://bridge.example.com/cam1/index.m3u8`

## HTTP LAN, HTTPS e CORS
PeopleLens V3.0.2 accetta un Bridge HTTP quando l'host è privato (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`). Nei browser compatibili viene richiesto il permesso **Accesso alla rete locale**; se concesso, il browser può rilassare il blocco mixed-content per la LAN.

Per bridge pubblici/remoti usa HTTPS. In ogni caso MediaMTX deve autorizzare l'origine GitHub Pages tramite CORS.

## Sicurezza
Non aprire la porta RTSP della telecamera direttamente verso Internet.
Per uso da fuori rete preferisci VPN/rete privata oppure un endpoint HTTPS autenticato.

## Preset Arenti P2/P2T/P2F
Per la famiglia firmware 5.2.6.x:
- ONVIF: porta `8000`
- RTSP: porta `8554`
- utente RTSP: `admin`
- stream principale: `/Streaming/Channels/101`
- stream secondario (se disponibile): `/Streaming/Channels/102`

Esempio:
`rtsp://admin:PASSWORD_ONVIF@192.168.1.102:8554/Streaming/Channels/101`

La password ONVIF va impostata dall'app della telecamera. Non usare la password dell'account cloud se l'app ti fa creare una password ONVIF separata.
