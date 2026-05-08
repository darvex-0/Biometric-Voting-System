require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
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
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === 'true' || isProduction;
const sessionCookieSameSite = process.env.SESSION_COOKIE_SAME_SITE || (sessionCookieSecure ? 'none' : 'lax');
const trustProxy = process.env.TRUST_PROXY === 'true' || sessionCookieSecure;
const ballotPublicKey = process.env.BALLOT_PUBLIC_KEY?.replace(/\\n/g, '\n');
const ballotPrivateKey = process.env.BALLOT_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (isProduction && !sessionSecret) {
    throw new Error('SESSION_SECRET must be set in production.');
}

if (!sessionSecret) {
    console.warn('SESSION_SECRET is not set. Using an insecure development fallback secret.');
}

if (!ballotPublicKey || !ballotPrivateKey) {
    console.warn('Ballot encryption keys are not configured. Secure ballot encryption is unavailable until BALLOT_PUBLIC_KEY and BALLOT_PRIVATE_KEY are set.');
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.disable('x-powered-by');
if (trustProxy) {
    app.set('trust proxy', 1);
}
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    if (sessionCookieSecure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});
app.use(express.static('public'));
app.use(session({
    name: 'dbpvs.sid',
    secret: sessionSecret || 'dev-only-insecure-session-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: {
        secure: sessionCookieSecure,
        httpOnly: true,
        sameSite: sessionCookieSameSite,
        maxAge: 3600000,
    },
}));

const rpName = 'DBPVS Secure Voting';

function isAdminAuthConfigured() {
    return Boolean(adminUsername && adminPassword);
}

function requireAdmin(req, res, next) {
    if (!req.session.adminAuthenticated) {
        return res.status(401).json({ error: 'Admin authentication required.' });
    }
    next();
}

function requireBallotEncryptionKeys(req, res, next) {
    if (!ballotPublicKey || !ballotPrivateKey) {
        return res.status(503).json({ error: 'Ballot encryption keys are not configured.' });
    }
    next();
}

function decryptBallotPayload(encryptedBallot) {
    if (!encryptedBallot || typeof encryptedBallot !== 'string') return null;

    // 1. Support Simulation Prefix (used in test seeding)
    const simPrefix = 'E2EE_V1_';
    let outer = encryptedBallot;
    
    // Check if the input is double-base64 encoded (which setup_db.js does)
    try {
        const decoded = Buffer.from(encryptedBallot, 'base64').toString('utf8');
        if (decoded.startsWith(simPrefix)) outer = decoded;
    } catch (e) {}

    if (outer.startsWith(simPrefix)) {
        try {
            const innerBase = outer.replace(simPrefix, '');
            return JSON.parse(Buffer.from(innerBase, 'base64').toString('utf8'));
        } catch (e) { return null; }
    }

    // 2. Support Real RSA Prefix
    const prefix = 'RSA_OAEP_SHA256_V1:';
    if (!encryptedBallot.startsWith(prefix)) return null;

    try {
        const ciphertext = Buffer.from(encryptedBallot.slice(prefix.length), 'base64');
        const plaintext = crypto.privateDecrypt(
            {
                key: ballotPrivateKey,
                oaepHash: 'sha256',
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            },
            ciphertext
        );
        return JSON.parse(plaintext.toString('utf8'));
    } catch (e) { return null; }
}

function getElectionPhase(election, now = new Date()) {
    const startAt = new Date(election.start_at);
    const endAt = new Date(election.end_at);
    const resultAt = new Date(election.result_at);

    // 1. If we are past the result release time, it's ALWAYS results_released
    if (now >= resultAt) return 'results_released';

    // 2. If we are past the voting end time, it's CLOSED (waiting for results)
    if (now > endAt) return 'closed_waiting';

    // 3. If we are between start and end, it's ACTIVE
    if (now >= startAt && now <= endAt) return 'active';

    // 4. Otherwise, it's SCHEDULED (upcoming)
    return 'scheduled';
}

function getVoterElectionPhase(election, now = new Date()) {
    // A separate helper specifically for the voter view to ensure strictness
    const startAt = new Date(election.start_at);
    const endAt = new Date(election.end_at);
    const resultAt = new Date(election.result_at);

    if (now >= resultAt) return 'results_released';
    if (now > endAt) return 'closed';
    if (now >= startAt) return 'active';
    return 'scheduled';
}

