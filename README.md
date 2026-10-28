# SoundCloud Command Center

Dark multi-page dashboard for:

- live SoundCloud catalog metrics via OAuth
- imported SoundCloud payout CSV statements
- merged track-level insight between plays and revenue

![SoundCloud Command Center](docs/screenshot.webp)

## Pages

- `overview.html`: live + revenue combined view
- `revenue.html`: payout archive and revenue analytics
- `tracks.html`: per-song explorer with search, filters, and hover details

## Live SoundCloud setup

1. Create a SoundCloud developer app.
2. Add `http://localhost:4173/auth/callback` as the redirect URI.
3. Copy `.env.example` to `.env`.
4. Fill in `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET`.
5. Run `npm start` or `node server.js`.
6. Open `http://localhost:4173/overview.html` and click `Connect SoundCloud`.

## Hosted deployment

GitHub Pages is not enough for the full dashboard because SoundCloud OAuth token exchange requires a server-side `client_secret`.

The workable setup is:

1. Put this repository on GitHub.
2. Deploy it as a Node web service from GitHub using Render.
3. In Render, set these environment variables:
	- `SOUNDCLOUD_CLIENT_ID`
	- `SOUNDCLOUD_CLIENT_SECRET`
	- `SOUNDCLOUD_REDIRECT_URI=https://YOUR-APP.onrender.com/auth/callback`
	- `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` if you want the hosted dashboard protected.
4. In your SoundCloud developer app, add the same hosted callback URL as an allowed redirect URI.
5. Open the hosted URL and connect your SoundCloud account.

The included `render.yaml` file is ready for this deployment flow.

## Revenue archive

- Open `revenue.html`.
- Drag in one or more SoundCloud payout CSV files.
- Reimporting a single-month statement replaces that month.
- Payout files stay in browser storage on the current device.

## Notes

- The live catalog is fetched from `/me` and `/me/tracks` through the local server.
- The payout archive is kept in browser local storage.
- Track matching uses ISRC first, then normalized title matching.
- No account data or payout files are included in this repository: you connect your own SoundCloud app and import your own statements.

## Note

This project was built with AI assistance and tested by hand with a real SoundCloud account: OAuth, catalog fetching and CSV imports were verified end to end.
