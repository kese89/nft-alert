# NFT Alert (EVM)

Watches newly created EVM NFT collections on OpenSea and alerts you on Telegram when one starts gaining real momentum. Free to run: the OpenSea API key and the Telegram Bot API cost nothing.

## How it works

Two watchers run in parallel:

**1. New collection discovery (silent)** — polls the most recently created collections on the configured chains (Ethereum + Base by default) every 5 minutes and silently adds them to momentum tracking. It does not alert per collection: new collections appear on OpenSea every minute, so per-collection alerts would be unusable noise. Set `NEW_DIGEST_HOURS` (e.g. 24) if you want a short periodic digest.

**2. Momentum watcher** — tracks collections discovered in the past 7 days (max 300), tiered: the newest 30 "hot" collections are measured every 5 minutes, the rest every 15. Two alert paths:

- **Early velocity signal**: holder count grows by at least +20/hour across TWO consecutive measurements (the confirmation filters out spikes), with at least 40 holders. This fires hours before classic thresholds.
- **Level signal**: 24h volume + sales count + holder count + holder growth combined.

Before any alert goes out, a **verification** step runs: the unique buyer ratio of recent sales. If a handful of wallets are ping-ponging the volume (wash trading), the alert is held back and the collection gets a 2-hour cooldown. Alerts include holder velocity, unique buyer %, and the floor price direction (⬆/→/⬇ — a falling floor with growing holders means someone is dumping into the demand). Each collection alerts at most once.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - **OPENSEA_API_KEY**: opensea.io → sign in → Settings → Developer → Create API key (free)
   - **BOT_TOKEN**: create a bot with [@BotFather](https://t.me/BotFather) → `/newbot`
   - **CHAT_ID**: message your bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and find `"chat":{"id":...}`
3. `npm start` — sends a startup test message

State is persisted to `state.json`, so restarts don't re-alert on collections already seen. For background use: `pm2 start src/index.js --name nft-alert`.

## Tuning

Too many alerts: raise `MIN_OWNER_VELOCITY` (the main knob) or `MIN_UNIQUE_BUYER_RATIO`. Too few: lower them. The "right" values depend on market conditions — start with the defaults and adjust after a week.

## Honest limitations

- A momentum alert tells you WHAT is moving — WHY, and whether it lasts, is your judgment (team track record, what's promised, who's behind it).
- The unique-buyer filter makes manipulation harder, not impossible (sybil wallets can game it, just at a higher cost).
- This is a discovery tool, not financial advice. Most new NFT collections go to zero.
