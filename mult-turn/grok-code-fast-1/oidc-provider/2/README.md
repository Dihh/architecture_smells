# OIDC Provider

A Node.js OIDC provider using Express and SQLite3 with ES Modules.

## Setup

1. Install dependencies: `npm install`
2. Start the server: `npm start`

The server runs on port 4000 by default, configurable via PORT environment variable.

## Endpoints

- GET /health: Returns { "status": "ok" }

## Database

SQLite database `oidc.db` with tables: users, clients, auth_codes, tokens.

Seeded with test data on startup.