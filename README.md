# Prozesslandkarte · Autohaus Stieber

Interne Anwendung zur Erfassung aller Unternehmensprozesse mit KI-Ampel.

**Anwendung:** https://stioli.github.io/stieber-prozesslandkarte/

## Was hier liegt

Nur die Oberfläche — `index.html`, `stil.css`, `app.js`.
**Prozessdaten liegen nicht in diesem Repository**, sondern in Supabase hinter einer Anmeldung.

## Aufbau

| | |
|---|---|
| Oberfläche | GitHub Pages, statisches HTML ohne Build-Schritt |
| Datenbank | Supabase, Projekt `fahrzeug-ankauf-automation`, Region eu-central-1 (Frankfurt) |
| Tabellen | `pl_berechtigt`, `pl_prozess`, `pl_phase`, `pl_schritt`, `pl_aenderung` |
| Anmeldung | Supabase Auth, E-Mail und Passwort — dieselben Zugangsdaten wie in den übrigen Stieber-Apps |
| Zugriffsschutz | Row Level Security; nur Adressen in `pl_berechtigt` erhalten Daten |

Alle Stieber-Apps liegen unter `stioli.github.io` und teilen deshalb dieselbe Sitzung im Browser.
Wer sich hier abmeldet, ist auch in den übrigen Apps abgemeldet.

## Rollen

- **leser** — sieht alles, ändert nichts
- **bearbeiter** — darf Prozesse, Phasen und Schritte ändern
- **admin** — zusätzlich Zugriffsverwaltung und Einsicht ins Änderungsprotokoll

Verwaltet wird das in der Anwendung unter „Zugriff".

## Die Ampel

Sie zeigt den **heutigen** Zustand, nicht das Potenzial.

- **rot** — vollständig manuell
- **gelb** — KI unterstützt, Mensch entscheidet
- **grün** — KI erledigt, Mensch nur bei Ausnahmen
- **grau** — bleibt bewusst beim Menschen

Sobald ein Prozess in Schritte zerlegt ist, ergibt sich seine Ampel aus den Schritten.
Graue Prozesse zählen nicht in den Automatisierungsgrad.

## Datenschutz

Die Anwendung enthält **keine Kundendaten**. Personenbezug entsteht nur durch die
Zugriffsliste und das Änderungsprotokoll; dessen Personenbezug wird nach zwölf Monaten
automatisch entfernt (Datenbankjob `pl_protokoll_anonymisieren`, läuft monatlich).

Vor dem produktiven Einsatz sind abzuschließen: Auftragsverarbeitungsverträge mit
Supabase und GitHub, Aufnahme in das Verzeichnis von Verarbeitungstätigkeiten,
Freigabe des Datenschutzhinweises durch den Datenschutzbeauftragten.
