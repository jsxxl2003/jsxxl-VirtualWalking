# VirtualWalking TV-Empfänger (Android TV)
Android-TV-Empfänger für die waipu.tv Box. Die iPhone-App bleibt die Steuerzentrale.

## Erste Version
Die Box zeigt ihre LAN-IP und einen zufälligen Sitzungsschlüssel. Der lokale HTTP-Empfänger lauscht auf Port 8765.
Befehle (nur im Heimnetz mit Schlüssel): GET /status?key=..., GET /play?key=...&id=YOUTUBE_ID, GET /pause?key=..., GET /resume?key=..., GET /rate?key=...&value=1.0.
YouTube wird über die offizielle IFrame-Einbettung in einer Android-WebView geöffnet. Die tatsächliche Wiedergabe und Geschwindigkeitsänderung müssen auf der Box getestet werden; YouTube kann Einbettung oder Autoplay blockieren.

## Build
GitHub Actions > VirtualWalking Android TV APK > Run workflow. Das APK liegt anschließend unter Artifacts.
Diese Android-App ist unabhängig vom bisherigen iPhone-Codemagic-Workflow. Für die spätere iPhone-Anbindung wird ein separater iOS-Build benötigt.
