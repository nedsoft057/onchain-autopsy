# On-Chain Autopsy · Termux test

## 1. Install Node

```sh
pkg update
pkg install nodejs-lts unzip
```

## 2. Install the project

```sh
unzip on-chain-autopsy.zip
cd on-chain-autopsy
cp .env.example .env
nano .env
```

Add your provider keys to `.env` (never put them in frontend files): `GOLDRUSH_API_KEY`, `GEMINI_API_KEY`, and/or `GROQ_API_KEY`. Add `SOLANA_RPC_URL` / `EVM_RPC_URL` if you want the RPC enrichment used by the backend.

## 3. Start the app

```sh
npm start
```

Then open `http://127.0.0.1:3000` in your phone browser.

For a deterministic UI/backend smoke test without provider keys, use the fixture `AICORE` in the landing input. Fixture runs use the existing deterministic case data from the supplied backend.

## Flow

`Landing → Trace → Evidence / Verdict`

The trace page streams safe investigation activity and the planner's investigation questions. It deliberately does not expose private model chain-of-thought. The verdict page consumes the completed agent JSON and renders only `scene.markers` as evidence markers.
