# VirtualWalking – Arbeitsstand 8. November 2026

## Aktueller Stand

- iPhone-App: **0.4.15, Build 18**; Android-TV-Empfänger: **0.1.5, Build 6**.
- Aktueller TV-Weg: eigener VirtualWalking-Empfänger auf der waipu.tv Box,
  HTTP-Port 8765. Die Box ist wieder per LAN verbunden; im Vodafone-Router
  ist 192.168.0.32 reserviert und am TV bestätigt. Zwischenzeitlich wurde
  über eine andere Verbindung 192.168.0.119 angezeigt. Das iPhone bleibt die Steuerzentrale.
- Die zuvor getrennten Arbeiten vom Entwicklungszweig
  `fix/tv-player-identity-0.1.1` sind Grundlage dieses gemeinsamen Stands.

## Behobene Fehler

### Erweiterung 0.4.15: Tempo-Tasten und TV-Starttempo

Der Nutzer hat bestätigt: Mit iPhone 0.4.14 und TV-Empfänger 0.1.5 funktioniert
alles, einschließlich des zuvor geprüften gemeinsamen Starts. Diese Bestätigung
ersetzt den bisherigen offenen Gerätetest für diesen älteren Stand. Die neuen
Änderungen von 0.4.15 sind noch nicht physisch am WELLFIT geprüft.

Unter der tatsächlichen Geschwindigkeitsanzeige stehen jetzt genau zwei Tasten:
„− Langsamer“ und „+ Schneller“. Ein Tastendruck ändert das Laufbandtempo um
0,1 km/h oder die kleinste dafür passende, vom Gerät unterstützte Schrittweite.
Die Anzeige bleibt bei der wirklich gemeldeten Geschwindigkeit. Bis ein Ziel
bestätigt zurückgemeldet wird, wird kein weiterer Tastendruck gesendet. Es gibt
keine Haltewiederholung und keinen automatischen erneuten Versuch.

Zusätzlich werden ausschließlich die lesbaren FTMS-Kanäle 2ACC und 2AD4 abgefragt.
Ohne das angebotene Target-Speed-Merkmal und gültige Min-/Max-/Schrittgrenzen
bleiben nur die neuen Tempo-Tasten gesperrt; der bewährte Start-/Stoppablauf
bleibt verfügbar. Der Sender nutzt Opcode 0x02, UINT16 Little Endian in 0,01 km/h,
und verlangt wie bisher die passende tatsächliche FTMS-Antwort 0x80. Falls nötig,
fordert ein ausdrücklicher Tempo-Tastendruck zuerst die Steuerfreigabe 0x00 an;
er sendet niemals den Motorstart 0x07. Änderung nur während laufender Aufzeichnung
mit aktuellen, positiven Bewegungsdaten. Kein Anfahren aus dem Stillstand.

Die native Befehlsprüfung validiert Tempoziele nochmals unabhängig mit den
wirklich eingelesenen Gerätewerten. Zero, nicht passende Schrittwerte und Werte
außerhalb der Grenzen werden nicht übertragen. Ohne GATT-Bestätigung werden
Tempoänderungen genauso wie Starts nie für spätere Sendebereitschaft eingereiht.
Pause, Ende, Stillstand, Sicherheitsstopp, Trennung und Hintergrundwechsel
verwerfen noch nicht gesendete Tempoänderungen. Ein bereits übertragener
Tempo-Befehl wird vor dem nächsten Stopp protokollgerecht abgeschlossen oder
mit begrenzter Wartezeit als unbestätigt behandelt; keine parallelen FTMS-
Prozeduren. Die App bleibt kein Ersatz für den Notstopp am Gerät.

Zum TV-Starttempo: Auf dem vorherigen Quellstand wurde nachgestellt, dass ein
zuvor gesetztes 0,50× beim Vorbereiten und Fortsetzen erhalten bleibt. Während
des Startablaufs übersprang die normale Temposynchronisierung ihre Aktualisierung.
Jetzt setzt die Vorbereitung ausdrücklich 1×; vor der eigentlichen Fortsetzung
wird bei aktiver Synchronisierung das Tempo aus der aktuellen Bandgeschwindigkeit
und der vorhandenen Referenzgeschwindigkeit gesetzt. Mit ausgeschalteter
Synchronisierung startet es bei 1×. Die Referenzeinstellung und die spätere
Geschwindigkeitsanpassung bleiben unverändert. Kein neuer TV-Empfänger erforderlich.

80 Verhaltenstests bestehen, einschließlich der kompilierten nativen C-Prüfung
und Abläufen über die tatsächliche JavaScript-Brücke. iPhone 0.4.15 muss noch in
Codemagic kompiliert und auf dem realen Laufband geprüft werden.

