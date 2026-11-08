# VirtualWalking – Arbeitsstand 8. November 2026

## Aktueller Stand

- iPhone-App: **0.4.8, Build 11**; Android-TV-Empfänger: **0.1.4, Build 5**.
- Aktueller TV-Weg: eigener VirtualWalking-Empfänger auf der waipu.tv Box,
  HTTP-Port 8765, derzeit 192.168.0.32. Das iPhone bleibt die Steuerzentrale.
- Die zuvor getrennten Arbeiten vom Entwicklungszweig
  `fix/tv-player-identity-0.1.1` sind Grundlage dieses gemeinsamen Stands.

## Behobene Fehler

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

Die automatisierten Verhaltenstests einschließlich echter FTMS-Antwortverarbeitung
und eingebettetem TV-Player-Skript bestehen. Der Cast-Protobuf-Parser ist mit
unabhängigen Testdaten, Grenzfällen und 10.000 Zufallsfällen geprüft.
Die komplette iPhone-Kompilierung erfolgt in Codemagic. Der echte Test mit
Laufband, iPhone und waipu-Box muss den gemeinsamen Stand noch bestätigen.

## Bauen und installieren

1. Den aktuellen TV-Empfänger installieren (APK 0.1.4). GitHub Actions baut
   Änderungen am TV-Empfänger auf `main` automatisch; alternativ Workflow
   „VirtualWalking Android TV APK“ manuell starten.
2. In Codemagic „VirtualWalking iPhone“ von `main` bauen und die IPA wie bisher
   mit Sideloadly installieren.
3. TV-Empfänger öffnen, Direktverbindung am iPhone herstellen, YouTube-Video
   öffnen und „Training starten“ antippen. Bei fehlender Steuerfreigabe das
   Laufband am Gerät starten; Video und Aufzeichnung warten auf die Bewegung.

## DevView

DevView bleibt als zusätzliche Option für einen eigenen Titan-OS-Empfänger
vorgemerkt. Der private Partnerzugang wurde angefragt; eine Freigabe ist im
aktuellen Arbeitsstand nicht dokumentiert. Der funktionierende Weg über die
waipu-Box wird dadurch nicht aufgehalten.

Offizielle Anleitung: https://docs.titanos.tv/devviewinstall
