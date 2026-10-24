# BespaarSlim — bank koppelen aan je website (persoonlijk testproject)

BespaarSlim heeft een Nederlandstalige GitHub-Pages-website en een apart te publiceren Cloudflare Worker voor **alleen-lezen** banktransacties via Enable Banking (PSD2). Zonder ingeschakelde backend is de website een lokaal financieel dashboard met voorbeeldgegevens. Er is **nog geen bank daadwerkelijk verbonden**.

## Bestanden

- `index.html` — deze upload je op GitHub Pages.
- `worker.js` — beveiligde backendcode; draait op Cloudflare Workers, niet op GitHub Pages.
- `wrangler.toml` — de instellingen voor het publiceren van de Worker.
- `.gitignore` — helpt voorkomen dat privésleutels in GitHub belanden.

## Stappen voor de bankkoppeling

### 1. Website publiceren op GitHub Pages

1. Maak een nieuwe GitHub-repository en upload `index.html` als `index.html` in de hoofdmap.
2. Ga naar **Settings → Pages → Deploy from a branch → main / (root)**.
3. Noteer de daadwerkelijke URL, bijv. `https://gebruikersnaam.github.io/bespaarslim/`.
4. De rest van de bestanden mag je in een private repository bewaren, maar deel **geen** geheimen.

### 2. Enable Banking-account en applicatie aanvragen

1. Meld je aan via <https://enablebanking.com/sign-in/>.
2. Registreer een API-app via het Enable Banking Control Panel. **SANDBOX** is om te testen; voor een **echte** Nederlandse bank moet de app in **PRODUCTION** staan en actief/goedgekeurd zijn. Neem zo nodig contact op met Enable Banking voor de benodigde overeenkomst. Een productieapp kan vereisen dat je de privacyverklaring, voorwaarden en contactgegevens opgeeft; controleer hun actuele vereisten en prijzen. Voor eigen rekeningen kan Enable Banking een whitelistingmogelijkheid bieden.
3. Maak bij de registratie een private RSA-sleutel aan (download het `.pem`-bestand) óf volg hun instructies om een certificaat en private sleutel te maken.
4. Noteer je **Application ID**. Registreer later bij je app als redirect URL **precies** `https://JOUW_WORKER.workers.dev/callback`.
5. Bewaar de `.pem`-sleutel **uitsluitend op je eigen computer** en als Cloudflare Worker Secret, nooit in GitHub, HTML of de browser. Gebruik een geldige PEM PKCS#8-sleutel (begint `-----BEGIN PRIVATE KEY-----`). Indien nodig kun je een traditionele RSA-sleutel omzetten met `openssl pkcs8 -topk8 -nocrypt -in private.key -out private.pkcs8.pem`.

Bronnen: <https://enablebanking.com/docs/api/quick-start/> en <https://enablebanking.com/docs/api/reference/>.

### 3. Cloudflare Worker aanmaken

1. Maak een Cloudflare-account: <https://dash.cloudflare.com/>.
2. Installeer Node.js op je computer: <https://nodejs.org/>.
3. Download dit pakket, pak het uit en open een terminal in de uitgepakte map.
4. Voer uit:

   ```sh
   npx wrangler login
   npx wrangler kv namespace create BANK_KV
   ```

5. Kopieer de vermelde KV-namespace-id naar `wrangler.toml`. Vervang daar ook `FRONTEND_URL` en `WORKER_URL` door de echte URLs. **Let op:** je Cloudflare-account-subdomein staat achter `.workers.dev`; de precieze URL krijg je bij de eerste deploy. Vergeet de callback URL bij Enable Banking niet.
6. Stel de drie geheime waarden via Cloudflare in:

   ```sh
   npx wrangler secret put ENABLE_APP_ID
   npx wrangler secret put ENABLE_PRIVATE_KEY < private.pkcs8.pem
   # Genereer een lang willekeurig toegangstoken en bewaar het privé:
   openssl rand -hex 32
   npx wrangler secret put APP_ACCESS_TOKEN
   ```

   Na `ENABLE_APP_ID` vul je de app-id in. Bij `APP_ACCESS_TOKEN` plak je de net gegenereerde 64 hextekens. Je geeft deze **dezelfde** toegangscode later in BespaarSlim op. De waarden worden server-side bewaard. Als `wrangler secret put` meldt dat je eerst een Worker moet maken, voer dan `npx wrangler deploy` uit met de ingevulde configuratie, en daarna de drie secret-opdrachten.
