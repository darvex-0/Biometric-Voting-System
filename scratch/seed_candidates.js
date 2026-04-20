const pool = require('../db');

async function seed() {
    const connection = await pool.getConnection();
    try {
        await connection.query('DELETE FROM candidates');
        await connection.query('INSERT INTO candidates (name, party_logo_url) VALUES (?, ?), (?, ?), (?, ?)', [
            'Aero Strike', 'https://api.dicebear.com/7.x/identicon/svg?seed=aero',
            'Nova Prime', 'https://api.dicebear.com/7.x/identicon/svg?seed=nova',
            'Cyber Core', 'https://api.dicebear.com/7.x/identicon/svg?seed=cyber'
        ]);
        console.log('Candidates seeded successfully.');
    } catch (err) {
        console.error('Error seeding candidates:', err.message);
    } finally {
        connection.release();
        process.exit();
    }
}

seed();