function serializeElectionForClient(election, now = new Date()) {
    const phase = getElectionPhase(election, now);
    return {
        ...election,
        phase,
        can_vote: phase === 'voting_open',
        results_available: phase === 'results_released',
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: WebAuthn — Kiosk Registration (Admin-Unlocked Only)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/ballot-public-key', requireBallotEncryptionKeys, (req, res) => {
    res.json({
        algorithm: 'RSA-OAEP',
        hash: 'SHA-256',
        publicKeyPem: ballotPublicKey,
    });
});

app.get('/auth/register-options', async (req, res) => {
    const { rollNumber } = req.query;
    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });

    try {
        const [rows] = await pool.query(
            'SELECT name, is_registered, registration_unlocked FROM users WHERE roll_number = ?',
            [rollNumber]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Student not found in voter roll. Contact your Admin.' });
        
        const student = rows[0];
        if (student.is_registered) return res.status(409).json({ error: 'This Roll Number is already registered. Use Login instead.' });
        if (!student.registration_unlocked) return res.status(403).json({ error: 'Registration locked. An Admin must unlock you at the kiosk first.' });

        const rpID = req.hostname;
        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userID: Buffer.from(rollNumber),
            userName: rollNumber,
            userDisplayName: student.name,
            attestationType: 'none',
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
                authenticatorAttachment: 'platform',
            },
        });

        req.session.currentChallenge = options.challenge;
        req.session.rollNumber = rollNumber;
        res.json(options);
    } catch (err) {
        console.error('Register Options Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/auth/verify-registration', async (req, res) => {
    const { currentChallenge, rollNumber } = req.session;
    if (!currentChallenge) return res.status(400).json({ error: 'Challenge expired. Start over.' });

    try {
        const rpID = req.hostname;
        const verification = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge: currentChallenge,
            expectedOrigin: req.get('origin'),
            expectedRPID: rpID,
        });

        if (verification.verified) {
            const { credential } = verification.registrationInfo;
            const { id, publicKey, counter } = credential;

            const public_key = JSON.stringify({
                credentialID: id,
                credentialPublicKey: Buffer.from(publicKey).toString('base64'),
                counter,
            });

            await pool.query(
                'UPDATE users SET public_key = ?, credential_id = ?, is_registered = TRUE, registration_unlocked = FALSE WHERE roll_number = ?',
                [public_key, id, rollNumber]
            );

            delete req.session.currentChallenge;
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Biometric verification failed.' });
        }
    } catch (err) {
        console.error('Verify Registration Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: WebAuthn — Voter Login
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/auth/login-options', async (req, res) => {
    const { rollNumber } = req.query;
    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });

    try {
        const [rows] = await pool.query(
            'SELECT public_key, is_registered FROM users WHERE roll_number = ?',
            [rollNumber]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Student not found. Contact your Admin.' });
        if (!rows[0].is_registered) return res.status(403).json({ error: 'Biometric not registered yet. Visit the kiosk.' });

        const userKey = JSON.parse(rows[0].public_key);
        const rpID = req.hostname;

        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials: [{ id: userKey.credentialID, type: 'public-key', transports: ['internal'] }],
            userVerification: 'preferred',
        });

        req.session.currentChallenge = options.challenge;
        req.session.rollNumber = rollNumber;
        res.json(options);
    } catch (err) {
        console.error('Login Options Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/auth/verify-authentication', async (req, res) => {
    const { currentChallenge, rollNumber } = req.session;
    if (!currentChallenge) return res.status(400).json({ error: 'Challenge expired.' });

    try {
        const [rows] = await pool.query('SELECT public_key FROM users WHERE roll_number = ?', [rollNumber]);
        if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });

        const userKey = JSON.parse(rows[0].public_key);
        const rpID = req.hostname;

        const verification = await verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge: currentChallenge,
            expectedOrigin: req.get('origin'),
            expectedRPID: rpID,
            credential: {
                id: userKey.credentialID,
                publicKey: Buffer.from(userKey.credentialPublicKey, 'base64'),
                counter: userKey.counter,
            },
        });

        if (verification.verified) {
            req.session.authenticated = true;
            req.session.rollNumber = rollNumber;
            delete req.session.currentChallenge;
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Authentication failed.' });
        }
    } catch (err) {
        console.error('Verify Authentication Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Voting — Eligibility-Gated Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

// Returns elections the voter is eligible for, including those with released results
// Returns elections the voter is eligible for, including those with released results
app.get('/elections', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized.' });

    try {
        const [voter] = await pool.query(
            'SELECT course, year, section FROM users WHERE roll_number = ?',
            [req.session.rollNumber]
        );
        if (voter.length === 0) return res.status(404).json({ error: 'Voter not found.' });
        const { course, year, section } = voter[0];
        const now = new Date();

        // Match elections where voter metadata satisfies the rule
        // Include 'Active' (for voting) and 'Closed' (for results)
        const [rows] = await pool.query(`
            SELECT e.*, 
                   EXISTS(
                       SELECT 1 FROM voter_participation vp 
                       WHERE vp.roll_number = ? AND vp.election_id = e.id
                   ) as already_voted
            FROM elections e
            WHERE (e.status = 'Active' OR e.status = 'Closed' OR e.status = 'Upcoming')
              AND (e.allowed_course  IS NULL OR e.allowed_course  = ?)
              AND (e.allowed_year    IS NULL OR e.allowed_year    = ?)
              AND (e.allowed_section IS NULL OR e.allowed_section = ?)
        `, [req.session.rollNumber, course, year, section]);

        // Add phase information and filter for results visibility
        const elections = rows
            .map(e => ({ 
                ...e, 
                phase: getVoterElectionPhase(e) 
            }))
            .filter(e => {
                // Show everything except things that haven't even been scheduled yet (safety)
                return e.phase !== 'unknown';
            });

        res.json(elections);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public results endpoint for voters (only works if phase is results_released)
// Server decrypts and tallies — the private key NEVER leaves the server.
app.get('/api/public/results/:electionId', async (req, res) => {
    const { electionId } = req.params;
    try {
        const [rows] = await pool.query('SELECT * FROM elections WHERE id = ?', [electionId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Election not found.' });

        const election = rows[0];
        const phase = getElectionPhase(election);

        if (phase !== 'results_released') {
            return res.status(403).json({ error: 'Results for this election have not been released yet.' });
        }

        const [candidates] = await pool.query('SELECT id, name, party_logo_url FROM candidates WHERE election_id = ?', [electionId]);
        const [votes] = await pool.query('SELECT encrypted_ballot FROM votes WHERE election_id = ?', [electionId]);

        // Server-side tally using the private key
        const tally = {};
        candidates.forEach(c => { tally[c.id] = 0; });

        let validVotes = 0;
        let invalidVotes = 0;

        votes.forEach(vote => {
            try {
                const decrypted = decryptBallotPayload(vote.encrypted_ballot);
                if (decrypted && decrypted.candidateId && tally[decrypted.candidateId] !== undefined) {
                    tally[decrypted.candidateId]++;
                    validVotes++;
                } else {
                    invalidVotes++;
                }
            } catch {
                invalidVotes++;
            }
        });

        // Return pre-tallied results — no encrypted data sent to client
        const results = candidates.map(c => ({
            id: c.id,
            name: c.name,
            party_logo_url: c.party_logo_url,
            votes: tally[c.id] || 0,
        }));

        res.json({
            election: { id: election.id, title: election.title, result_at: election.result_at },
            candidates: results,
            totalVotes: votes.length,
            validVotes,
            invalidVotes,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Returns candidates for a specific election
app.get('/candidates', async (req, res) => {
    const { electionId } = req.query;
    if (!electionId) return res.status(400).json({ error: 'electionId is required.' });

    try {
        const [candidates] = await pool.query(
            'SELECT * FROM candidates WHERE election_id = ?',
            [electionId]
        );
        res.json(candidates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cast vote: verify biometrics → check eligibility → prevent double vote → record anonymously
app.get('/elections/:id/results', requireBallotEncryptionKeys, async (req, res) => {
    if (!req.session.authenticated || !req.session.rollNumber) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    const electionId = Number(req.params.id);
    if (!Number.isInteger(electionId)) {
        return res.status(400).json({ error: 'Invalid election id.' });
    }

    try {
        const [voterRows] = await pool.query(
            'SELECT course, year, section FROM users WHERE roll_number = ?',
            [req.session.rollNumber]
        );
        if (voterRows.length === 0) return res.status(404).json({ error: 'Voter not found.' });

        const [electionRows] = await pool.query('SELECT * FROM elections WHERE id = ?', [electionId]);
        if (electionRows.length === 0) return res.status(404).json({ error: 'Election not found.' });

        const election = electionRows[0];
        const voter = voterRows[0];
        if (election.allowed_course  && election.allowed_course  !== voter.course)  return res.status(403).json({ error: 'You are not eligible to view this election.' });
        if (election.allowed_year    && election.allowed_year    !== voter.year)    return res.status(403).json({ error: 'You are not eligible to view this election.' });
        if (election.allowed_section && election.allowed_section !== voter.section) return res.status(403).json({ error: 'You are not eligible to view this election.' });

        if (getElectionPhase(election) !== 'results_released') {
            return res.status(403).json({ error: 'Results are not available yet.' });
        }

        const [candidateRows] = await pool.query(
            'SELECT id, name, party_logo_url FROM candidates WHERE election_id = ? ORDER BY id ASC',
            [electionId]
        );
        const [voteRows] = await pool.query(
            'SELECT encrypted_ballot FROM votes WHERE election_id = ?',
            [electionId]
        );

        const tally = Object.fromEntries(candidateRows.map((candidate) => [String(candidate.id), 0]));
        let totalValidVotes = 0;

        for (const vote of voteRows) {
            try {
                const ballot = decryptBallotPayload(vote.encrypted_ballot);
                const candidateId = String(ballot.candidateId);
                if (Object.prototype.hasOwnProperty.call(tally, candidateId)) {
                    tally[candidateId] += 1;
                    totalValidVotes += 1;
                }
            } catch (err) {
                // Ignore malformed ballots in public result tallies.
            }
        }

        res.json({
            election: serializeElectionForClient(election),
            totalValidVotes,
            candidates: candidateRows.map((candidate) => ({
                ...candidate,
                votes: tally[String(candidate.id)] || 0,
            })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/cast-vote', async (req, res) => {
    if (!req.session.authenticated || !req.session.rollNumber) {
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }

    const { encrypted_ballot, assertion, electionId } = req.body;
    if (!encrypted_ballot || !assertion || !electionId) {
        return res.status(400).json({ error: 'Missing ballot, assertion, or electionId.' });
    }

    const currentChallenge = req.session.currentChallenge;
    if (!currentChallenge) return res.status(400).json({ error: 'Session challenge expired. Refresh and try again.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Verify step-up biometric signature
        const [users] = await connection.query('SELECT public_key FROM users WHERE roll_number = ?', [req.session.rollNumber]);
        if (users.length === 0) throw new Error('Voter not found.');

        const userKey = JSON.parse(users[0].public_key);
        const verification = await verifyAuthenticationResponse({
            response: assertion,
            expectedChallenge: currentChallenge,
            expectedOrigin: req.get('origin'),
            expectedRPID: req.hostname,
            credential: {
                id: userKey.credentialID,
                publicKey: Buffer.from(userKey.credentialPublicKey, 'base64'),
                counter: userKey.counter,
            },
        });
        if (!verification.verified) throw new Error('Biometric verification failed!');

        // 2. Check election timing and status gates
        const [elections] = await connection.query(
            'SELECT * FROM elections WHERE id = ?',
            [electionId]
        );
        if (elections.length === 0) throw new Error('Election not found.');
        const elec = elections[0];
        const phase = getElectionPhase(elec);
        if (phase === 'scheduled') throw new Error('Voting has not started yet for this election.');
        if (phase === 'awaiting_results' || phase === 'results_released' || phase === 'closed') {
            throw new Error('Voting is closed for this election.');
        }

        // 3. Check voter eligibility against election rules
        const [voterRows] = await connection.query(
            'SELECT course, year, section FROM users WHERE roll_number = ?',
            [req.session.rollNumber]
        );
        const voter = voterRows[0];
        if (elec.allowed_course  && elec.allowed_course  !== voter.course)   throw new Error('You are not eligible for this election (course mismatch).');
        if (elec.allowed_year    && elec.allowed_year    !== voter.year)     throw new Error('You are not eligible for this election (year mismatch).');
        if (elec.allowed_section && elec.allowed_section !== voter.section)  throw new Error('You are not eligible for this election (section mismatch).');

        // 4. Check for duplicate vote
        const [participation] = await connection.query(
            'SELECT 1 FROM voter_participation WHERE roll_number = ? AND election_id = ?',
            [req.session.rollNumber, electionId]
        );
        if (participation.length > 0) throw new Error('You have already cast your ballot in this election.');

        // 5. Record participation (links identity to election, NOT to specific vote)
        await connection.query(
            'INSERT INTO voter_participation (roll_number, election_id) VALUES (?, ?)',
            [req.session.rollNumber, electionId]
        );

        // 6. Deposit the anonymous encrypted ballot (no roll_number!)
        await connection.query(
            'INSERT INTO votes (election_id, encrypted_ballot) VALUES (?, ?)',
            [electionId, encrypted_ballot]
        );

        await connection.commit();
        res.json({ success: true, message: 'Your encrypted ballot has been anonymously deposited.' });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Admin API
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/session', (req, res) => {
    if (!isAdminAuthConfigured()) {
        return res.status(503).json({ error: 'Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.' });
    }

    if (!req.session.adminAuthenticated) {
        return res.status(401).json({ error: 'Not authenticated.' });
    }

    res.json({
        authenticated: true,
        username: req.session.adminUsername || adminUsername,
    });
});

app.post('/api/admin/session/login', (req, res, next) => {
    if (!isAdminAuthConfigured()) {
        return res.status(503).json({ error: 'Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    if (username !== adminUsername || password !== adminPassword) {
        return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.adminAuthenticated = true;
        req.session.adminUsername = username;
        res.json({ success: true, username });
    });
});

app.post('/api/admin/session/logout', (req, res, next) => {
    req.session.destroy((err) => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

app.use('/api/admin', requireAdmin);

// -- Student Roll Management --

app.get('/api/admin/students', async (req, res) => {
    try {
        const [students] = await pool.query(
            'SELECT roll_number, name, course, year, section, is_registered, registration_unlocked FROM users ORDER BY course, year, section, roll_number'
        );
        res.json(students);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/students', async (req, res) => {
    const { roll_number, name, course, year, section } = req.body;
    if (!roll_number || !name || !course || !year || !section) {
        return res.status(400).json({ error: 'All fields (roll_number, name, course, year, section) are required.' });
    }
    try {
        await pool.query(
            'INSERT INTO users (roll_number, name, course, year, section) VALUES (?, ?, ?, ?, ?)',
            [roll_number, name, course, year, section]
        );
        res.json({ success: true, message: `Student ${roll_number} added to voter roll.` });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Roll number already exists.' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/unlock-registration/:rollNumber', async (req, res) => {
    const { rollNumber } = req.params;
    try {
        const [rows] = await pool.query('SELECT is_registered FROM users WHERE roll_number = ?', [rollNumber]);
        if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });
        if (rows[0].is_registered) return res.status(409).json({ error: 'Student is already registered.' });

        await pool.query('UPDATE users SET registration_unlocked = TRUE WHERE roll_number = ?', [rollNumber]);
        res.json({ success: true, message: `Registration unlocked for ${rollNumber}. Student may now register at the kiosk.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/revoke-device/:rollNumber', async (req, res) => {
    const { rollNumber } = req.params;
    try {
        const [rows] = await pool.query('SELECT roll_number FROM users WHERE roll_number = ?', [rollNumber]);
        if (rows.length === 0) return res.status(404).json({ error: 'Student not found.' });

        await pool.query(
            'UPDATE users SET public_key = NULL, credential_id = NULL, is_registered = FALSE, registration_unlocked = FALSE WHERE roll_number = ?',
            [rollNumber]
        );
        res.json({ success: true, message: `Device revoked for ${rollNumber}. They may re-register at the kiosk.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// -- Election Management --

app.get('/api/admin/elections', async (req, res) => {
    try {
        const [elections] = await pool.query('SELECT * FROM elections ORDER BY created_at DESC');
        res.json(elections);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/elections', async (req, res) => {
    const { title, allowed_course, allowed_year, allowed_section, start_at, end_at, result_at, status } = req.body;
    if (!title) return res.status(400).json({ error: 'Election title is required.' });

    const startAt = new Date(start_at);
    const endAt = new Date(end_at);
    const resultAt = new Date(result_at);
    if ([startAt, endAt, resultAt].some((value) => Number.isNaN(value.getTime()))) {
        return res.status(400).json({ error: 'Valid start, end, and result times are required.' });
    }
    if (!(startAt < endAt && endAt < resultAt)) {
        return res.status(400).json({ error: 'Election times must follow: start < end < result.' });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO elections (title, allowed_course, allowed_year, allowed_section, start_at, end_at, result_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title, allowed_course || null, allowed_year || null, allowed_section || null, startAt, endAt, resultAt, status || 'Upcoming']
        );
        res.json({ success: true, election: { id: result.insertId, title, start_at: startAt, end_at: endAt, result_at: resultAt } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/admin/elections/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Upcoming', 'Active', 'Closed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be Upcoming, Active, or Closed.' });
    }
    try {
        await pool.query('UPDATE elections SET status = ? WHERE id = ?', [status, id]);
        res.json({ success: true, message: `Election ${id} status updated to ${status}.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/elections/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM elections WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Election not found.' });
        }
        res.json({ success: true, message: `Election ${id} deleted.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// -- Candidate Management --

app.post('/api/admin/candidates', async (req, res) => {
    const { election_id, name, party_logo_url } = req.body;
    if (!election_id || !name) return res.status(400).json({ error: 'election_id and name are required.' });

    try {
        const [result] = await pool.query(
            'INSERT INTO candidates (election_id, name, party_logo_url) VALUES (?, ?, ?)',
            [election_id, name, party_logo_url || null]
        );
        res.json({ success: true, candidate: { id: result.insertId, election_id, name, party_logo_url } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/elections/:id', async (req, res) => {
    const { id } = req.params;
    const { title, allowed_course, allowed_year, allowed_section, start_at, end_at, result_at } = req.body;

    try {
        const [rows] = await pool.query('SELECT * FROM elections WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Election not found.' });

        const election = rows[0];

        if (election.status === 'Active') {
            // For active elections, ONLY allow updating the result date
            // Validate: result_at must be after the election's end_at
            if (result_at && new Date(result_at) <= new Date(election.end_at)) {
                return res.status(400).json({ error: 'Result time must be after the voting end time.' });
            }
            await pool.query(
                'UPDATE elections SET result_at = ? WHERE id = ?',
                [result_at, id]
            );
            res.json({ success: true, message: 'Active election: Result date updated.' });
        } else {
            // Validate time order: start < end < result
            if (start_at && end_at && new Date(start_at) >= new Date(end_at)) {
                return res.status(400).json({ error: 'Start time must be before End time.' });
            }
            if (end_at && result_at && new Date(result_at) <= new Date(end_at)) {
                return res.status(400).json({ error: 'Result time must be after End time.' });
            }

            await pool.query(
                `UPDATE elections SET 
                    title = ?, allowed_course = ?, allowed_year = ?, allowed_section = ?, 
                    start_at = ?, end_at = ?, result_at = ? 
                 WHERE id = ?`,
                [title, allowed_course || null, allowed_year || null, allowed_section || null, start_at, end_at, result_at, id]
            );
            res.json({ success: true, message: 'Election details updated successfully.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM users');
        const [[{ registered }]] = await pool.query('SELECT COUNT(*) as registered FROM users WHERE is_registered = TRUE');
        const [[{ total_votes }]] = await pool.query('SELECT COUNT(*) as total_votes FROM votes');
        const [[{ total_elections }]] = await pool.query('SELECT COUNT(*) as total_elections FROM elections');
        res.json({ total, registered, total_votes, total_elections });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/votes', requireBallotEncryptionKeys, async (req, res) => {
    const { electionId } = req.query;
    try {
        const query = electionId
            ? 'SELECT encrypted_ballot, cast_at, election_id FROM votes WHERE election_id = ? ORDER BY cast_at DESC'
            : 'SELECT encrypted_ballot, cast_at, election_id FROM votes ORDER BY cast_at DESC';
        const params = electionId ? [electionId] : [];
        const [votes] = await pool.query(query, params);
        const normalizedVotes = votes.map((vote) => {
            try {
                return {
                    ...vote,
                    is_valid: true,
                    decrypted_ballot: decryptBallotPayload(vote.encrypted_ballot),
                };
            } catch (err) {
                return {
                    ...vote,
                    is_valid: false,
                    decrypt_error: err.message,
                    decrypted_ballot: null,
                };
            }
        });
        res.json(normalizedVotes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`DBPVS V2 Server running at http://localhost:${PORT}`);
});
