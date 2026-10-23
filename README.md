# Deriv Live Charts

A small React + TypeScript + Vite framework for live Deriv synthetic-index candlestick charting.

## Features

- Real historical OHLC candles with candle bodies and wicks
- Live updates over Deriv's WebSocket API
- Timeframes: 1m, 5m, 15m, 30m and 1h
- Market selector populated from Deriv's active symbols
- Dark trading-terminal-style UI
- Pan, zoom, crosshair and price scale from TradingView Lightweight Charts
- No trading actions and no account-token access

## Requirements

- Node.js 20+ recommended
- Yarn
- A registered Deriv application ID (market-data endpoints do not require an account token)

## Run it

```bash
yarn
yarn dev
```

Open the local URL Vite prints, usually http://localhost:5173.

The app starts with Deriv's documented example app ID `1089`. If Deriv rejects it or you want to use your own app, click the settings icon in the top-right and enter your registered Deriv application ID. You can create/manage an app through the Deriv developer portal: https://developers.deriv.com/

## Build

```bash
yarn build
yarn preview
```

## How it works

The frontend opens a secure WebSocket to Deriv. It tries the current endpoint first (`wss://ws.derivws.com/websockets/v3?app_id=YOUR_APP_ID`) and automatically tries the legacy-compatible `ws.binaryws.com` endpoint if the first handshake fails.

It requests active symbols and the latest 500 historical candles on one connection, using `ticks_history` with `style: "candles"` and the selected granularity. It subscribes to the candle stream and applies incoming `ohlc` updates to the active candle. A ping is sent every 25 seconds to keep the connection alive.

Timeframes map to Deriv granularities:
- 1m: 60 seconds
- 5m: 300 seconds
- 15m: 900 seconds
- 30m: 1800 seconds
- 1h: 3600 seconds

The app also requests `active_symbols` to populate the market selector. If symbol discovery is unavailable, it shows a short fallback list of common synthetic symbols.

## Notes

- Data availability depends on the selected symbol and Deriv's market-data service.
- The example app ID `1089` is for testing only and may not be accepted in every environment. Enter your own numeric registered app ID in Settings. If both endpoints fail, check your internet/VPN/firewall/ad blocker; the browser cannot reveal the server handshake reason in every case.
- The chart uses TradingView's open-source Lightweight Charts library, not the licensed TradingView Advanced Charts product.
- This is charting-only: it does not request your Deriv login token and cannot place trades.
# maketmeka
