require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'super-secret-voting-key',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 3600000, // 1 hour
    },
}));

// RP (Relying Party) Information
const rpName = 'SBVS Secure Voting';

// --- WebAuthn Registration ---

app.get('/auth/register-options', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: 'Username is required' });

        const rpID = req.hostname;

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userID: Buffer.from(username),
            userName: username,
            attestationType: 'none',
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
                authenticatorAttachment: 'platform',
            },
        });

        req.session.currentChallenge = options.challenge;
        req.session.username = username;

        res.json(options);
    } catch (err) {
        console.error("Register Options Error:", err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

app.post('/auth/verify-registration', async (req, res) => {
    const { body } = req;
    const { currentChallenge, username } = req.session;

    if (!currentChallenge) return res.status(400).json({ error: 'Challenge not found in session' });

    try {
        const expectedOrigin = req.get('origin');
        const rpID = req.hostname;

        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: currentChallenge,
            expectedOrigin: expectedOrigin,
            expectedRPID: rpID,
        });

        if (verification.verified) {
            const { registrationInfo } = verification;
            const { credential } = registrationInfo;
            const { id, publicKey, counter } = credential;

            // Store JSON string of the credential
            const public_key = JSON.stringify({
                // SimpleWebAuthn v11+ makes id a string (base64url)
                credentialID: id,
                credentialPublicKey: Buffer.from(publicKey).toString('base64'),
                counter,
            });

            // Save to database
            await pool.query(
                'INSERT INTO users (username, public_key) VALUES (?, ?) ON DUPLICATE KEY UPDATE public_key = ?',
                [username, public_key, public_key]
            );

            delete req.session.currentChallenge;
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// --- WebAuthn Login ---

app.get('/auth/login-options', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: 'Username is required' });

        const [users] = await pool.query('SELECT public_key FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });

        const userKey = JSON.parse(users[0].public_key);
        const rpID = req.hostname;

        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials: [{
                id: userKey.credentialID,
                type: 'public-key',
                transports: ['internal'],
            }],
            userVerification: 'preferred',
        });

        req.session.currentChallenge = options.challenge;
        req.session.username = username;

        res.json(options);
    } catch (err) {
        console.error("Login Options Error:", err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

app.post('/auth/verify-authentication', async (req, res) => {
    const { body } = req;
    const { currentChallenge, username } = req.session;

    if (!currentChallenge) return res.status(400).json({ error: 'Challenge not found in session' });

    try {
        const [users] = await pool.query('SELECT public_key FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });

        const userKey = JSON.parse(users[0].public_key);
        const expectedOrigin = req.get('origin');
        const rpID = req.hostname;

        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: currentChallenge,
            expectedOrigin: expectedOrigin,
            expectedRPID: rpID,
            credential: {
                id: userKey.credentialID,
                publicKey: Buffer.from(userKey.credentialPublicKey, 'base64'),
                counter: userKey.counter,
            },
        });

        if (verification.verified) {
            req.session.authenticated = true;
            delete req.session.currentChallenge;
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// --- Voting Endpoints ---

app.get('/candidates', async (req, res) => {
    try {
        const [candidates] = await pool.query('SELECT * FROM candidates');
        res.json(candidates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/cast-vote', async (req, res) => {
    if (!req.session.authenticated || !req.session.username) {
        return res.status(401).json({ error: 'Unauthorized. Please login using biometrics.' });
    }

    const { encrypted_ballot, assertion } = req.body;
    if (!encrypted_ballot || !assertion) {
        return res.status(400).json({ error: 'Missing physical biometric confirmation or ballot.' });
    }

    const currentChallenge = req.session.currentChallenge;
    if (!currentChallenge) {
        return res.status(400).json({ error: 'Session challenge expired. Please refresh the page.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 0. Verify the WebAuthn signature to prove they physically touched the sensor
        const [users] = await connection.query('SELECT public_key FROM users WHERE username = ?', [req.session.username]);
        if (users.length === 0) throw new Error('Voter not found in database.');

        const userKey = JSON.parse(users[0].public_key);
        const expectedOrigin = req.get('origin');
        const rpID = req.hostname;

        const verification = await verifyAuthenticationResponse({
            response: assertion,
            expectedChallenge: currentChallenge,
            expectedOrigin: expectedOrigin,
            expectedRPID: rpID,
            credential: {
                id: userKey.credentialID,
                publicKey: Buffer.from(userKey.credentialPublicKey, 'base64'),
                counter: userKey.counter,
            },
        });

        if (!verification.verified) throw new Error('Biometric signature failed verification!');

        // 1. Check if user already voted
        const [userCheck] = await connection.query('SELECT has_voted FROM users WHERE username = ?', [req.session.username]);
        if (userCheck[0].has_voted) {
            throw new Error('Duplicate vote detected. You have already cast your ballot.');
        }

        // 2. Mark user as having voted
        await connection.query('UPDATE users SET has_voted = TRUE WHERE username = ?', [req.session.username]);

        // 3. Deposit the encrypted ballot
        await connection.query('INSERT INTO votes (encrypted_ballot) VALUES (?)', [encrypted_ballot]);

        await connection.commit();
        res.json({ success: true, message: 'Your encrypted vote has been securely cast.' });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- Admin Endpoints ---

app.get('/api/admin/stats', async (req, res) => {
    try {
        const [[totalUsersRows]] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [[votedUsersRows]] = await pool.query('SELECT COUNT(*) as voted FROM users WHERE has_voted = TRUE');
        
        res.json({
            total_registered: totalUsersRows.total,
            total_votes: votedUsersRows.voted
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/votes', async (req, res) => {
    try {
        const [votes] = await pool.query('SELECT encrypted_ballot, created_at FROM votes ORDER BY created_at DESC');
        res.json(votes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/candidates', async (req, res) => {
    const { name, party_logo_url } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Candidate name is required' });
    }
    
    try {
        const [result] = await pool.query('INSERT INTO candidates (name, party_logo_url) VALUES (?, ?)', [name, party_logo_url || null]);
        res.json({ success: true, candidate: { id: result.insertId, name, party_logo_url } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`SBVS Server running at http://localhost:${PORT}`);
});
