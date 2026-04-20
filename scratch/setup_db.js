const pool = require('../db');
const fs = require('fs');
const path = require('path');

async function setupDB() {
    const connection = await pool.getConnection();
    try {
        const schema = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
        // Split by semicolon but ignore inside quotes (simple split for schema.sql)
        const queries = schema
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0);

        for (let query of queries) {
            await connection.query(query);
            console.log(`Executed: ${query.substring(0, 50)}...`);
        }
        console.log('\nNew "voting_system" database and tables created successfully.');
    } catch (err) {
        console.error('Error setting up database:', err.message);
    } finally {
        connection.release();
        process.exit();
    }
}

setupDB();
