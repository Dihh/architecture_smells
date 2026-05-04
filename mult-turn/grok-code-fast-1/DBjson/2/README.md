# DB JSON Server

A Node.js Express server that loads a JSON database and provides a health endpoint.

## Setup

1. Install dependencies: `npm install`
2. Set environment variables:
   - `PORT`: Server port (default 3000)
   - `DB_PATH`: Path to the JSON database file
3. Run the server: `npm start`

## Endpoints

- `GET /health`: Returns `{ "status": "ok" }`

## Database

The server loads a JSON file specified by `DB_PATH`. If the file does not exist or is invalid, it initializes with:
```json
{
  "_users": [],
  "_teams": []
}
```