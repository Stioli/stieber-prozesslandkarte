# Prozesslandkarte · Autohaus Stieber

Interne Anwendung zur Erfassung aller Unternehmensprozesse mit KI-Ampel.

**Anwendung:** https://stioli.github.io/stieber-prozesslandkarte/

## Was hier liegt

Nur die Einstiegsseite (`index.html`). Sie holt die eigentliche Anwendung aus
Supabase und zeigt sie an — dasselbe Muster wie beim
Qualitätsmanagement-Dashboard. Grund: Supabase liefert HTML grundsätzlich als
`text/plain` aus, GitHub Pages liefert es korrekt als `text/html`.

**Prozessdaten liegen nicht in diesem Repository**, sondern in Supabase hinter
einer Anmeldung.

## Aufbau

| | |
|---|---|
| Einstiegsseite | GitHub Pages, diese Datei |
| Quelltext der Anwendung | Supabase, Tabelle `pl_seite` (Zeilen `index`, `css`, `js`) |
| Auslieferung | Supabase Edge Function `prozesse` |
| Datenbank | Supabase-Projekt `fahrzeug-ankauf-automation`, Region eu-central-1 (Frankfurt) |
| Tabellen | `pl_berechtigt`, `pl_prozess`, `pl_phase`, `pl_schritt`, `pl_aenderung`, `pl_seite` |
| Anmeldung | Supabase Auth, Anmeldelink per E-Mail (kein Passwort) |
| Zugriffsschutz | Row Level Security; nur Adressen in `pl_berechtigt` erhalten Daten |

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

Sobald ein Prozess in Schritte zerlegt ist, ergibt sich seine Ampel aus den
Schritten. Graue Prozesse zählen nicht in den Automatisierungsgrad.

## Neue Fassung veröffentlichen

Nicht hier, sondern in der Datenbank: die betreffende Zeile in `pl_seite`
ersetzen. Diese Seite und der Link bleiben unverändert.

## Datenschutz

Die Anwendung enthält **keine Kundendaten**. Personenbezug entsteht nur durch
die Zugriffsliste und das Änderungsprotokoll; dessen Personenbezug wird nach
zwölf Monaten automatisch entfernt (Datenbankjob `pl_protokoll_anonymisieren`,
läuft monatlich).