Primärquelle: Bluetooth SIG, Fitness Machine Service v1.0.1, Abschnitte 4.3.1.2,
4.11 und 4.16.2.3 (Originaldokument als PDF-Kopie):
https://www.fitmonster.club/SDK/FTMS_v101.pdf
Test-Suite des Herausgebers:
https://files.bluetooth.com/wp-content/uploads/dlm_uploads/2024/10/FTMS.TS_.p6.pdf

### Korrektur 0.4.14 und TV-Empfänger 0.1.5

Der Nutzer bestätigt den unveränderten Schreibfehler auch in 0.4.13; ein neuer
Screenshot zeigt die korrekte Version. Ursache im Adapter: Die Objective-C-
Vergleichsausdrücke wurden als NSNumber mit Integer-Typ verpackt. JSON lieferte
somit 0/1, während die Auswahl des Schreibmodus strikt auf false/true prüfte.
Write=0 wurde fälschlich als verfügbar angesehen. Eine Testeingabe mit genau
diesen numerischen Eigenschaften reproduziert den exakten Fehler aus dem Bild;
sechs Regressionstests scheitern vor der Korrektur.

Native Merkmale werden jetzt explizit mit @YES/@NO serialisiert. Die JavaScript-
Schnittstelle normalisiert zusätzlich numerische Altwerte. Write=0 führt damit
nicht mehr zur Wahl von writeValue. Ohne angebotenen Schreibmodus bleibt der
Steuerkanal nicht verfügbar. Es wird kein nicht angebotener Modus erzwungen.
FTMS-Antworten und tatsächliche Bewegung bleiben Voraussetzung für Motorstart
und Aufzeichnung. Ob das reale WELLFIT den alternativen Modus und Start erlaubt,
ist weiterhin am Gerät zu prüfen.

Auf Wunsch soll der bereits erreichbare TV-Empfänger beim Training aus einer
anderen TV-App nach vorn wechseln. TV 0.1.5 öffnet bei authentifiziertem /play
oder /resume die bestehende singleTask-Activity. Android benötigt dafür die vom
Nutzer einmal erteilte Berechtigung SYSTEM_ALERT_WINDOW. Der TV-Empfänger bietet
einmalig den Aufruf der zugehörigen Systemeinstellungen an und fängt fehlende
Einstellungsaktivitäten ab. Er erzeugt kein eigenes Overlay-Fenster. Status,
Pause, Stopp und Tempoänderungen holen die App nicht nach vorn. Pause/Stopp
sowie eine begrenzte Wartezeit verwerfen noch nicht ausgeführte Wiedergabe.

Der Status meldet foreground und foregroundError. iPhone 0.4.14 zeigt den
Hintergrundzustand in der bestehenden TV-Zeile und akzeptiert dort selbst frische
Playerdaten nicht als bestätigte Wiedergabe. Ein vom System blockierter Wechsel
meldet die nötige Freigabe. Ein vom Betriebssystem beendeter Empfänger wird damit
nicht neu gestartet: Der Netzwerkempfänger muss noch laufen und erreichbar sein.
Kein Autostart beim Einschalten der Box und keine Änderungen am Router.

67 Verhaltenstests bestehen. Android-Kompilierung und beide realen Gerätetests
werden getrennt protokolliert; der JavaScript-Test ersetzt keine native Prüfung.
Quellen zur Android-Freigabe:
https://developer.android.com/guide/components/activities/background-starts
https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)

### Korrektur 0.4.13

Der Screenshot von 0.4.12 zeigt den konkreten Fehler: „Steuerfreigabe (0x00) /
writeValue: Keine bestätigten Schreibzugriffe möglich.“ Das stammt aus dem
nativen Adapter, weil der Steuerkanal die Core-Bluetooth-Eigenschaft Write
nicht anbietet. Die erfolgreiche Datenübertragung, Aufzeichnung und bestätigte
TV-Tempoanpassung sind im selben Screenshot sichtbar. Ob WriteWithoutResponse
angeboten wird, ist aus diesem Screenshot noch nicht ableitbar.

Der native Adapter meldet jetzt auch WriteWithoutResponse an die Web-Schnittstelle.
Der Client wählt einmal pro Verbindung anhand der tatsächlichen Eigenschaften
einen Schreibmodus. Sind beide verfügbar, bleibt Write mit GATT-Bestätigung
bevorzugt. Ist ausschließlich WriteWithoutResponse verfügbar, verwendet er
diesen Modus. Ein nur lesbarer Steuerkanal gilt nicht als steuerbereit.
Es gibt keinen Wechsel auf einen anderen Modus nach fehlgeschlagenen Befehlen.

Die Rückgabe nach einem WriteWithoutResponse bestätigt nur die Übergabe an
Core Bluetooth. Eine passende positive FTMS-Antwort 0x80 mit dem gesendeten
Opcode bleibt vor dem nächsten Startschritt erforderlich. Erst bestätigte
Bandbewegung und TV-Wiedergabe erlauben die Aufzeichnung. Ein Motorstart wird
bei belegtem Bluetooth-Schreibpuffer nicht für später eingereiht. Request Control
und Stopp können auf die Sendebereitschaft warten, mit begrenzter Wartezeit;
Trennung und Zeitüberschreitung verwerfen ausstehende Daten. Die erlaubten
Motorbefehle bleiben auf Request Control, Start und Pause/Stopp begrenzt.

