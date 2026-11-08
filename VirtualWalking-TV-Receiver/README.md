# VirtualWalking TV-Empfänger 0.1.5

Android-TV-Empfänger für die waipu.tv Box. Das iPhone steuert Video, Pause,
Fortsetzen, Beenden und Videotempo direkt über das Heimnetz. Das Video bleibt
in VirtualWalking; die externe YouTube-TV-App wird nicht gestartet.

Der Empfänger zeigt seine IPv4-Adresse und einen 24-stelligen Verbindungsschlüssel.
Er lauscht auf Port 8765. Der Schlüssel wird bei normalen App-Neustarts beibehalten.

## Mit der iPhone-App verwenden

Mit iPhone-Version 0.4.14 verwenden. Über „TV verbinden“ die Direktverbindung
herstellen. Ein YouTube-Video öffnen und die vorhandenen Trainingsknöpfe benutzen.
Eine Steuerfreigabe für den Laufbandmotor ist keine Voraussetzung für manuelles
Laufen mit Video und Aufzeichnung. Das Band in diesem Fall am Gerät bedienen.

## Automatisch nach vorn wechseln

Beim ersten Öffnen von 0.1.5 bietet die TV-App an, die Systemeinstellung
„Über anderen Apps einblenden“ zu öffnen. Für „VirtualWalking TV Empfänger“
einmal erlauben. Ab dann holen authentifizierte Wiedergabe- und Fortsetzen-
Befehle vom iPhone die bereits laufende App nach vorn. Es wird kein Overlay
über das Video gelegt. Ohne Freigabe bleibt manuelles Öffnen am TV möglich.

„Verbunden“ bestätigt die Erreichbarkeit. `foreground` meldet zusätzlich, ob
die TV-App im Vordergrund ist. Ohne Vordergrund bestätigt die iPhone-App keine
Wiedergabe. `foregroundError` nennt einen blockierten Wechsel. Ein durch Android
beendeter Empfänger muss weiterhin am TV gestartet werden.

## Build

GitHub Actions baut den Empfänger bei Änderungen auf `main` automatisch.
Der Workflow „VirtualWalking Android TV APK“ kann auch manuell gestartet werden.
Das APK liegt unter „Artifacts“ im erfolgreichen Workflow-Lauf.

## Lokale Schnittstelle

Alle Aufrufe benötigen den Schlüssel: `/status`, `/play&id=YOUTUBE_ID`, `/pause`,
`/resume`, `/stop`, `/rate&value=1.0`, jeweils als GET mit `?key=...` und den
weiteren Parametern. HTTP-Erfolg bestätigt die Annahme des Auftrags.
`playerReady`, `playerState`, `playerVideoId`, `actualRate`, `playerError` und
`feedbackAgeMs` beschreiben die tatsächliche Rückmeldung aus dem eingebetteten
YouTube-Player. `/stop` pausiert und setzt die Videoposition zurück.

Die YouTube-App-Kennung und das Puffern von Befehlen vor Player-Bereitschaft
sind enthalten. Die echte Wiedergabe und Temposynchronisierung müssen auf der
waipu-Box mit dem aktuellen iPhone-Build getestet werden.
