# Blomstra
*Blomstra – I varje fas*

En app för att logga mens och få hem mensskydd

## Webbapp (HTML + CSS)

Öppna `valkommen.html` i en webbläsare (de andra sidorna skickar dit om man inte är inloggad).

| Fil | Skärm |
|---|---|
| `valkommen.html` | Välkomstsida: skapa konto eller logga in |
| `registrera.html` | Skapa konto + frågor om ålder, cykel, preventivmedel och mensskydd (går att hoppa över) |
| `loggain.html` | Logga in |
| `index.html` | Översikt (hälsar med ditt namn) |
| `logga.html` | Logga mens, symtom (`?typ=symtom`) eller sex (`?typ=sex`, med eller utan skydd) |
| `leverans.html` | Mensen närmar sig |
| `paket.html` | Ditt paket |
| `rackte.html` | Räckte ditt paket? |
| `kalender.html` | Kalender (månadsvy med mens, beräknad mens, ägglossning) |
| `historik.html` | Menshistorik: alla mensperioder, hur länge de varade och cykellängd (nås från Kalender) |
| `profil.html` | Profil och inställningar |
| `kronblad.html` | Kronblad – poäng: +2 i välkomstgåva, +1 per skickad leverans och +1 per svar på "Räckte ditt paket?". 10 kronblad = välj en belöning (nås via märket uppe till höger, som visar en notis med antal nya kronblad) |
| `faser.html` | Cykelns faser (nås från fas-popupen på översikten) |

`styles.css` innehåller alla stilar (färger som variabler i `:root`). `auth.js` sköter konton, inloggning och svarsalternativen. `onboarding.js` sköter inloggning och frågorna vid registreringen. `app.js` sköter resten: cykeln, loggning, paket, kalender och profil.

**Obs:** konton och data sparas bara i webbläsaren på den här enheten (lösenord som saltad SHA-256). Det är en prototyp – en riktig app behöver en server för konton.
