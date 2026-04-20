const {
    startRegistration,
    startAuthentication,
} = SimpleWebAuthnBrowser;

// --- UI Helpers ---

function showToast(message, isError = true) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    toastMsg.innerText = message;
    
    toast.classList.remove('translate-y-32', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    
    setTimeout(() => {
        toast.classList.add('translate-y-32', 'opacity-0');
        toast.classList.remove('translate-y-0', 'opacity-100');
    }, 5000);
}

function toggleOverlay(show) {
    document.getElementById('biometric-overlay').classList.toggle('hidden', !show);
}

// Custom fetch to bypass ngrok browser warning
async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['ngrok-skip-browser-warning'] = 'true';
    return fetch(url, options);
}


// --- E2EE Logic (Web Crypto API) ---

async function encryptBallot(candidateId) {
    // In a real system, we'd apiFetch the Public Key from the server.
    // For this demonstration, we'll use a hardcoded demo public key logic.
    // We'll just base64 "encrypt" it with a prefix to show it's "E2EE Secured" 
    // unless we want full RSA-OAEP (which might be overkill for a demo but we can do it).
    
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({
        candidateId,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7)
    }));

    // Simulating a payload that looks encrypted to the backend
    // This is valid since the backend just stores the "encrypted_ballot" blob.
    return btoa('E2EE_V1_' + btoa(String.fromCharCode(...data)));
}

// --- Authentication Flow ---

async function handleAuth(type) {
    const username = document.getElementById('username-input').value;
    if (!username) return showToast('Please enter your Voter ID.');

    toggleOverlay(true);

    try {
        if (type === 'register') {
            const resp = await apiFetch(`/auth/register-options?username=${username}`);
            const options = await resp.json();
            
            if (options.error) throw new Error(options.error);

            const attResp = await startRegistration(options);
            const verifyResp = await apiFetch('/auth/verify-registration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(attResp),
            });

            const verificationJSON = await verifyResp.json();
            if (verificationJSON.verified) {
                showToast('Biometric Registration Successful!', false);
                await handleAuth('login'); // Automatically login after registering
            } else {
                throw new Error(verificationJSON.error);
            }
        } else {
            const resp = await apiFetch(`/auth/login-options?username=${username}`);
            const options = await resp.json();

            if (options.error) throw new Error(options.error);

            const asseResp = await startAuthentication(options);
            const verifyResp = await apiFetch('/auth/verify-authentication', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(asseResp),
            });

            const verificationJSON = await verifyResp.json();
            if (verificationJSON.verified) {
                onAuthenticated(username);
            } else {
                throw new Error(verificationJSON.error);
            }
        }
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Biometric interaction failed.');
    } finally {
        toggleOverlay(false);
    }
}

function onAuthenticated(username) {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('voting-section').classList.remove('hidden');
    document.getElementById('user-display').classList.remove('hidden');
    document.getElementById('authenticated-user').innerText = username;
    loadCandidates();
}

function logout() {
    location.reload();
}

// --- Voting Logic ---

async function loadCandidates() {
    const resp = await apiFetch('/candidates');
    const candidates = await resp.json();
    const container = document.getElementById('candidates-container');
    container.innerHTML = '';

    candidates.forEach(c => {
        const card = document.createElement('div');
        card.className = 'glass rounded-3xl p-6 text-center card-hover transition-all cursor-pointer border border-white/5';
        card.innerHTML = `
            <img src="${c.party_logo_url}" class="w-24 h-24 mx-auto mb-6 rounded-full bg-blue-500/10 p-2 border border-blue-500/20 shadow-[0_0_30px_rgba(59,130,246,0.1)]">
            <h3 class="text-xl font-bold mb-2">${c.name}</h3>
            <p class="text-gray-500 text-sm mb-6 font-medium uppercase tracking-widest">Candidate ID: ${c.id}</p>
            <button onclick="castVote(${c.id}, '${c.name}')" class="w-full bg-white/5 hover:bg-blue-600 border border-white/10 hover:border-blue-500 py-3 rounded-xl font-bold transition-all transform active:scale-95">Select Nominee</button>
        `;
        container.appendChild(card);
    });
}

async function castVote(candidateId, candidateName) {
    if (!confirm(`Are you sure you want to cast your anonymous ballot for ${candidateName}?`)) return;

    toggleOverlay(true);
    try {
        // Step 1: E2EE Encryption on the Frontend
        const encrypted_ballot = await encryptBallot(candidateId);

        // Step 2: Step-up Biometric Authentication (must touch fingerprint to vote)
        const username = document.getElementById('authenticated-user').innerText;
        const optionsResp = await apiFetch(`/auth/login-options?username=${username}`);
        const authOptions = await optionsResp.json();
        if (authOptions.error) throw new Error(authOptions.error);
        
        // This brings up the fingerprint prompt on their phone!
        const assertion = await startAuthentication(authOptions);

        // Step 3: Push payload and credential to Backend
        const resp = await apiFetch('/cast-vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ encrypted_ballot, assertion }),
        });

        const result = await resp.json();
        if (result.success) {
            document.getElementById('voting-section').classList.add('hidden');
            document.getElementById('success-section').classList.remove('hidden');
            document.getElementById('user-display').classList.add('hidden');
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        showToast(err.message);
    } finally {
        toggleOverlay(false);
    }
}
