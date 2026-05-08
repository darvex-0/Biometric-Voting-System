const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDB() {
    // Connect to MySQL server WITHOUT specifying a database.
    // This allows us to create the database if it does not exist yet.
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true, // Required to run the full schema file
    });

    try {
        console.log('✅ Connected to MySQL server.');
        console.log('⚙️  Running V2 schema migration...\n');

        // 1. Run the schema file (drops old tables, creates new ones)
        const schemaPath = path.join(__dirname, '../schema.sql');
        if (!fs.existsSync(schemaPath)) throw new Error('schema.sql not found.');

        const schema = fs.readFileSync(schemaPath, 'utf8');
        await connection.query(schema);
        console.log('✅ Schema applied successfully.\n');

        // Switch to the voting_system database for seeding
        await connection.query('USE voting_system');

        // 2. Seed test students (Voter Roll)
        console.log('🌱 Seeding test students...');
        const students = [
            ['BCA2024001', 'Rakesh Kumar',   'BCA', 3, 'A'],
            ['BCA2024002', 'Priya Sharma',   'BCA', 3, 'A'],
            ['BCA2024003', 'Arjun Singh',    'BCA', 3, 'B'],
            ['MCA2024001', 'Neha Patel',     'MCA', 1, 'A'],
            ['MCA2024002', 'Vikram Reddy',   'MCA', 2, 'A'],
        ];
        for (const [roll, name, course, year, section] of students) {
            await connection.query(
                'INSERT INTO users (roll_number, name, course, year, section) VALUES (?, ?, ?, ?, ?)',
                [roll, name, course, year, section]
            );
            console.log(`  > Added student: ${roll} — ${name}`);
        }

        // 3. Seed test elections
        console.log('\n🌱 Seeding test elections...');
        const now = new Date();
        const toDate = (offsetHours) => new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
        const [elec1] = await connection.query(
            "INSERT INTO elections (title, allowed_course, allowed_year, allowed_section, start_at, end_at, result_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ['BCA 3rd Year Class Representative - Section A', 'BCA', 3, 'A', toDate(-2), toDate(6), toDate(8), 'Active']
        );
        const [elec2] = await connection.query(
            "INSERT INTO elections (title, allowed_course, allowed_year, allowed_section, start_at, end_at, result_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ['College Cultural Fest Head Election', null, null, null, toDate(12), toDate(18), toDate(24), 'Upcoming']
        );
        const [elec3] = await connection.query(
            "INSERT INTO elections (title, allowed_course, allowed_year, allowed_section, start_at, end_at, result_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ['2023 Annual Student Excellence Award', null, null, null, toDate(-48), toDate(-24), toDate(-1), 'Closed']
        );
        console.log(`  > Created election ID ${elec1.insertId}: BCA 3rd Year CR (Active)`);
        console.log(`  > Created election ID ${elec2.insertId}: Cultural Fest Head (Upcoming)`);
        console.log(`  > Created election ID ${elec3.insertId}: 2023 Excellence Award (Released)`);

        // 4. Seed candidates for each election
        console.log('\n🌱 Seeding candidates...');
        const candidates = [
            [elec1.insertId, 'Ramesh Verma',     'https://api.dicebear.com/7.x/initials/svg?seed=RV'],
            [elec1.insertId, 'Sunita Nair',      'https://api.dicebear.com/7.x/initials/svg?seed=SN'],
            [elec2.insertId, 'Aarav Mehta',      'https://api.dicebear.com/7.x/initials/svg?seed=AM'],
            [elec2.insertId, 'Divya Krishnan',   'https://api.dicebear.com/7.x/initials/svg?seed=DK'],
            [elec3.insertId, 'John Doe',         'https://api.dicebear.com/7.x/initials/svg?seed=JD'],
            [elec3.insertId, 'Jane Smith',       'https://api.dicebear.com/7.x/initials/svg?seed=JS'],
            [elec3.insertId, 'Alice Wong',       'https://api.dicebear.com/7.x/initials/svg?seed=AW'],
        ];
        const candidateIds = [];
        for (const [eid, name, logo] of candidates) {
            const [res] = await connection.query(
                'INSERT INTO candidates (election_id, name, party_logo_url) VALUES (?, ?, ?)',
                [eid, name, logo]
            );
            if (eid === elec3.insertId) candidateIds.push(res.insertId);
            console.log(`  > Added candidate: ${name} → Election ${eid}`);
        }

        // 5. Seed sample votes for the Released election (elec3)
        console.log('\n🗳️  Seeding 52 sample ballots for Election ID ' + elec3.insertId + '...');
        for (let i = 0; i < 52; i++) {
            const randomCand = candidateIds[Math.floor(Math.random() * candidateIds.length)];
            const ballot = { candidateId: randomCand, electionId: elec3.insertId, timestamp: Date.now() - (i * 100000), nonce: Math.random().toString(36) };
            const encrypted = Buffer.from('E2EE_V1_' + Buffer.from(JSON.stringify(ballot)).toString('base64')).toString('base64');
            
            await connection.query(
                'INSERT INTO votes (election_id, encrypted_ballot, cast_at) VALUES (?, ?, ?)',
                [elec3.insertId, encrypted, toDate(-2 - (i / 10))]
            );
        }
        console.log('  > Successfully seeded 52 anonymous votes.');

        console.log('\n============================================');
        console.log('🎉 V2 Database initialized & seeded!');
        console.log('============================================');
        console.log('\n📋 Test Voter Roll:');
        console.log('  BCA2024001 — Rakesh Kumar   (BCA, Year 3, Sec A)');
        console.log('  BCA2024002 — Priya Sharma   (BCA, Year 3, Sec A)');
        console.log('  BCA2024003 — Arjun Singh    (BCA, Year 3, Sec B)');
        console.log('  MCA2024001 — Neha Patel     (MCA, Year 1, Sec A)');
        console.log('  MCA2024002 — Vikram Reddy   (MCA, Year 2, Sec A)');
        console.log('\n🗳️  Active Elections:');
        console.log(`  ID ${elec1.insertId} — BCA 3rd Year CR (Sec A only)`);
        console.log(`  ID ${elec2.insertId} — Cultural Fest Head (All eligible)`);

    } catch (err) {
        console.error('\n❌ ERROR during setup:', err.message);
    } finally {
        await connection.end();
        process.exit();
    }
}

setupDB();
