# VirtualWalking – Arbeitsstand 8. November 2026

## Aktueller Stand

- iPhone-App: **0.4.11, Build 14**; Android-TV-Empfänger: **0.1.4, Build 5**.
- Aktueller TV-Weg: eigener VirtualWalking-Empfänger auf der waipu.tv Box,
  HTTP-Port 8765. Die Box ist wieder per LAN verbunden; im Vodafone-Router
  ist 192.168.0.32 reserviert und am TV bestätigt. Zwischenzeitlich wurde
  über eine andere Verbindung 192.168.0.119 angezeigt. Das iPhone bleibt die Steuerzentrale.
- Die zuvor getrennten Arbeiten vom Entwicklungszweig
  `fix/tv-player-identity-0.1.1` sind Grundlage dieses gemeinsamen Stands.

## Behobene Fehler

### Korrektur 0.4.11

Nach bestätigter Bluetooth- und direkter TV-Verbindung wurde beim gemeinsamen
Start erneut eine HTTP-Zeitüberschreitung gemeldet. Dadurch wurde die eigentliche
FTMS-Steuerfreigabe noch nicht geprüft. Ein automatischer Motorstart ist auf
dem realen Gerät weiterhin nicht bestätigt.

Im Code konnten Hintergrund-Statusabfragen, Startbestätigungen und Pausebefehle
parallel laufen. Mehrere gleiche Pause-Aufträge konnten sich anhäufen. Diese
Abläufe sind in Tests nachgestellt und korrigiert: Alle HTTP-Anfragen des
TV-Controllers laufen in einer Reihenfolge. Gleichzeitig benötigte
Statusabfragen werden geteilt. Ein abgebrochener, noch nicht gesendeter
Wiedergabebefehl bleibt verworfen; wiederholte Pause-Aufträge werden
zusammengefasst. Nach einer zwischenzeitlichen Fortsetzungsanforderung bleibt
eine erneute Pause wirksam. Auch beim Wechsel der App in den Hintergrund kann
der notwendige Pausebefehl gesendet werden.

Native TV-Anfragen und der Verbindungsdialog verwenden eine eigene, nicht
zwischenspeichernde HTTP-Sitzung mit einer Verbindung pro Ziel. Eine Fehlermeldung
nennt den fehlgeschlagenen Befehl und seine Zieladresse. Eine unerreichbare Box
wird in der vorhandenen Statusanzeige als unerreichbar gemeldet, statt nur ein
nicht zugeordnetes Video anzuzeigen. Die Verbindungsbestätigung nennt außerdem
die vom TV gemeldete Empfängerversion. Keine neuen Bedienknöpfe.

Die tatsächliche Ursache der beobachteten Zeitüberschreitung ist damit noch
nicht am Gerät bewiesen. Der Gerätetest muss sowohl die neue TV-Kommunikation
als auch die unveränderte FTMS-Steuerfreigabe und den bestätigten Motorstart
prüfen. Die Motorbefehle werden weiterhin erst nach bestätigter TV-Vorbereitung
und aktuellen Stillstandsdaten angefordert. Ohne Freigabe bleibt der manuelle
Bandstart möglich. Der TV-Empfänger bleibt unverändert bei 0.1.4.

### Korrektur 0.4.10

Die iPhone-App verwendete für den Direktverbindungsdialog und sämtliche
TV-Befehle fest 192.168.0.32. Die Box zeigt inzwischen 192.168.0.119 an.
Die damit verbundene Zeitüberschreitung ist anhand der TV-Anzeige und des
bisherigen Quellcodes nachvollziehbar. Im bestehenden Dialog „waipu.tv ·
Direkt verbinden (Android)“ gibt es jetzt ein Adressfeld. Die Adresse vom TV
kann vollständig mit HTTP und Port oder als IPv4-Adresse eingegeben werden.
Ohne Port wird 8765 verwendet. Ungültige Eingaben werden zurückgewiesen.

