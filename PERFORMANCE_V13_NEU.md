# Nebula Frontier V13 – Multiplayer Performance + FPS/Ping

- Echt gemessene FPS (requestAnimationFrame) und WebSocket-Roundtrip-Ping in Millisekunden.
- HUD über Schaltfläche ein- und ausblendbar, Einstellung bleibt im Browser gespeichert.
- 10 serverseitige Welt-Snapshots pro Sekunde statt schwankendem modulo-Timer plus Extra-Snapshot jede Sekunde.
- Statische Schiff- und Kartendaten werden nicht mehr in jedem Snapshot gesendet.
- Bereits vorhandene Filterung nach Karte bleibt erhalten.
- Verhindert das Anstauen von Welt-Snapshots bei langsamen Verbindungen.
- UI wird höchstens etwa alle 300 ms aktualisiert, Bewegungspakete höchstens alle 85 ms.
- Unsichtbare Projektile und entfernte Spieler werden nicht gerendert.
- Datenbank-Dateischreibungen periodisch gebündelt.
- Sicherer Broadcast auch während Login-Verbindungen.

Hinweis: Dies ist eine Optimierung, keine Garantie für 10 gleichzeitige Spieler.
Ping ist WebSocket-RTT, nicht ICMP-Ping. Render Free JSON-Dateispeicher bleibt flüchtig.