7. Publiceer:

   ```sh
   npx wrangler deploy
   ```

8. Controleer of `WORKER_URL` in `wrangler.toml` overeenkomt met de uitgerolde Worker. Publiceer opnieuw als je de URL moet veranderen.

### 4. Koppelen in je website

1. Open je GitHub Pages-site en klik op **Bank koppelen**.
2. Vul je Cloudflare Worker-URL en je persoonlijke toegangstoken in. Klik **Verbinding controleren**.
3. Kies jouw bank uit de actuele lijst. Deze verschijnt alleen als je Enable Banking-app voor deze bank toegang heeft.
4. Klik **Veilig koppelen via mijn bank**. De toestemming vindt plaats bij je bank via de officiële PSD2-stroom. BespaarSlim vraagt niet om je bankwachtwoord.
5. Na terugkeer klik je op **Transacties ophalen**. De connector haalt maximaal ongeveer de afgelopen drie maanden op, afhankelijk van wat de bank toestaat.
6. Een tweede keer ophalen voegt in principe alleen nieuwe transactie-ID's toe. Automatische achtergrondsynchronisatie is **niet** ingebouwd. Om te stoppen, klik **Koppeling intrekken** en trek de toestemming ook bij je bank in als dat nodig is.

## Belangrijke veiligheid en beperkingen

- **GitHub Pages is alleen statische hosting:** echte bankkoppelingen vereisen een externe backend vanwege API-privésleutels. Publiceer die sleutels nooit in JavaScript, een publieke repository of queryparameters.
- Deze connector is bedoeld als **persoonlijk prototype**, niet als multi-user online bankdienst. Publiceer of gebruik dit niet voor andere gebruikers zonder professionele beveiliging, gebruikersauthenticatie, dataminimalisatie, monitoring, privacy- en juridische toetsing. Een lang geheim toegangstoken is geen volwaardig accountsysteem.
- De bankinformatie en bankaccount-referenties staan tijdelijk in Cloudflare KV zolang de bankkoppeling actief is; opgehaalde transacties worden in de **lokale opslag van je browser** bewaard. Andere personen die dezelfde browser of hetzelfde apparaat gebruiken, kunnen die transacties mogelijk zien. Exportbestanden zijn eveneens gevoelig. Gebruik geen gedeelde computers.
- De backend bevat **geen betaal-API**. Je kunt geen geld overmaken of abonnementen automatisch opzeggen.
- Na het ophalen van echte transacties telt het dashboard geen geschatte abonnementskosten meer bovenop geboekte banktransacties, om dubbeltellingen te vermijden. Een als abonnement gecategoriseerde banktransactie betekent niet automatisch dat een contract werkelijk is opgezegd.
- Koppelen en synchroniseren kunnen mislukken wanneer een bank geen toegang geeft, het account verlopen is, een API-limiet is bereikt of de bank informatie anders aanlevert. Productietoegang en eventuele kosten zijn afhankelijk van Enable Banking.
- De implementatie is ontworpen op basis van de gepubliceerde Enable Banking-API. Zonder echte API-sleutel en banktoestemming is de live koppeling **niet end-to-end tegen een echte bank getest**.

**Documentatie**: https://enablebanking.com/docs/api/reference/ | https://developers.cloudflare.com/workers/ | https://developers.cloudflare.com/kv/
