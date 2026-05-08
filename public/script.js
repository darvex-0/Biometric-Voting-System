const { startRegistration, startAuthentication } = SimpleWebAuthnBrowser;

// ─── State ────────────────────────────────────────────────────────────────────
let currentElectionId = null;
let ballotPublicKeyPromise = null;

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-32', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.add('translate-y-32', 'opacity-0');
        toast.classList.remove('translate-y-0', 'opacity-100');
    }, 6000);
}

function setOverlay(show, title = 'Authenticating', text = 'Waiting for biometric confirmation...') {
    document.getElementById('biometric-overlay').classList.toggle('hidden', !show);
    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-text').innerText = text;
}

function showSection(sectionId) {
    // 1. Find ALL section elements in the main container
    const allSections = document.querySelectorAll('main > section');
    allSections.forEach(section => {
        section.classList.add('hidden');
    });
    
    // 2. Show ONLY the one we want
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        console.error(`Section ID "${sectionId}" not found!`);
    }
}

function backToElections() {
    // Clear any results chart if it exists to free memory
    if (publicResultsChart) {
        publicResultsChart.destroy();
        publicResultsChart = null;
    }
    showSection('elections-section');
    loadElections(); // Refresh the list
}

async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['ngrok-skip-browser-warning'] = 'true';
    if (options.body && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }
    return fetch(url, options);
}

// ─── E2EE Encryption ──────────────────────────────────────────────────────────
function pemToArrayBuffer(pem) {
    const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function getBallotPublicKey() {
    if (!ballotPublicKeyPromise) {
        ballotPublicKeyPromise = (async () => {
            const response = await apiFetch('/api/ballot-public-key');
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Unable to load ballot encryption key.');
            }

            return window.crypto.subtle.importKey(
                'spki',
                pemToArrayBuffer(data.publicKeyPem),
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                false,
                ['encrypt']
            );
        })();
    }

    return ballotPublicKeyPromise;
}

async function encryptBallot(candidateId, electionId) {
    const publicKey = await getBallotPublicKey();
    const encoder = new TextEncoder();
    const payload = JSON.stringify({
        candidateId,
        electionId,
        timestamp: Date.now(),
        nonce: window.crypto.randomUUID(),
    });
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        encoder.encode(payload)
    );

    return `RSA_OAEP_SHA256_V1:${arrayBufferToBase64(ciphertext)}`;
}

// ─── Login Flow ───────────────────────────────────────────────────────────────
async function handleLogin() {
    const rollNumber = document.getElementById('roll-number-input').value.trim();
    if (!rollNumber) return showToast('Please enter your Roll Number.');

    setOverlay(true, 'Biometric Login', 'Fetching authentication challenge...');

    try {
        const optResp = await apiFetch(`/auth/login-options?rollNumber=${encodeURIComponent(rollNumber)}`);
        const options = await optResp.json();

        if (options.error) {
            // Check if student exists but isn't registered — show kiosk panel
            if (options.error.includes('kiosk') || options.error.includes('not registered')) {
                document.getElementById('kiosk-register-panel').classList.remove('hidden');
                showToast(options.error); // Show the specific "locked" message
            } else {
                throw new Error(options.error);
            }
            return;
        }

        setOverlay(true, 'Touch Your Sensor', 'Place your finger or look at the camera...');
        const assertion = await startAuthentication(options);

        const verifyResp = await apiFetch('/auth/verify-authentication', {
            method: 'POST',
            body: JSON.stringify(assertion),
        });
        const result = await verifyResp.json();

        if (result.verified) {
            onAuthenticated(rollNumber);
        } else {
            throw new Error(result.error || 'Authentication failed.');
        }
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Biometric authentication failed.');
    } finally {
        setOverlay(false);
    }
}

// ─── Kiosk Registration (Admin-Unlocked) ─────────────────────────────────────
async function handleKioskRegister() {
    const rollNumber = document.getElementById('roll-number-input').value.trim();
    if (!rollNumber) return showToast('Please enter your Roll Number first.');

    setOverlay(true, 'Kiosk Registration', 'Fetching registration challenge...');

    try {
        const optResp = await apiFetch(`/auth/register-options?rollNumber=${encodeURIComponent(rollNumber)}`);
        const options = await optResp.json();
        
        if (options.error) {
            alert(`⛔ REGISTRATION BLOCKED: ${options.error}`);
            throw new Error(options.error);
        }

        setOverlay(true, 'Register Your Biometrics', 'Touch your fingerprint sensor to bind your device...');
        const attResp = await startRegistration(options);

        const verifyResp = await apiFetch('/auth/verify-registration', {
            method: 'POST',
            body: JSON.stringify(attResp),
        });
        const result = await verifyResp.json();

        if (result.verified) {
            document.getElementById('kiosk-register-panel').classList.add('hidden');
            showToast('✅ Biometric registered! Please login now.');
        } else {
            throw new Error(result.error || 'Registration verification failed.');
        }
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Registration failed.');
    } finally {
        setOverlay(false);
    }
}

