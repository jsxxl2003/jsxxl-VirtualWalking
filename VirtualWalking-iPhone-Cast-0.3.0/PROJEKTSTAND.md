# VirtualWalking – Arbeitsstand 8. November 2026

## Aktueller Stand

- iPhone-App: **0.4.9, Build 12**; Android-TV-Empfänger: **0.1.4, Build 5**.
- Aktueller TV-Weg: eigener VirtualWalking-Empfänger auf der waipu.tv Box,
  HTTP-Port 8765, derzeit 192.168.0.32. Das iPhone bleibt die Steuerzentrale.
- Die zuvor getrennten Arbeiten vom Entwicklungszweig
  `fix/tv-player-identity-0.1.1` sind Grundlage dieses gemeinsamen Stands.

## Behobene Fehler

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

Der konkrete Bluetooth-Empfang am physischen WELLFIT-Laufband ist noch nicht
bestätigt. Die Korrektur repariert nachgestellte Fehler im Startablauf; sie ist
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

49 automatisierte Verhaltenstests einschließlich nativer JavaScript-Schnittstelle,
echtem FTMS-Parser, Trainingsoberfläche, TV-Controller und eingebettetem
TV-Player-Skript bestehen. Vier neue Regressionen wurden vor der Korrektur
nachgestellt. Der Cast-Protobuf-Parser ist im vorherigen Stand mit
unabhängigen Testdaten, Grenzfällen und 10.000 Zufallsfällen geprüft.
Die komplette iPhone-Kompilierung erfolgt in Codemagic. Der echte Test mit
Laufband, iPhone und waipu-Box muss den gemeinsamen Stand noch bestätigen.

## Bauen und installieren

1. Bereits installierten TV-Empfänger 0.1.4 weiterverwenden. GitHub Actions baut
   Änderungen am TV-Empfänger auf `main` automatisch; alternativ Workflow
   „VirtualWalking Android TV APK“ manuell starten.
2. In Codemagic „VirtualWalking iPhone“ von `main` bauen und die IPA wie bisher
   mit Sideloadly installieren.
3. TV-Empfänger öffnen, Direktverbindung am iPhone herstellen, YouTube-Video
   öffnen oder „Letztes YouTube-Video vorbereiten“ wählen. Das Laufband per
   Bluetooth verbinden und „Training starten“ antippen. Bei fehlender Steuerfreigabe das
   Laufband am Gerät starten; Video und Aufzeichnung warten auf die Bewegung.

## DevView

DevView bleibt als zusätzliche Option für einen eigenen Titan-OS-Empfänger
vorgemerkt. Der private Partnerzugang wurde angefragt; eine Freigabe ist im
aktuellen Arbeitsstand nicht dokumentiert. Der funktionierende Weg über die
waipu-Box wird dadurch nicht aufgehalten.

Offizielle Anleitung: https://docs.titanos.tv/devviewinstall
