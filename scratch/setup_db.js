const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDB() {
    // 1. Create a temporary connection without a database selected
    // This allows us to create the database if it doesn't exist
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
    });

    try {
        console.log('Connected to MySQL server...');
        
        // 2. Read the schema file
        const schemaPath = path.join(__dirname, '../schema.sql');
        if (!fs.existsSync(schemaPath)) {
            throw new Error('schema.sql not found in the root directory.');
        }
        
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // 3. Split by semicolon (ignoring empty queries)
        const queries = schema
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0);

        console.log('Starting database initialization...');

        // 4. Execute queries sequentially
        for (let query of queries) {
            await connection.query(query);
            // Log just the start of the query for cleaner output
            const preview = query.split('\n')[0].substring(0, 60);
            console.log(`> ${preview}...`);
        }
        
        console.log('\n✅ DONE! "voting_system" database and all tables are ready.');
    } catch (err) {
        console.error('\n❌ ERROR during setup:', err.message);
    } finally {
        await connection.end();
        process.exit();
    }
}

setupDB();