Sechs neue Transporttests und ein vollständiger Trainingsablauf über die
native JavaScript-Schnittstelle bestehen. Fünf neue Fälle scheiterten am alten
Adapter. Die native Core-Bluetooth-Kompilierung erfolgt in Codemagic; tatsächliche
Schreibmerkmale und Motorfreigabe am WELLFIT müssen am Gerät geprüft werden.
TV-Empfänger, gespeicherte Paarung und vereinfachte TV-Oberfläche bleiben bei
ihrem bisherigen Verhalten.

Die vom Nutzer gezeigte Fernbedienung trägt FCC-ID 2A4NH-A006. Die dazu
veröffentlichten Zulassungsunterlagen nennen Jiangxi EQi Industrial und
433,92 MHz. Das identifiziert den Fernbedienungs-Funkweg, liefert aber kein
Bluetooth-Befehlsprotokoll des Laufbands. Quelle: https://fccid.io/2A4NH-A006
Die Fernbedienung wird durch die Änderung nicht neu gekoppelt oder verändert.

Apple-Dokumentation des Schreibwegs und der Sendebereitschaft:
https://developer.apple.com/documentation/corebluetooth/cbcharacteristicproperties/writewithoutresponse
https://developer.apple.com/documentation/corebluetooth/cbperipheral/cansendwritewithoutresponse

### Korrektur 0.4.12

Auf ausdrücklichen Auftrag ist das alte TV-Aktionsmenü entfernt, einschließlich
Cast-Geräteauswahl, AirServer-/Philips-Tests und separater Videoaktionen.
Das AirPlay-Symbol neben „TV verbinden“ ist ebenfalls entfernt. Oben bleibt
ein einzelner TV-Verbindungsbutton.

„TV verbinden“ prüft jetzt direkt die gespeicherte Verbindung. Ist sie gültig,
gibt es weder eine erneute Schlüsselabfrage noch einen Bestätigungsdialog.
Ein erneuter Klick unterbricht keine laufende Einheit, wenn das bereits gewählte
Ziel bestätigt wird. Der Einrichtungsdialog bleibt für eine fehlende Paarung
sowie für die ausdrücklich gewählte Bearbeitung nach einem Verbindungsfehler
erreichbar. Ein ungültiger oder fehlender Schlüssel wird nicht durch eine
unautorisierte Verbindung umgangen. Die gespeicherten Daten bleiben erhalten.
Videoauswahl und Training werden über die vorhandenen Hauptbedienelemente
bedient. Die früheren zusätzlichen TV-Menü-Handler sind ebenfalls entfernt.

Die Screenshots von 0.4.11 bestätigen das vorbereitete, pausierte TV-Video mit
aktueller Tempo-Rückmeldung. Beim stehenden Band wechselt die App allerdings
in den manuellen Startmodus; eine tatsächliche FTMS-Motorfreigabe ist weiter
nicht bestätigt. Bisher wurde die genaue Ursache bei einer unbeantworteten
Steuerfreigabe nicht in der vorhandenen Fehlerzeile angezeigt. Jetzt bleibt
dieser konkrete FTMS-Fehler während des manuellen Wartens und nach dessen
Abbruch sichtbar. Ein bloß geöffneter Steuerkanal heißt nun „Steuerkanal
geöffnet“; „Steuerfreigabe bestätigt“ erscheint erst nach tatsächlicher
positiver FTMS-Antwort. Es wurden keine neuen Motorbefehle oder automatischen
Wiederholungen hinzugefügt. Die Diagnose am realen WELLFIT-Laufband steht aus.

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

64 automatisierte Verhaltenstests einschließlich nativer JavaScript-Schnittstelle,
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
3. TV-Empfänger öffnen. Am iPhone genügt „TV verbinden“ für die gespeicherte
   Verbindung. Nur bei der Ersteinrichtung Adresse und Schlüssel eingeben
   (aktuell http://192.168.0.32:8765). Unter „YouTube / Link“ das angebotene letzte
   Video öffnen oder ein anderes Laufvideo wählen. Das Laufband per Bluetooth
   verbinden und „Training starten“ antippen. Bei fehlender Steuerfreigabe das
   Laufband am Gerät starten; Video und Aufzeichnung warten auf die Bewegung.

## DevView

DevView bleibt als zusätzliche Option für einen eigenen Titan-OS-Empfänger
vorgemerkt. Der private Partnerzugang wurde angefragt; eine Freigabe ist im
aktuellen Arbeitsstand nicht dokumentiert. Der funktionierende Weg über die
waipu-Box wird dadurch nicht aufgehalten.

Offizielle Anleitung: https://docs.titanos.tv/devviewinstall
