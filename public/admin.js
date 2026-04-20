// Custom fetch to bypass ngrok browser warning
async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['ngrok-skip-browser-warning'] = 'true';
    return fetch(url, options);
}

let candidatesMap = {};
let resultsChart;

async function initAdmin() {
    // 1. Fetch Candidate Database to Map IDs to Names
    const cResp = await apiFetch('/candidates');
    const candidates = await cResp.json();
    candidates.forEach(c => {
        candidatesMap[c.id] = c.name;
    });

    initChart(candidates);
    
    // Initial apiFetch
    await apiFetchLiveResults();
    
    // 3 Second Polling for Live Results!
    setInterval(apiFetchLiveResults, 3000);

    // Setup Add Candidate Form
    const addForm = document.getElementById('addCandidateForm');
    if (addForm) addForm.addEventListener('submit', handleAddCandidate);
}

function initChart(candidates) {
    const ctx = document.getElementById('resultsChart').getContext('2d');
    
    resultsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: candidates.map(c => c.name),
            datasets: [{
                label: 'Votes',
                data: candidates.map(() => 0),
                backgroundColor: [
                    'rgba(59, 130, 246, 0.8)', // blue
                    'rgba(239, 68, 68, 0.8)',  // red
                    'rgba(34, 197, 94, 0.8)'   // green
                ],
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 2,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#e2e8f0', font: { family: 'Outfit', size: 14 } } }
            },
            layout: { padding: 20 }
        }
    });
}

function decryptBallot(encryptedStr) {
    try {
        const base64 = atob(encryptedStr);
        if (!base64.startsWith('E2EE_V1_')) return null;
        
        const innerBase = base64.replace('E2EE_V1_', '');
        const jsonStr = atob(innerBase);
        return JSON.parse(jsonStr);
    } catch {
        return null; // Could not decrypt or forged payload
    }
}

async function apiFetchLiveResults() {
    try {
        // Fetch Top Level Stats
        const statsResp = await apiFetch('/api/admin/stats');
        const stats = await statsResp.json();
        document.getElementById('stat-registered').innerText = stats.total_registered;
        document.getElementById('stat-votes').innerText = stats.total_votes;

        // Fetch Raw Encrypted Votes
        const votesResp = await apiFetch('/api/admin/votes');
        const votes = await votesResp.json();

        const logContainer = document.getElementById('vote-log');
        logContainer.innerHTML = '';
        
        // Results Counters
        const results = {};
        Object.keys(candidatesMap).forEach(id => results[id] = 0);

        votes.forEach(vote => {
            const decoded = decryptBallot(vote.encrypted_ballot);
            const timeStr = new Date(vote.created_at).toLocaleTimeString();
            
            if (decoded && candidatesMap[decoded.candidateId]) {
                results[decoded.candidateId]++;
                
                logContainer.innerHTML += `
                    <div class="border-b border-white/5 pb-2">
                        <span class="text-green-500">[${timeStr}] Decrypted Valid Ballot:</span> 
                        <span class="text-white ml-2">Vote For: <b class="text-blue-400">${candidatesMap[decoded.candidateId]}</b></span>
                        <br><span class="text-gray-600 truncate block w-full opacity-50">Payload: ${vote.encrypted_ballot}</span>
                    </div>
                `;
            } else {
                logContainer.innerHTML += `
                    <div class="border-b border-red-500/20 pb-2">
                        <span class="text-red-500">[${timeStr}] Invalid/Forged Ballot! Decryption Failed!</span>
                        <br><span class="text-gray-600 truncate block w-full opacity-50">Payload: ${vote.encrypted_ballot}</span>
                    </div>
                `;
            }
        });

        // Update Chart
        resultsChart.data.datasets[0].data = Object.keys(candidatesMap).map(id => results[id]);
        resultsChart.update();

    } catch (err) {
        console.error("Dashboard Polling Error:", err);
    }
}

async function handleAddCandidate(e) {
    e.preventDefault();
    const name = document.getElementById('candidateName').value;
    const logoUrl = document.getElementById('candidateLogo').value;
    const msg = document.getElementById('candidateMessage');

    try {
        const resp = await apiFetch('/api/admin/candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, party_logo_url: logoUrl })
        });
        const data = await resp.json();

        if (data.success) {
            msg.className = 'text-xs text-center text-green-400 mt-2 block';
            msg.innerText = 'Candidate added successfully!';
            document.getElementById('addCandidateForm').reset();
            
            // Update Map and Chart immediately
            candidatesMap[data.candidate.id] = data.candidate.name;
            const newLabel = data.candidate.name;
            
            // Ensure we have a random color for the new candidate
            const rc = () => Math.floor(Math.random() * 200 + 55); 
            const newColor = `rgba(${rc()}, ${rc()}, ${rc()}, 0.8)`;
            
            resultsChart.data.labels.push(newLabel);
            resultsChart.data.datasets[0].data.push(0);
            resultsChart.data.datasets[0].backgroundColor.push(newColor);
            resultsChart.update();
            
            setTimeout(() => { msg.classList.add('hidden'); }, 3000);
        } else {
            msg.className = 'text-xs text-center text-red-500 mt-2 block glow-text';
            msg.innerText = data.error || 'Failed to add candidate';
            msg.classList.remove('hidden');
        }
    } catch (err) {
        msg.className = 'text-xs text-center text-red-500 mt-2 block glow-text';
        msg.innerText = err.message;
        msg.classList.remove('hidden');
    }
}

// Start
document.addEventListener('DOMContentLoaded', initAdmin);
