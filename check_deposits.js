const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./server/database/investment.db');

db.all("SELECT * FROM deposits ORDER BY created_at DESC LIMIT 5", [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log(JSON.stringify(rows, null, 2));
    }
    db.close();
});
