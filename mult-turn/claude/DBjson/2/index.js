const { loadDb } = require('./src/db');
const { createServer } = require('./src/server');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH;

const db = loadDb(DB_PATH);
const app = createServer(db, DB_PATH);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