Adresse und Schlüssel werden gemeinsam nach einer erfolgreichen Antwort
des VirtualWalking-Empfängers gespeichert und bei allen folgenden Befehlen
sowie nach App-Neustarts verwendet. Fehlgeschlagene Verbindungsversuche
überschreiben die bestehende Paarung nicht. Vorhandene alte Schlüssel werden
zusammen mit der alten Adresse angeboten, bis die neue Adresse bestätigt wird.
Bei Netzwerkfehlern nennt die Meldung das tatsächlich angesprochene Ziel.
Auch die Cast-Diagnose verwendet die gespeicherte Adresse. Die TV-Statuszeile
zeigt das gewählte Ziel; eine verspätete Antwort des vorherigen Ziels bestätigt
keine Wiedergabe am neu ausgewählten Empfänger.

Laut iPhone-Screenshot werden inzwischen 2,0 km/h empfangen; damit ist der
Bluetooth-Datenempfang für diesen Test bestätigt. Der vollständige Trainings-
und TV-Ablauf nach der Adresskorrektur ist noch am Gerät zu prüfen. Auf der
TV-Box bleibt Version 0.1.4 installiert. Es werden keine IP-Adressen am Router
oder an den Geräten automatisch geändert. Eine DHCP-Reservierung für die Box
im Router kann ihre Adresse dauerhaft stabil halten; das iPhone benötigt dafür
keine feste Adresse.

### Korrektur 0.4.9

Der bisherige TV-Menüpunkt „Letztes YouTube-Video senden“ startete ein Video
direkt per HTTP. Er setzte weder die Videoauswahl der Trainingsoberfläche noch
deren Start-, Pause- oder Aufzeichnungszustand. Der Menüpunkt heißt jetzt
„Letztes YouTube-Video vorbereiten“ und verwendet dieselbe Videoauswahl und
denselben TV-Controller wie das Training. Er lädt das gespeicherte Video und
wartet auf die bestätigte Pause am TV. Er startet weder das Laufband noch eine
Aufzeichnung. „Training pausieren“ und „Training fortsetzen“ im TV-Menü führen
ebenfalls die gemeinsamen Trainingsaktionen aus.

„Training starten“ kann nun auf den ersten echten Geschwindigkeitswert warten,
statt sofort abzubrechen. Währenddessen funktionieren Pause und Beenden. Ein
FTMS-Motorstart wird erst bei bestätigten aktuellen Stillstandsdaten angefordert.
Ein erster Datenwert, der bereits Bandbewegung meldet, kann das ausgewählte
Training starten; ein vorheriges 0-km/h-Paket ist dafür nicht mehr erforderlich.
Auch bei Wiederaufnahme nach Bandbewegung wird der gemeinsame Ablauf mit
TV-Bestätigung verwendet. Abgebrochenes Warten startet bei einem verspäteten
Datenpaket nicht erneut.

Die iPhone-Vorschau bleibt bei ausgewähltem TV-Ausgang pausiert und beeinflusst
die TV-Wiedergabe nicht. Fehlende oder veraltete Geschwindigkeitsdaten werden
als solche angezeigt. FTMS-Folgepakete ohne Geschwindigkeitsfeld halten einen
alten Tempowert nicht mehr für die Aufzeichnung gültig.

Zum Zeitpunkt der Korrektur 0.4.9 war der konkrete Bluetooth-Empfang am
physischen WELLFIT-Laufband noch nicht bestätigt. Diese Korrektur repariert nachgestellte Fehler im Startablauf; sie ist
kein Nachweis einer reparierten Funkverbindung. Die neue Anzeige unterscheidet
eine bestehende Bluetooth-Verbindung von tatsächlich empfangenen Tempowerten.

### Vorheriger Stand 0.4.8

