# Heftweise – Server für die Sportschule Halle

Kleiner selbst gehosteter Server für die Schulsachen-Börse. Kein Cloud-Dienst, keine
Abhängigkeit von Claude – läuft komplett auf eurem eigenen Server.

## Was du brauchst

- Einen Server/Rechner mit **Node.js** (Version 18 oder neuer). Prüfen mit:
  ```
  node -v
  ```
  Falls nicht installiert: https://nodejs.org (LTS-Version reicht).

## Installation

1. Diesen Ordner (`heftweise-server`) auf den Server kopieren.
2. Im Ordner ausführen:
   ```
   npm install
   ```
3. Server starten:
   ```
   npm start
   ```
4. Im Browser öffnen: `http://<Server-Adresse>:3000`

Konten, Inserate und Nachrichten werden standardmäßig in `data/state.json`
gespeichert. Nach einem Serverneustart können sich alle mit ihrem bestehenden
Konto erneut anmelden.

Wenn das Hosting bei einem Update oder Neustart das Dateisystem ersetzt, muss
`DATA_DIR` auf ein dauerhaftes, beschreibbares Verzeichnis zeigen, zum Beispiel:

```bash
DATA_DIR=/var/lib/schoolsupply npm start
```

Beim Umstieg den bisherigen Server stoppen und die vorhandene `data/state.json`
als `state.json` in das neue Verzeichnis kopieren, bevor der neue Server startet.
Das Verzeichnis ist für einen einzelnen Serverprozess vorgesehen.

## Schulzugang und Admin-Konto einrichten

Beim ersten Start mit dieser Version ein eigenes Admin-Passwort mit mindestens
11 Zeichen über die Umgebungsvariable `ADMIN_PASSWORD` setzen. In Bash lässt
es sich eingeben, ohne es in die Shell-Historie zu schreiben.

```bash
read -rsp 'Admin-Passwort: ' SCHOOLSUPPLY_ADMIN_SECRET
echo
ADMIN_PASSWORD="$SCHOOLSUPPLY_ADMIN_SECRET" npm start
unset SCHOOLSUPPLY_ADMIN_SECRET
```

Der Server legt einmalig das Admin-Konto **Bruno Eppendorf** mit dem Nutzernamen
`bruno-eppendorf` an. Ist dieser Nutzername schon belegt, beim ersten Start
zusätzlich `ADMIN_USERNAME` auf einen freien Nutzernamen setzen. Danach genügt
`npm start` mit demselben Datenverzeichnis. Bei einem Hosting-Anbieter kann das
Startpasswort über dessen Einstellungen für Umgebungsvariablen gesetzt und nach
der Einrichtung wieder entfernt werden.

Auf der Startseite **Admin-Login** öffnen und sich mit dem Admin-Konto anmelden.
Unter **Mein Profil → Schulverwaltung** das gemeinsame Schulpasswort mit
mindestens acht Zeichen festlegen und es der Schule mitteilen. Mitglieder wählen
**Sportschule Halle**, geben das Schulpasswort ein und melden sich anschließend
mit ihrem persönlichen Konto an oder registrieren sich.

In derselben Verwaltung kann Bruno für ein bestehendes Konto anhand seines
Nutzernamens ein neues persönliches Passwort setzen. Das neue Passwort separat
an die Person weitergeben. Bestehende Sitzungen dieses Kontos werden beendet.
Eine Änderung des Schulpassworts gilt für künftige Anmeldungen und
Registrierungen. Bereits angemeldete Mitglieder bleiben dabei angemeldet.

## Dauerhaft laufen lassen

Node-Prozesse laufen nicht automatisch weiter, wenn du das Terminal schließt. Zwei
gängige Optionen:

**Mit PM2** (einfach, empfohlen für den Einstieg):
```
npm install -g pm2
pm2 start server.js --name heftweise
pm2 save
pm2 startup
```

**Mit systemd** (falls ihr einen Linux-Server verwaltet): eine kleine `.service`-Datei
einrichten, die `node server.js` im Hintergrund startet und bei einem Serverneustart
automatisch mitstartet. Sag Bescheid, falls du dabei Hilfe brauchst.

## Erreichbarkeit im Schulnetz / von außen

- **Nur im Schulnetz erreichbar:** reicht meist schon die interne IP-Adresse des
  Servers + Port 3000, z. B. `http://192.168.1.50:3000`.
- **Über eine echte Domain / von außen erreichbar:** dafür würde man normalerweise
  einen Reverse Proxy (z. B. nginx) davorsetzen, der Port 3000 nach außen z. B. als
  `https://schulsachen.eure-schule.de` bereitstellt. Das ist ein zusätzlicher
  Konfigurationsschritt auf dem Server – sag Bescheid, falls ihr das wollt, dann bauen
  wir das mit ein.

## Wichtig zu wissen

- **Passwörter werden gehasht gespeichert** (bcrypt, 12 Salt-Runden). Im Klartext
  landet ein Passwort nie in `data/state.json` – auch nicht kurzzeitig. Der
  Passwort-Hash verlässt den Server außerdem nie: die API liefert an den Browser
  immer nur Name, Klasse und Nutzername zurück.
- **Sitzungen** bleiben im Arbeitsspeicher. Nach einem Serverneustart meldet
  man sich erneut an. Der Browser merkt sich den zuletzt verwendeten Nutzernamen.
- **Keine Verschlüsselung/HTTPS von Haus aus.** Läuft die Seite nur im Schulnetz, ist
  das Restrisiko überschaubar. Soll sie von außen erreichbar sein, gehört unbedingt
  ein Reverse Proxy mit HTTPS (z. B. via Let's Encrypt) davor – sonst reisen auch
  gehashte Passwörter unverschlüsselt durchs Netz.
- **Einfache Speicherung.** Alle Daten liegen in einer einzelnen JSON-Datei – für eine
  Schule/Klasse ausreichend, aber kein Ersatz für eine echte Datenbank bei sehr vielen
  gleichzeitigen Nutzer:innen.
- **Datenschutz-Check vor dem Live-Betrieb:** Da hier Namen, Klassen und Passwörter von
  (teils minderjährigen) Schüler:innen verarbeitet werden, würde ich das vor dem
  echten Einsatz kurz mit der Schulleitung / dem oder der Datenschutzbeauftragten der
  Schule absprechen – insbesondere Informationspflichten (Datenschutzerklärung) und ob
  bei jüngeren Schüler:innen eine Einwilligung der Erziehungsberechtigten nötig ist.
  Das kann dieses Projekt technisch nicht für euch entscheiden.
