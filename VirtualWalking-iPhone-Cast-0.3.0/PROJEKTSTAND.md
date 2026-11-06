# VirtualWalking iPhone 0.3.3

Aktuelles Ziel: Direkte Videoübertragung aus VirtualWalking an das bereits auf
dem Philips 55PUS8079/12 laufende AirServer. Zuerst die tatsächlich erreichbaren
Empfangsdienste feststellen, danach den passenden iPhone-Sender entwickeln.

## In diesem Stand umgesetzt

- „TV verbinden“ bietet „AirServer prüfen“ und die bestehende Cast-Geräteauswahl.
- Die Prüfung läuft auf dem iPhone: Bonjour für AirPlay, RAOP, Google Cast und
  DIAL, gezielte SSDP-Unicast-Abfrage und lesende Dienstabfragen an die TV-IP.
- Eine eigene Cast-Verbindung liest nur Status; sie startet keine Receiver-App,
  lädt kein Video und sendet keine Wiedergabebefehle. Medienadressen und private
  Dateinamen werden nicht in den teilbaren Bericht aufgenommen.
- Das zuletzt ausgewählte YouTube-Video wird mit Titel gespeichert. Beim
  nächsten Öffnen erscheint sein Link im bestehenden Eingabefeld; „Öffnen“ lädt
  es erneut. Es startet dadurch kein Training und keine Wiedergabe.
- Laufbandsteuerung, FTMS-Module und Geschwindigkeitsregelung sind erhalten.

## Offene Nachweise

Auf dem echten iPhone die Prüfung mit geöffnetem AirServer am TV ausführen und
„Ergebnis teilen“ verwenden. Ein Bonjour-Eintrag bestätigt lediglich eine
Dienstankündigung. Ein Cast-Status, ein gültiges AirPlay-Info-Dokument oder eine
UPnP-Gerätebeschreibung mit AVTransport liefern jeweils stärkere Nachweise.
Keine Antwort schließt ein Protokoll nicht aus. RAOP allein belegt nur Audio;
DIAL allein belegt App-Startfunktionen. Livevideo-Unterstützung ist noch nicht
getestet. Aktive HTTP-/Cast-Abfragen verwenden lokale IPv4-Adressen; zusätzlich
aufgelöste IPv6-Adressen werden im Bericht erfasst.

SSDP wird ohne die bei Sideloadly nicht voraussetzbare Apple-Multicastfreigabe
gezielt per Unicast geprüft. Geräte, die darauf nicht antworten, bleiben offen.

## DevView weiterverfolgen

DevView bleibt als zusätzliche Entwicklungsmöglichkeit für einen eigenen
Titan-OS-Empfänger vorgemerkt. Der private Partnerzugang wurde angefragt; seine
Freigabe steht noch aus. Keine erneute Kontoanfrage und keine TV-Installation
ohne diesen Zugang. Die aktuelle Arbeit am iPhone-Sender geht unabhängig davon
weiter.

Offizielle Anleitung: https://docs.titanos.tv/devviewinstall

## Build und Installation

In Codemagic den Workflow „VirtualWalking iPhone“ vom aktuellen main ausführen.
Das Projektverzeichnis behält wegen der vorhandenen Buildpfade seinen Namen
VirtualWalking-iPhone-Cast-0.3.0. App-Version: 0.3.3, Build: 4.
Das erzeugte VirtualWalking-iPhone.ipa wie bisher mit Sideloadly installieren.
Dieser Quellstand enthält noch keine neue direkte Videoübertragung.
