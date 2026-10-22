# Nebula Frontier V21 – 30/60 Hz umschalten

## Render (ohne Codeänderung)
1. Render Dashboard → dein Web Service → Environment.
2. Neue Variable `SERVER_HZ` mit Wert `30` oder `60` setzen.
3. Änderungen speichern und Service neu starten/deployen.
4. In den Render Logs erscheint `SERVER_HZ=30` oder `SERVER_HZ=60`.

Standard ohne Variable: **30 Hz**.

## Lokaler PC-Server
- macOS/Linux: `SERVER_HZ=60 npm start`
- Windows PowerShell: `$env:SERVER_HZ="60"; npm start`
- Windows CMD: `set SERVER_HZ=60 && npm start`

## Was wird umgeschaltet?
- Server-Physikschleife und Positions-Snapshots laufen nominell mit 30 bzw. 60 Hz.
- Die Browser-Grafik-FPS bleiben unabhängig einstellbar (30/60 FPS).
- Die Client-Steuerung sendet weiterhin ungefähr alle 85 ms Positionsmeldungen; höhere Server-Hz allein erhöhen diese Rate nicht.
- Die Zeitdifferenz `dt` hält die Bewegungsgeschwindigkeit unabhängig von der Tickrate.
- Langsame WebSocket-Verbindungen erhalten keine unbegrenzt aufgestauten State-Snapshots.

**Hinweis:** 60 Hz erzeugt etwa doppelt so viele Netzwerk-Snapshots und Physik-Ticks wie 30 Hz. Auf Render Free mit mehreren Spielern testen; Timer und CPU-Last können die tatsächlich erreichte Rate reduzieren. Änderungen an `SERVER_HZ` erfordern einen Neustart.