„Training starten“ war nach einer fehlgeschlagenen FTMS-Steuerfreigabe blockiert.
Die App kann jetzt auf einen manuellen Bandstart warten. Sobald aktuelle
Bewegungsdaten vorliegen, beginnen Video und Aufzeichnung. Pause und Beenden
bleiben während dieses Wartens bedienbar. Ohne Steuerfreigabe sendet dieser
Ablauf keine Motorbefehle. Ein unbestätigter Motor-Start oder -Stopp wird
weiterhin gesperrt und niemals als bloß fehlende Steuerfreigabe behandelt.

Die Trainingsknöpfe steuern den direkten HTTP-Empfänger. Alte oder parallel
bestehende Google-Cast-Meldungen können die gewählte waipu-Verbindung nicht mehr
überschreiben. Bestätigungen kommen aus dem tatsächlichen YouTube-Player;
eine erfolgreiche HTTP-Antwort allein bestätigt keine Wiedergabe. Bei einem
veralteten TV-Empfänger wird die fehlende Player-Rückmeldung verständlich gemeldet.

Beenden pausiert das TV-Video und setzt seine Position zurück. Fortsetzen lädt
bereits geladene Videos nicht erneut vom Anfang. Nach einem Videowechsel bleiben
keine alten Tempo-Fehler hängen. Verspätete Rückmeldungen bestätigen keinen
bereits abgebrochenen Start.

Das zuletzt ausgewählte YouTube-Video bleibt gespeichert und wird beim nächsten
Öffnen wieder angeboten. Die TV-App speichert ihren Verbindungsschlüssel über
normale Neustarts hinweg. Bestehende Gestaltung und Tempo-Berechnung bleiben
bestehen; es gibt keine neuen Bedienknöpfe im Trainingsbildschirm.

## Prüfergebnis und Grenzen

57 automatisierte Verhaltenstests einschließlich nativer JavaScript-Schnittstelle,
echtem FTMS-Parser, Trainingsoberfläche, TV-Controller und eingebettetem
TV-Player-Skript und kompilierter nativer IPv4-Adressprüfung bestehen.
Verspätete Rückmeldungen nach einem Adresswechsel sind abgedeckt. Der
Cast-Protobuf-Parser ist im vorherigen Stand mit
unabhängigen Testdaten, Grenzfällen und 10.000 Zufallsfällen geprüft.
Die komplette iPhone-Kompilierung erfolgt in Codemagic. Der echte Test mit
Laufband, iPhone und waipu-Box muss den gemeinsamen Stand noch bestätigen.

## Bauen und installieren

1. Bereits installierten TV-Empfänger 0.1.4 weiterverwenden. GitHub Actions baut
   Änderungen am TV-Empfänger auf `main` automatisch; alternativ Workflow
   „VirtualWalking Android TV APK“ manuell starten.
2. In Codemagic „VirtualWalking iPhone“ von `main` bauen und die IPA wie bisher
   mit Sideloadly installieren.
3. TV-Empfänger öffnen, am iPhone „TV verbinden“ → „waipu.tv · Direkt verbinden
   (Android)“ öffnen. Die aktuelle TV-Adresse (aktuell http://192.168.0.32:8765)
   und den Schlüssel vom TV eingeben und verbinden. YouTube-Video
   öffnen oder „Letztes YouTube-Video vorbereiten“ wählen. Das Laufband per
   Bluetooth verbinden und „Training starten“ antippen. Bei fehlender Steuerfreigabe das
   Laufband am Gerät starten; Video und Aufzeichnung warten auf die Bewegung.

## DevView

DevView bleibt als zusätzliche Option für einen eigenen Titan-OS-Empfänger
vorgemerkt. Der private Partnerzugang wurde angefragt; eine Freigabe ist im
aktuellen Arbeitsstand nicht dokumentiert. Der funktionierende Weg über die
waipu-Box wird dadurch nicht aufgehalten.

Offizielle Anleitung: https://docs.titanos.tv/devviewinstall
