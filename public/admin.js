// ─── API Fetch Helper (bypasses ngrok warning) ────────────────────────────────
async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['ngrok-skip-browser-warning'] = 'true';
    if (options.body && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }
    return fetch(url, options);
}

// ─── Tab Management ───────────────────────────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.classList.add('text-gray-400');
    });

    document.getElementById(`tab-${name}`).classList.add('active');
    const activeBtn = [...document.querySelectorAll('.tab-btn')].find(b => b.textContent.toLowerCase().includes(name === 'students' ? 'student' : name === 'elections' ? 'election' : name === 'candidates' ? 'candidate' : 'result'));
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.classList.remove('text-gray-400');
    }
}

// ─── Global State ─────────────────────────────────────────────────────────────
let allStudents = [];
let allElections = [];
let resultsChart = null;
let candidatesMap = {}; // { electionId: { candId: name } }
let statsRefreshTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
function showAdminAuth(message = '', isSuccess = false) {
    document.getElementById('admin-auth-section').classList.remove('hidden');
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-session-user').innerText = 'LIVE';
    renderAdminAuthMessage(message, isSuccess);
}

function showAdminDashboard(username) {
    document.getElementById('admin-auth-section').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    document.getElementById('admin-session-user').innerText = `${username} LIVE`;
}

function renderAdminAuthMessage(message, isSuccess) {
    const el = document.getElementById('admin-auth-message');
    if (!message) {
        el.classList.add('hidden');
        el.innerText = '';
        return;
    }

    el.classList.remove('hidden', 'text-green-400', 'text-red-500');
    el.classList.add(isSuccess ? 'text-green-400' : 'text-red-500');
    el.innerText = message;
}

async function bootstrapAdmin() {
    try {
        const response = await apiFetch('/api/admin/session');
        const data = await response.json();

        if (!response.ok) {
            showAdminAuth(data.error || 'Please sign in to continue.');
            return;
        }

        showAdminDashboard(data.username);
        await init();
    } catch (e) {
        showAdminAuth(`Unable to load admin session: ${e.message}`);
    }
}

async function init() {
    if (statsRefreshTimer) clearInterval(statsRefreshTimer);
    await Promise.all([loadStats(), loadStudents(), loadElections()]);
    statsRefreshTimer = setInterval(loadStats, 5000);
}

async function loginAdmin() {
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    const button = document.getElementById('admin-login-btn');

    if (!username || !password) {
        renderAdminAuthMessage('Username and password are required.', false);
        return;
    }

    button.disabled = true;
    button.innerText = 'Signing In...';

    try {
        const response = await apiFetch('/api/admin/session/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Unable to sign in.');
        }

        document.getElementById('admin-password').value = '';
        renderAdminAuthMessage('');
        showAdminDashboard(data.username);
        await init();
    } catch (e) {
        showAdminAuth(e.message || 'Unable to sign in.');
    } finally {
        button.disabled = false;
        button.innerText = 'Sign In';
    }
}

async function logoutAdmin() {
    try {
        await apiFetch('/api/admin/session/logout', { method: 'POST' });
    } catch (e) {
        console.error('Logout error:', e);
    } finally {
        if (statsRefreshTimer) {
            clearInterval(statsRefreshTimer);
            statsRefreshTimer = null;
        }
        showAdminAuth('Signed out successfully.', true);
    }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
    try {
        const r = await apiFetch('/api/admin/stats');
        const s = await r.json();
        document.getElementById('stat-total').innerText = s.total ?? '—';
        document.getElementById('stat-registered').innerText = s.registered ?? '—';
        document.getElementById('stat-votes').innerText = s.total_votes ?? '—';
        document.getElementById('stat-elections').innerText = s.total_elections ?? '—';
    } catch (e) { console.error('Stats error:', e); }
}

// ─── Students ─────────────────────────────────────────────────────────────────
async function loadStudents() {
    try {
        const r = await apiFetch('/api/admin/students');
        allStudents = await r.json();
        renderStudentTable(allStudents);
    } catch (e) { console.error('Load students error:', e); }
}