// ─── Post-Auth: Load Eligible Elections ───────────────────────────────────────
async function onAuthenticated(rollNumber) {
    document.getElementById('roll-number-input').value = '';
    document.getElementById('kiosk-register-panel').classList.add('hidden');
    document.getElementById('user-display').classList.remove('hidden');
    document.getElementById('authenticated-user').innerText = rollNumber;
    showSection('elections-section');
    await loadElections();
}

function formatDateTime(dateValue) {
    if (!dateValue) return 'Not scheduled';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

// ─── Countdown timer interval reference ───────────────────────────────────────
let countdownInterval = null;

function getCountdownHTML(resultAt, electionId) {
    const now = new Date();
    const target = new Date(resultAt);
    const diff = target - now;
    if (diff <= 0) return '';

    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    return `<div id="countdown-${electionId}" class="text-center mt-3">
        <p class="text-xs text-orange-400 mb-1">⏳ Results in</p>
        <span class="text-lg font-mono font-bold text-orange-300">${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}</span>
    </div>`;
}

function startCountdownTimers(elections) {
    if (countdownInterval) clearInterval(countdownInterval);

    const closedElections = elections.filter(e => e.phase === 'closed');
    if (!closedElections.length) return;

    countdownInterval = setInterval(() => {
        const now = new Date();
        let needsRefresh = false;

        closedElections.forEach(e => {
            const el = document.getElementById(`countdown-${e.id}`);
            if (!el) return;

            const target = new Date(e.result_at);
            const diff = target - now;

            if (diff <= 0) {
                needsRefresh = true;
                return;
            }

            const hours = Math.floor(diff / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            el.querySelector('span').textContent = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
        });

        if (needsRefresh) {
            clearInterval(countdownInterval);
            loadElections(); // Auto-refresh when a countdown hits zero
        }
    }, 1000);
}

async function loadElections() {
    const container = document.getElementById('elections-container');
    container.innerHTML = `<div class="col-span-2 text-center py-12 text-gray-500">Loading your eligible elections...</div>`;

    try {
        const response = await apiFetch('/elections');
        const elections = await response.json();
        if (!response.ok) throw new Error(elections.error || 'Unable to load elections.');

        if (!elections.length) {
            container.innerHTML = `<div class="col-span-2 text-center py-12 text-gray-600">No elections are available for your profile right now.</div>`;
            return;
        }

        container.innerHTML = elections.map(e => {
            const eligibilityParts = [
                e.allowed_course || 'All Courses',
                e.allowed_year ? `Year ${e.allowed_year}` : 'All Years',
                e.allowed_section ? `Section ${e.allowed_section}` : 'All Sections',
            ].join(' · ');
            const timeline = [
                `Starts: ${formatDateTime(e.start_at)}`,
                `Ends: ${formatDateTime(e.end_at)}`,
                `Results: ${formatDateTime(e.result_at)}`,
            ].join('<br>');

            // Badge based on phase
            const badgeMap = {
                scheduled:        '<span class="inline-block bg-yellow-900/40 text-yellow-300 text-xs font-bold px-3 py-1 rounded-full mb-3 border border-yellow-500/30">⏰ Upcoming</span>',
                active:           '<span class="inline-block bg-green-900/40 text-green-400 text-xs font-bold px-3 py-1 rounded-full mb-3 border border-green-500/30">🟢 Voting Open</span>',
                closed:           '<span class="inline-block bg-orange-900/40 text-orange-300 text-xs font-bold px-3 py-1 rounded-full mb-3 border border-orange-500/30">🔒 Voting Closed</span>',
                results_released: '<span class="inline-block bg-violet-900/40 text-violet-300 text-xs font-bold px-3 py-1 rounded-full mb-3 border border-violet-500/30">📊 Results Released</span>',
            };
            const badge = e.already_voted && e.phase !== 'results_released'
                ? '<span class="inline-block bg-gray-700 text-gray-300 text-xs font-bold px-3 py-1 rounded-full mb-3">✅ Already Voted</span>'
                : (badgeMap[e.phase] || '<span class="inline-block bg-white/10 text-gray-300 text-xs font-bold px-3 py-1 rounded-full mb-3">Election</span>');

            // Action button based on phase
            let btn = '';
            if (e.phase === 'results_released') {
                btn = `<button onclick="showResults(${e.id}, '${e.title.replace(/'/g, "\\'")}')" class="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 rounded-xl transition-all active:scale-95">📊 View Final Results</button>`;
            } else if (e.phase === 'closed') {
                btn = `<button disabled class="w-full bg-orange-900/30 text-orange-400 font-bold py-3 rounded-xl cursor-not-allowed border border-orange-500/20">⏳ Waiting for Results...</button>`;
                btn += getCountdownHTML(e.result_at, e.id);
            } else if (e.phase === 'active') {
                if (e.already_voted) {
                    btn = '<button disabled class="w-full bg-white/5 text-gray-600 font-bold py-3 rounded-xl cursor-not-allowed border border-white/5">✅ Already Voted</button>';
                } else {
                    btn = `<button onclick="selectElection(${e.id}, '${e.title.replace(/'/g, "\\'")}')" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all active:scale-95">🗳️ Cast Ballot →</button>`;
                }
            } else if (e.phase === 'scheduled') {
                btn = '<button disabled class="w-full bg-white/5 text-gray-500 font-bold py-3 rounded-xl cursor-not-allowed border border-white/5">Voting Not Started</button>';
            } else {
                btn = '<button disabled class="w-full bg-white/5 text-gray-500 font-bold py-3 rounded-xl cursor-not-allowed border border-white/5">Unavailable</button>';
            }

            return `
                <div class="glass rounded-2xl p-6 border border-white/5 hover:border-blue-500/30 transition-all">
                    ${badge}
                    <h3 class="font-bold text-lg mb-2 leading-tight">${e.title}</h3>
                    <p class="text-xs text-gray-500 mb-3">${eligibilityParts}</p>
                    <p class="text-xs text-gray-400 mb-5 leading-6">${timeline}</p>
                    ${btn}
                </div>
            `;
        }).join('');

        // Start countdown timers for closed elections
        startCountdownTimers(elections);

    } catch (err) {
        container.innerHTML = `<div class="col-span-2 text-center py-12 text-red-500">Error loading elections: ${err.message}</div>`;
    }
}

async function selectElection(electionId, electionTitle) {
    currentElectionId = electionId;
    document.getElementById('voting-election-title').innerText = electionTitle;
    showSection('voting-section');
    await loadCandidates(electionId);
}

async function viewResults(electionId, electionTitle) {
    showSection('results-section');
    document.getElementById('results-election-title').innerText = electionTitle;
    document.getElementById('results-meta').innerText = 'Loading released results...';
    document.getElementById('results-list').innerHTML = '<p class="text-gray-500">Loading results...</p>';

    try {
        const response = await apiFetch(`/elections/${electionId}/results`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load results.');

        document.getElementById('results-election-title').innerText = data.election.title;
        document.getElementById('results-meta').innerText = `Total valid votes: ${data.totalValidVotes} • Released ${formatDateTime(data.election.result_at)}`;

        if (!data.candidates.length) {
            document.getElementById('results-list').innerHTML = '<p class="text-gray-500">No candidates found for this election.</p>';
            return;
        }

        const maxVotes = Math.max(...data.candidates.map((candidate) => candidate.votes), 1);
        document.getElementById('results-list').innerHTML = data.candidates.map((candidate) => {
            const width = `${(candidate.votes / maxVotes) * 100}%`;
            return `
                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-3">
                            <img src="${candidate.party_logo_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(candidate.name)}"
                                 class="w-10 h-10 rounded-full bg-blue-500/10 p-1 border border-blue-500/20"
                                 onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(candidate.name)}'">
                            <span class="font-semibold">${candidate.name}</span>
                        </div>
                        <span class="text-sm text-gray-300">${candidate.votes} vote(s)</span>
                    </div>
                    <div class="h-3 w-full rounded-full bg-white/5 overflow-hidden">
                        <div class="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style="width:${width}"></div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        document.getElementById('results-meta').innerText = '';
        document.getElementById('results-list').innerHTML = `<p class="text-red-400">${err.message}</p>`;
    }
}

// ─── Candidates ───────────────────────────────────────────────────────────────
async function loadCandidates(electionId) {
    const container = document.getElementById('candidates-container');
    container.innerHTML = `<div class="col-span-3 text-center py-12 text-gray-500">Loading candidates...</div>`;

    try {
        const r = await apiFetch(`/candidates?electionId=${electionId}`);
        const candidates = await r.json();

        if (!candidates.length) {
            container.innerHTML = `<div class="col-span-3 text-center py-12 text-gray-600">No candidates have been added to this election yet.</div>`;
            return;
        }

        container.innerHTML = candidates.map(c => `
            <div class="glass rounded-3xl p-6 text-center card-hover cursor-pointer border border-white/5">
                <img src="${c.party_logo_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(c.name)}" 
                     class="w-24 h-24 mx-auto mb-5 rounded-full bg-blue-500/10 p-2 border border-blue-500/20 shadow-[0_0_25px_rgba(59,130,246,0.1)]"
                     onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(c.name)}'">
                <h3 class="text-xl font-bold mb-1">${c.name}</h3>
                <p class="text-gray-600 text-xs mb-5 uppercase tracking-widest">Candidate #${c.id}</p>
                <button onclick="castVote(${c.id}, '${c.name.replace(/'/g, "\\'")}')" 
                        class="w-full bg-white/5 hover:bg-blue-600 border border-white/10 hover:border-blue-500 py-3 rounded-xl font-bold transition-all active:scale-95">
                    Select Nominee
                </button>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="col-span-3 text-center py-12 text-red-500">Error: ${err.message}</div>`;
    }
}

// ─── E2EE Voting ──────────────────────────────────────────────────────────────
async function castVote(candidateId, candidateName) {
    if (!confirm(`Cast your anonymous ballot for ${candidateName}?\n\nThis action cannot be undone.`)) return;

    setOverlay(true, 'Encrypting Ballot', 'Preparing your encrypted ballot...');
    try {
        // Step 1: Encrypt the ballot client-side
        const encrypted_ballot = await encryptBallot(candidateId, currentElectionId);

        // Step 2: Step-up biometric — must physically touch sensor to finalize vote
        const rollNumber = document.getElementById('authenticated-user').innerText;
        const optResp = await apiFetch(`/auth/login-options?rollNumber=${encodeURIComponent(rollNumber)}`);
        const authOptions = await optResp.json();
        if (authOptions.error) throw new Error(authOptions.error);

        setOverlay(true, 'Final Biometric Confirmation', 'Touch your sensor to cast the encrypted ballot...');
        const assertion = await startAuthentication(authOptions);

        // Step 3: Submit to backend
        setOverlay(true, 'Submitting Ballot', 'Depositing your encrypted ballot...');
        const resp = await apiFetch('/cast-vote', {
            method: 'POST',
            body: JSON.stringify({ encrypted_ballot, assertion, electionId: currentElectionId }),
        });
        const result = await resp.json();

        if (result.success) {
            showSection('success-section');
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Error casting vote.');
    } finally {
        setOverlay(false);
    }
}

// ─── Public Results ──────────────────────────────────────────────────────────
let publicResultsChart = null;

async function showResults(electionId, electionTitle) {
    document.getElementById('results-election-title').innerText = electionTitle;
    showSection('public-results-section');

    try {
        const r = await apiFetch(`/api/public/results/${electionId}`);
        const data = await r.json();

        if (data.error) throw new Error(data.error);

        // Data is now pre-tallied by the server
        const { candidates, validVotes, invalidVotes, election } = data;

        // Build tally object for the chart
        const results = {};
        candidates.forEach(c => { results[c.id] = c.votes; });

        // Update meta text
        const metaEl = document.getElementById('public-results-meta');
        if (metaEl) {
            metaEl.innerText = `Total valid votes: ${validVotes} · Released ${formatDateTime(election.result_at)}`;
        }

        renderPublicChart(candidates, results);
        renderResultsList(candidates, results);
    } catch (err) {
        showToast(err.message);
        backToElections();
    }
}

function decryptBallot(encryptedStr) {
    try {
        // Handle potential double-base64 (from server/setup_db)
        let outer = atob(encryptedStr);
        if (!outer.startsWith('E2EE_V1_')) {
            // Try again if it was already decoded once
            outer = encryptedStr;
        }

        if (!outer.startsWith('E2EE_V1_')) return null;

        const innerBase = outer.replace('E2EE_V1_', '');
        return JSON.parse(atob(innerBase));
    } catch (e) {
        console.error('Voter decryption failed:', e);
        return null;
    }
}

function renderPublicChart(candidates, results) {
    const ctx = document.getElementById('publicResultsChart').getContext('2d');
    if (publicResultsChart) publicResultsChart.destroy();

    publicResultsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: candidates.map(c => c.name),
            datasets: [{
                data: candidates.map(c => results[c.id]),
                backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'],
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

function renderResultsList(candidates, results) {
    const container = document.getElementById('public-results-list');
    const totalVotes = Object.values(results).reduce((a, b) => a + b, 0);

    container.innerHTML = candidates.map(c => {
        const count = results[c.id];
        const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        return `
            <div>
                <div class="flex justify-between text-sm mb-1">
                    <span class="font-bold">${c.name}</span>
                    <span class="text-gray-400">${count} votes (${percent}%)</span>
                </div>
                <div class="w-full bg-white/5 rounded-full h-2">
                    <div class="bg-blue-600 h-2 rounded-full" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function logout() {
    location.reload();
}
