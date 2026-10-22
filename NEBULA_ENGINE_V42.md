# Nebula Engine 1.0 (V42)

Diese Version führt ein separates, dependency-freies Engine-Modul `public/nebula-engine.js` ein:

- `GameClock`: zeitbasierte Frame-Deltas mit Begrenzung nach Tab-Wechseln.
- `SnapshotInterpolator`: Netzwerk-Snapshot-Historie, verzögerte Interpolation und begrenzte Extrapolation für entfernte Schiffe und NPCs.
- `Camera2D`: framerate-unabhängiges weiches Kamerafolgen.
- `ParticlePool`: wiederverwendbarer, begrenzter Partikelpool als Grundlage für spätere Kampfeffekte.

Der bestehende Client lädt das Modul vor `client.js`. Alle bestehenden Spielsysteme (Maps, Ausrüstung, Galaxy Gates, Hades) bleiben im Projekt. Diese erste Engine-Version ist eine schrittweise Migration, **kein kompletter Ersatz** des bisherigen Game-Cores. Insbesondere sind Serverautorität, Kollisionen und Partikel-Effekte noch nicht vollständig auf die neue Engine umgestellt.

## Installation

ZIP-Inhalt ins Root des GitHub-Repositories hochladen und Änderungen committen. Render deployt danach den Node.js-Server. Bei Browser-Cache-Problemen hart neu laden.

## Tests

`node --check public/nebula-engine.js && node --check public/client.js && node --check server.js`