function renderStudentTable(students) {
    const tbody = document.getElementById('student-table-body');
    if (!students.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-600">No students found.</td></tr>';
        return;
    }
    tbody.innerHTML = students.map(s => {
        let statusBadge = '';
        if (s.is_registered) {
            statusBadge = `<span class="status-badge status-Active">✅ Bound</span>`;
        } else if (s.registration_unlocked) {
            statusBadge = `<span class="status-badge status-Upcoming">🔓 Unlocked</span>`;
        } else {
            statusBadge = `<span class="status-badge status-Closed">🔒 Locked</span>`;
        }

        const unlockBtn = !s.is_registered && !s.registration_unlocked
            ? `<button class="btn-success" onclick="unlockRegistration('${s.roll_number}')">Unlock</button>`
            : '';
        const revokeBtn = s.is_registered
            ? `<button class="btn-danger ml-1" onclick="revokeDevice('${s.roll_number}', '${s.name}')">Revoke</button>`
            : '';

        return `
            <tr>
                <td class="px-4 py-3 font-mono text-violet-300 font-semibold">${s.roll_number}</td>
                <td class="px-4 py-3 font-medium">${s.name}</td>
                <td class="px-4 py-3 text-gray-400">${s.course}</td>
                <td class="px-4 py-3 text-gray-400">Y${s.year} / ${s.section}</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3 text-right">${unlockBtn}${revokeBtn}</td>
            </tr>
        `;
    }).join('');
}

