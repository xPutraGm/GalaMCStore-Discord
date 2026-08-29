let adminToken = localStorage.getItem('adminToken') || '';
let currentRanksData = {};

document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
});

// Cek Auth Session Pas Buka Halaman
async function checkAuthStatus() {
    try {
        const res = await fetch('/api/admin/check-auth', {
            headers: { 'x-admin-auth': adminToken }
        });
        const json = await res.json();

        if (json.success) {
            showAdminDashboard();
        } else {
            showLoginModal();
        }
    } catch (err) {
        showLoginModal();
    }
}

function showLoginModal() {
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('adminContent').classList.add('hidden');
}

function showAdminDashboard() {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('adminContent').classList.remove('hidden');
    loadRanks();
}

// HANDLE LOGIN FORM SUBMIT
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const json = await res.json();

        if (json.success) {
            adminToken = json.token;
            localStorage.setItem('adminToken', adminToken);
            errorEl.classList.add('hidden');
            showAdminDashboard();
        } else {
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.classList.remove('hidden');
    }
});

// HANDLE LOGOUT
async function logoutAdmin() {
    await fetch('/api/admin/logout', { method: 'POST' });
    localStorage.removeItem('adminToken');
    adminToken = '';
    showLoginModal();
}

// FETCH DATA RANKS WITH AUTH HEADER
async function loadRanks() {
    try {
        const res = await fetch('/api/ranks');
        const json = await res.json();
        if (json.success) {
            currentRanksData = json.data;
            renderRanks(json.data);
        }
    } catch (err) {
        console.error('❌ Error Fetching Ranks:', err);
    }
}

function renderRanks(ranks) {
    const grid = document.getElementById('rankGrid');
    grid.innerHTML = '';

    for (const [id, rank] of Object.entries(ranks)) {
        const benefitsList = rank.benefits.map(b => `<li class="text-slate-300 text-xs">${b}</li>`).join('');
        
        const card = document.createElement('div');
        card.className = "bg-slate-800/80 border border-slate-700 rounded-2xl p-6 flex flex-col justify-between hover:border-indigo-500/50 transition";
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider text-indigo-400">Minecraft Rank</span>
                        <h3 class="text-2xl font-black text-white">${id}</h3>
                    </div>
                    <span class="px-3 py-1 bg-slate-700 rounded-xl text-emerald-400 font-extrabold text-sm">Rp ${rank.price.toLocaleString('id-ID')}</span>
                </div>
                <div class="mb-4 text-xs text-slate-400">
                    <strong>Discord Role ID:</strong> <code class="bg-slate-900 px-2 py-1 rounded text-slate-300">${rank.discordRoleId || 'Belum Set'}</code>
                </div>
                <ul class="space-y-1.5 mb-6 border-t border-slate-700/50 pt-4">
                    ${benefitsList}
                </ul>
            </div>
            <div class="flex gap-2">
                <button onclick="editRank('${id}')" class="w-full bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 rounded-xl text-sm transition">✏️ Edit</button>
                <button onclick="deleteRank('${id}')" class="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium px-3 py-2 rounded-xl text-sm transition">🗑️</button>
            </div>
        `;
        grid.appendChild(card);
    }
}

function openModal() {
    document.getElementById('modalTitle').innerText = '➕ Tambah Rank Baru';
    document.getElementById('modalRankId').value = '';
    document.getElementById('modalRankId').disabled = false;
    document.getElementById('modalRankPrice').value = '';
    document.getElementById('modalRankRole').value = '';
    document.getElementById('modalRankBenefits').value = '';
    document.getElementById('rankModal').classList.remove('hidden');
}

function editRank(id) {
    const rank = currentRanksData[id];
    document.getElementById('modalTitle').innerText = `✏️ Edit Rank: ${id}`;
    document.getElementById('modalRankId').value = id;
    document.getElementById('modalRankId').disabled = true;
    document.getElementById('modalRankPrice').value = rank.price;
    document.getElementById('modalRankRole').value = rank.discordRoleId || '';
    document.getElementById('modalRankBenefits').value = rank.benefits.join('\n');
    document.getElementById('rankModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('rankModal').classList.add('hidden');
}

// SAVE RANK WITH AUTH HEADER
document.getElementById('rankForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('modalRankId').value.toUpperCase().trim();
    const price = parseInt(document.getElementById('modalRankPrice').value);
    const roleId = document.getElementById('modalRankRole').value.trim();
    const benefitsRaw = document.getElementById('modalRankBenefits').value;
    const benefits = benefitsRaw.split('\n').filter(b => b.trim().length > 0);

    try {
        const res = await fetch('/api/admin/rank', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-auth': adminToken
            },
            body: JSON.stringify({ id, price, discordRoleId: roleId, benefits })
        });
        const json = await res.json();
        if (json.success) {
            closeModal();
            loadRanks();
        } else {
            alert(`Gagal: ${json.message}`);
        }
    } catch (err) {
        alert('Gagal menyimpan data rank');
    }
});

// DELETE RANK WITH AUTH HEADER
async function deleteRank(id) {
    if (!confirm(`Apakah kamu yakin ingin menghapus Rank ${id}?`)) return;
    try {
        const res = await fetch(`/api/admin/rank/${id}`, { 
            method: 'DELETE',
            headers: { 'x-admin-auth': adminToken }
        });
        const json = await res.json();
        if (json.success) loadRanks();
        else alert(`Gagal: ${json.message}`);
    } catch (err) {
        alert('Gagal menghapus rank');
    }
}