function filterStudents() {
    const q = document.getElementById('student-search').value.toLowerCase();
    const filtered = allStudents.filter(s =>
        s.roll_number.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
    renderStudentTable(filtered);
}

function openAddStudentForm() {
    document.getElementById('add-student-form').classList.toggle('hidden');
}

async function addStudent() {
    const roll = document.getElementById('ns-roll').value.trim();
    const name = document.getElementById('ns-name').value.trim();
    const course = document.getElementById('ns-course').value.trim();
    const year = parseInt(document.getElementById('ns-year').value.trim());
    const section = document.getElementById('ns-section').value.trim();
    const msg = document.getElementById('add-student-msg');

    if (!roll || !name || !course || !year || !section) {
        showMsg(msg, 'All fields are required.', false);
        return;
    }

    try {
        const r = await apiFetch('/api/admin/students', { method: 'POST', body: JSON.stringify({ roll_number: roll, name, course, year, section }) });
        const data = await r.json();
        if (data.success) {
            showMsg(msg, `✅ ${data.message}`, true);
            ['ns-roll','ns-name','ns-course','ns-year','ns-section'].forEach(id => document.getElementById(id).value = '');
            await loadStudents();
            await loadStats();
        } else {
            showMsg(msg, `❌ ${data.error}`, false);
        }
    } catch (e) { showMsg(msg, `Error: ${e.message}`, false); }
}

async function unlockRegistration(rollNumber) {
    if (!confirm(`Unlock biometric registration for ${rollNumber}?\n\nThe student should be physically present at the kiosk.`)) return;
    try {
        const r = await apiFetch(`/api/admin/unlock-registration/${rollNumber}`, { method: 'POST' });
        const data = await r.json();
        alert(data.success ? `✅ ${data.message}` : `❌ ${data.error}`);
        await loadStudents();
    } catch (e) { alert(`Error: ${e.message}`); }
}

async function revokeDevice(rollNumber, name) {
    if (!confirm(`⚠️ REVOKE device for ${name} (${rollNumber})?\n\nThis will permanently wipe their biometric key. They will need to re-register at the kiosk.\n\nThis action cannot be undone.`)) return;
    try {
        const r = await apiFetch(`/api/admin/revoke-device/${rollNumber}`, { method: 'POST' });
        const data = await r.json();
        alert(data.success ? `✅ ${data.message}` : `❌ ${data.error}`);
        await loadStudents();
        await loadStats();
    } catch (e) { alert(`Error: ${e.message}`); }
}

// ─── Elections ────────────────────────────────────────────────────────────────
async function loadElections() {
    try {
        const r = await apiFetch('/api/admin/elections');
        allElections = await r.json();
        renderElectionsList();
        populateElectionDropdowns();
    } catch (e) { console.error('Load elections error:', e); }
}

function renderElectionsList() {
    const el = document.getElementById('elections-list');
    if (!allElections.length) {
        el.innerHTML = '<p class="text-gray-600">No elections created yet.</p>';
        return;
    }
    el.innerHTML = allElections.map(e => {
        const rules = [
            e.allowed_course  ? `Course: ${e.allowed_course}`      : 'All Courses',
            e.allowed_year    ? `Year ${e.allowed_year}`            : 'All Years',
            e.allowed_section ? `Section ${e.allowed_section}`      : 'All Sections',
        ].join(' · ');

        return `
            <div class="glass rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                    <div class="flex items-center gap-3 mb-1">
                        <span class="status-badge status-${e.status}">${e.status}</span>
                        <h3 class="font-bold">${e.title}</h3>
                    </div>
                    <p class="text-xs text-gray-500">Eligibility: ${rules}</p>
                </div>
                <div class="flex gap-2 flex-shrink-0">
                    ${e.status !== 'Active'   ? `<button class="btn-success" onclick="setElectionStatus(${e.id}, 'Active')">Set Active</button>` : ''}
                    ${e.status !== 'Closed'   ? `<button class="btn-danger"  onclick="setElectionStatus(${e.id}, 'Closed')">Close</button>`     : ''}
                    ${e.status !== 'Upcoming' ? `<button class="btn-primary" onclick="setElectionStatus(${e.id}, 'Upcoming')" style="font-size:0.8rem;padding:0.3rem 0.8rem">Reset</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function populateElectionDropdowns() {
    const selects = ['cand-election-id', 'results-election-select'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        const currentVal = sel.value;
        sel.innerHTML = id === 'results-election-select'
            ? '<option value="">— Select an Election —</option>'
            : '<option value="">— Select Election —</option>';
        allElections.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `[${e.status}] ${e.title}`;
            sel.appendChild(opt);
        });
        sel.value = currentVal;
    });
}

async function createElection() {
    const title   = document.getElementById('elec-title').value.trim();
    const course  = document.getElementById('elec-course').value.trim()  || null;
    const year    = parseInt(document.getElementById('elec-year').value)  || null;
    const section = document.getElementById('elec-section').value.trim() || null;
    const status  = document.getElementById('elec-status').value;
    const msg     = document.getElementById('create-elec-msg');

    if (!title) { showMsg(msg, 'Election title is required.', false); return; }

    try {
        const r = await apiFetch('/api/admin/elections', { method: 'POST', body: JSON.stringify({ title, allowed_course: course, allowed_year: year, allowed_section: section, status }) });
        const data = await r.json();
        if (data.success) {
            showMsg(msg, `✅ Election "${data.election.title}" created!`, true);
            document.getElementById('elec-title').value = '';
            document.getElementById('elec-course').value = '';
            document.getElementById('elec-year').value = '';
            document.getElementById('elec-section').value = '';
            await loadElections();
            await loadStats();
        } else {
            showMsg(msg, `❌ ${data.error}`, false);
        }
    } catch (e) { showMsg(msg, e.message, false); }
}

async function setElectionStatus(id, status) {
    try {
        const r = await apiFetch(`/api/admin/elections/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
        const data = await r.json();
        if (data.success) await loadElections();
        else alert(`Error: ${data.error}`);
    } catch (e) { alert(`Error: ${e.message}`); }
}

// ─── Candidates ───────────────────────────────────────────────────────────────
async function addCandidate() {
    const election_id   = document.getElementById('cand-election-id').value;
    const name          = document.getElementById('cand-name').value.trim();
    const party_logo_url = document.getElementById('cand-logo').value.trim();
    const msg           = document.getElementById('cand-msg');

    if (!election_id || !name) { showMsg(msg, 'Select an election and enter a candidate name.', false); return; }

    try {
        const r = await apiFetch('/api/admin/candidates', { method: 'POST', body: JSON.stringify({ election_id, name, party_logo_url }) });
        const data = await r.json();
        if (data.success) {
            showMsg(msg, `✅ "${name}" added to election!`, true);
            document.getElementById('cand-name').value = '';
            document.getElementById('cand-logo').value = '';
        } else {
            showMsg(msg, `❌ ${data.error}`, false);
        }
    } catch (e) { showMsg(msg, e.message, false); }
}

// ─── Results ──────────────────────────────────────────────────────────────────
async function loadResults() {
    const electionId = document.getElementById('results-election-select').value;
    const logContainer = document.getElementById('vote-log');
    if (!electionId) { logContainer.innerHTML = '<p class="text-gray-600">Select an election to view ballots.</p>'; return; }

    try {
        // Load candidates for this election to build the map
        const cResp = await apiFetch(`/candidates?electionId=${electionId}`);
        const candidates = await cResp.json();
        const cMap = {};
        candidates.forEach(c => { cMap[c.id] = c.name; });

        // Load encrypted votes
        const vResp = await apiFetch(`/api/admin/votes?electionId=${electionId}`);
        const votes = await vResp.json();

        logContainer.innerHTML = '';
        const results = {};
        Object.keys(cMap).forEach(id => { results[id] = 0; });

        if (!votes.length) {
            logContainer.innerHTML = '<p class="text-gray-600">No ballots cast yet for this election.</p>';
        }

        votes.forEach(vote => {
            const decoded = vote.decrypted_ballot;
            const timeStr = new Date(vote.cast_at).toLocaleTimeString();

            if (vote.is_valid && decoded && cMap[decoded.candidateId]) {
                results[decoded.candidateId]++;
                logContainer.innerHTML += `
                    <div class="border-b border-white/5 pb-2">
                        <span class="text-green-500">[${timeStr}] Valid Ballot →</span>
                        <span class="text-blue-300 font-bold ml-2">${cMap[decoded.candidateId]}</span>
                        <br><span class="text-gray-700 opacity-50 truncate block">${vote.encrypted_ballot.substring(0, 60)}...</span>
                    </div>`;
            } else {
                logContainer.innerHTML += `
                    <div class="border-b border-red-500/20 pb-2">
                        <span class="text-red-500">[${timeStr}] Invalid / Forged Ballot!</span>
                        <br><span class="text-gray-700 opacity-50">${vote.encrypted_ballot.substring(0, 60)}...</span>
                    </div>`;
            }
        });

        renderChart(candidates, results);
    } catch (e) { console.error('Results error:', e); }
}

function renderChart(candidates, results) {
    const COLORS = [
        'rgba(59,130,246,0.8)', 'rgba(239,68,68,0.8)', 'rgba(34,197,94,0.8)',
        'rgba(234,179,8,0.8)', 'rgba(168,85,247,0.8)', 'rgba(20,184,166,0.8)',
    ];
    const ctx = document.getElementById('resultsChart').getContext('2d');
    if (resultsChart) resultsChart.destroy();

    resultsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: candidates.map(c => c.name),
            datasets: [{
                label: 'Votes',
                data: candidates.map(c => results[c.id] || 0),
                backgroundColor: COLORS.slice(0, candidates.length),
                borderColor: 'rgba(255,255,255,0.05)',
                borderWidth: 2,
                hoverOffset: 12,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#e2e8f0', font: { family: 'Outfit', size: 13 } } }
            },
            layout: { padding: 16 }
        }
    });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function formatAdminDateTime(value) {
    if (!value) return 'Not set';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function renderElectionsList() {
    const el = document.getElementById('elections-list');
    if (!allElections.length) {
        el.innerHTML = '<p class="text-gray-600">No elections created yet.</p>';
        return;
    }

    el.innerHTML = allElections.map(e => {
        const rules = [
            e.allowed_course ? `Course: ${e.allowed_course}` : 'All Courses',
            e.allowed_year ? `Year ${e.allowed_year}` : 'All Years',
            e.allowed_section ? `Section ${e.allowed_section}` : 'All Sections',
        ].join(' Â· ');
        const schedule = [
            `Starts: ${formatAdminDateTime(e.start_at)}`,
            `Ends: ${formatAdminDateTime(e.end_at)}`,
            `Results: ${formatAdminDateTime(e.result_at)}`,
        ].join('<br>');

        return `
            <div class="glass rounded-2xl p-5 flex flex-col gap-4">
                <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                        <div class="flex items-center gap-3 mb-1">
                            <span class="status-badge status-${e.status}">${e.status}</span>
                            <h3 class="font-bold">${e.title}</h3>
                        </div>
                        <p class="text-xs text-gray-500 mb-2">Eligibility: ${rules}</p>
                        <p class="text-xs text-gray-400 leading-6">${schedule}</p>
                    </div>
                    <div class="flex gap-2 flex-wrap">
                        ${e.status === 'Upcoming' ? `<button class="btn-success" onclick="setElectionStatus(${e.id}, 'Active')">Set Active</button>` : ''}
                        ${e.status === 'Active' ? `<button class="btn-danger" onclick="setElectionStatus(${e.id}, 'Closed')">Close</button>` : ''}
                        <button class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg text-xs font-bold" onclick="openEditModal(${e.id})">Edit</button>
                        <button class="btn-danger" onclick="deleteElection(${e.id}, '${e.title.replace(/'/g, "\\'")}')">Delete</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function createElection() {
    const title = document.getElementById('elec-title').value.trim();
    const course = document.getElementById('elec-course').value.trim() || null;
    const year = parseInt(document.getElementById('elec-year').value, 10) || null;
    const section = document.getElementById('elec-section').value.trim() || null;
    const start_at = document.getElementById('elec-start').value;
    const end_at = document.getElementById('elec-end').value;
    const result_at = document.getElementById('elec-result').value;
    const status = document.getElementById('elec-status').value;
    const msg = document.getElementById('create-elec-msg');

    if (!title) { showMsg(msg, 'Election title is required.', false); return; }
    if (!start_at || !end_at || !result_at) { showMsg(msg, 'Start, end, and result times are required.', false); return; }
    if (!(new Date(start_at) < new Date(end_at) && new Date(end_at) < new Date(result_at))) {
        showMsg(msg, 'Times must follow start < end < result.', false);
        return;
    }

    try {
        const r = await apiFetch('/api/admin/elections', {
            method: 'POST',
            body: JSON.stringify({ title, allowed_course: course, allowed_year: year, allowed_section: section, start_at, end_at, result_at, status }),
        });
        const data = await r.json();
        if (data.success) {
            showMsg(msg, `Election "${data.election.title}" created!`, true);
            ['elec-title', 'elec-course', 'elec-year', 'elec-section', 'elec-start', 'elec-end', 'elec-result'].forEach(id => {
                document.getElementById(id).value = '';
            });
            await loadElections();
            await loadStats();
        } else {
            showMsg(msg, data.error, false);
        }
    } catch (e) {
        showMsg(msg, e.message, false);
    }
}

async function deleteElection(id, title) {
    if (!confirm(`Delete election "${title}"?\n\nThis also removes its candidates and votes.`)) return;

    try {
        const response = await apiFetch(`/api/admin/elections/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to delete election.');
        await loadElections();
        await loadStats();
        alert(data.message || 'Election deleted.');
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

function showMsg(el, text, isSuccess) {
    el.classList.remove('hidden', 'text-green-400', 'text-red-500');
    el.classList.add(isSuccess ? 'text-green-400' : 'text-red-500');
    el.innerText = text;
    setTimeout(() => el.classList.add('hidden'), 5000);
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', bootstrapAdmin);
// ─── Edit Election Logic ──────────────────────────────────────────────────────
function openEditModal(id) {
    const e = allElections.find(x => x.id === id);
    if (!e) return;

    document.getElementById('edit-id').value = e.id;
    document.getElementById('edit-title').value = e.title;
    document.getElementById('edit-course').value = e.allowed_course || '';
    document.getElementById('edit-year').value = e.allowed_year || '';
    document.getElementById('edit-section').value = e.allowed_section || '';
    
    // Format dates for datetime-local input
    const toInputVal = (d) => d ? new Date(d).toISOString().slice(0, 16) : '';
    document.getElementById('edit-start').value = toInputVal(e.start_at);
    document.getElementById('edit-end').value = toInputVal(e.end_at);
    document.getElementById('edit-result').value = toInputVal(e.result_at);

    const isLive = e.status === 'Active';
    document.getElementById('edit-status-warning').classList.toggle('hidden', !isLive);
    
    // Disable fields if live
    ['edit-title', 'edit-course', 'edit-year', 'edit-section', 'edit-start', 'edit-end'].forEach(id => {
        document.getElementById(id).disabled = isLive;
        document.getElementById(id).style.opacity = isLive ? '0.5' : '1';
    });

    document.getElementById('edit-election-modal').classList.remove('hidden');
    document.getElementById('edit-election-modal').classList.add('flex');
}

function closeEditModal() {
    document.getElementById('edit-election-modal').classList.add('hidden');
    document.getElementById('edit-election-modal').classList.remove('flex');
}

async function saveElectionChanges() {
    const id = document.getElementById('edit-id').value;
    const body = {
        title: document.getElementById('edit-title').value,
        allowed_course: document.getElementById('edit-course').value,
        allowed_year: document.getElementById('edit-year').value,
        allowed_section: document.getElementById('edit-section').value,
        start_at: document.getElementById('edit-start').value,
        end_at: document.getElementById('edit-end').value,
        result_at: document.getElementById('edit-result').value,
    };

    // Validate: result_at must be after end_at
    if (body.end_at && body.result_at && new Date(body.result_at) <= new Date(body.end_at)) {
        alert('⚠️ Result Release time must be AFTER the End time.');
        return;
    }

    // Validate: start_at must be before end_at (for non-active elections)
    if (body.start_at && body.end_at && !document.getElementById('edit-start').disabled) {
        if (new Date(body.start_at) >= new Date(body.end_at)) {
            alert('⚠️ Start time must be BEFORE the End time.');
            return;
        }
    }

    try {
        const r = await apiFetch(`/api/admin/elections/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        const res = await r.json();
        if (res.error) throw new Error(res.error);
        
        alert(res.message);
        closeEditModal();
        loadElections();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}
