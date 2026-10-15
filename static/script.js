// Global navigation and active tab management
const tabs = ['dashboard', 'analytics', 'predict', 'hotspots'];
const titles = {
    dashboard: 'Overview',
    predict: 'Severity predictor',
    hotspots: 'High-risk areas',
    analytics: 'Data insights'
};

// Chart defaults: Inter, quiet text, in-palette foreground
if (window.Chart) {
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#5f6873';
}

function switchTab(tabId) {
    tabs.forEach(t => {
        const tabEl = document.getElementById(`tab-${t}`);
        const navEl = document.getElementById(`nav-${t}`);
        if (tabEl) tabEl.classList.add('hidden');
        if (navEl) {
            navEl.classList.remove('is-active');
            navEl.removeAttribute('aria-current');
        }
    });

    const activeTab = document.getElementById(`tab-${tabId}`);
    const activeNav = document.getElementById(`nav-${tabId}`);

    if (activeTab) activeTab.classList.remove('hidden');
    if (activeNav) {
        activeNav.classList.add('is-active');
        activeNav.setAttribute('aria-current', 'page');
    }

    const titleEl = document.getElementById('page-title');
    if (titleEl && titles[tabId]) {
        titleEl.innerText = titles[tabId];
    }

    // Refresh Leaflet map if hotspot tab is selected
    if (tabId === 'hotspots' && window.mapInstance) {
        setTimeout(() => { window.mapInstance.invalidateSize(); }, 200);
    }
    if (window.innerWidth < 1024) closeSidebar();
}

// Mobile sidebar
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    if (!sb) return;
    const isClosed = sb.classList.toggle('closed');
    if (bd) bd.classList.toggle('hidden', isClosed);
}
function closeSidebar() {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    if (sb) sb.classList.add('closed');
    if (bd) bd.classList.add('hidden');
}

// Dark / light theme, remembered across visits
function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    const icon = document.getElementById('theme-toggle-icon');
    if (icon) icon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    try { localStorage.setItem('roadsafe-theme', dark ? 'dark' : 'light'); } catch (e) {}
}
function toggleTheme() {
    applyTheme(!document.documentElement.classList.contains('dark'));
}

// Initialize Overview & Analytics Charts (real data from build_dashboard_data.py)
let DASH = null;
async function getDash() {
    if (DASH) return DASH;
    try {
        const r = await fetch('/static/dashboard_data.json');
        DASH = await r.json();
    } catch (err) {
        console.error('dashboard_data.json missing, using demo fallback:', err);
        DASH = null;
    }
    return DASH;
}

function initCharts() {
    getDash().then(d => {
    const hsCard = document.getElementById('stat-highsev');
    if (hsCard && d && d.totals) hsCard.innerText = d.totals.high_sev_pct + '%';
    // Overview Severity Doughnut Chart
    const overviewCtx = document.getElementById('overviewSeverityChart');
    if (overviewCtx) {
        new Chart(overviewCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Slight Injury', 'Serious Injury', 'Fatal Injury'],
                datasets: [{
                    data: d ? d.severity.counts : [75.2, 19.8, 5.0],
                    backgroundColor: ['#1f7a4d', '#8f5a00', '#b3261e'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Inter', size: 12 } } }
                }
            }
        });
    }

    // Weather Condition Chart
    const weatherCtx = document.getElementById('weatherChart');
    if (weatherCtx) {
        new Chart(weatherCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: d ? d.weather.labels : ['Fine, no high winds', 'Raining, no high winds', 'Fog or mist', 'Snowing', 'Other'],
                datasets: [{
                    label: 'Accidents Count',
                    data: d ? d.weather.counts : [1020000, 240000, 65000, 35000, 29640],
                    backgroundColor: '#12457e',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                onClick: (evt, els, chart) => {
                    if (!els.length) return;
                    // A bar only acts in the enlarged view; on the grid a click enlarges the card.
                    if (!chart.canvas || !chart.canvas.closest('#chart-modal')) return;
                    const label = chart.data.labels[els[0].index];
                    const mapBack = { 'Fine no high winds': 'Clear', 'Raining no high winds': 'Rain', 'Fog or mist': 'Fog', 'Snowing': 'Snow' };
                    const sel = document.getElementById('weather');
                    if (sel && mapBack[label]) { sel.value = mapBack[label]; closeChartModal(); switchTab('predict'); }
                }
            }
        });
    }

    // Time of Day Chart
    const timeCtx = document.getElementById('timeChart');
    if (timeCtx) {
        new Chart(timeCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: d ? d.hour.labels : ['12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM'],
                datasets: [{
                    label: 'Accidents Frequency',
                    data: d ? d.hour.counts : [25000, 12000, 75000, 210000, 180000, 260000, 310000, 110000],
                    borderColor: '#12457e',
                    backgroundColor: 'rgba(18, 69, 126, 0.07)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }

    // Surface Type Chart
    const surfaceCtx = document.getElementById('surfaceChart');
    if (surfaceCtx) {
        new Chart(surfaceCtx.getContext('2d'), {
            type: 'polarArea',
            data: {
                labels: d ? d.surface.labels : ['Dry', 'Wet or damp', 'Frost/Ice', 'Snow', 'Flood'],
                datasets: [{
                    data: d ? d.surface.counts : [950000, 380000, 35000, 15000, 9640],
                    backgroundColor: ['#12457e', '#3f6f9e', '#8f5a00', '#6b8fb5', '#b3261e']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { boxWidth: 10 } } },
                onClick: (evt, els, chart) => {
                    if (!els.length) return;
                    // A bar only acts in the enlarged view; on the grid a click enlarges the card.
                    if (!chart.canvas || !chart.canvas.closest('#chart-modal')) return;
                    const label = chart.data.labels[els[0].index];
                    const mapBack = { 'Dry': 'Dry', 'Wet or damp': 'Wet or damp', 'Frost or ice': 'Frost or ice', 'Snow': 'Snow' };
                    const sel = document.getElementById('surface');
                    if (sel && mapBack[label]) { sel.value = mapBack[label]; closeChartModal(); switchTab('predict'); }
                }
            }
        });
    }

    // Speed Limit vs High Severity Chart
    const speedCtx = document.getElementById('speedChart');
    if (speedCtx) {
        new Chart(speedCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: d ? d.speed.labels : ['20 MPH', '30 MPH', '40 MPH', '50 MPH', '60 MPH', '70 MPH'],
                datasets: [{
                    label: 'High Severity Rate (%)',
                    data: d ? d.speed.high_sev_pct : [8.5, 12.1, 15.6, 22.4, 28.9, 34.2],
                    backgroundColor: '#12457e',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { max: 40 } }
            }
        });
    }

    // Severity Share by Hour Chart (when is it serious, not just frequent?)
    const hourSevCtx = document.getElementById('hourSevChart');
    if (hourSevCtx && d && d.hour_severity) {
        const bins = d.hour.labels;
        new Chart(hourSevCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: bins,
                datasets: [
                    { label: 'Slight %', data: bins.map(b => d.hour_severity[b].Slight), backgroundColor: '#1f7a4d' },
                    { label: 'Serious %', data: bins.map(b => d.hour_severity[b].Serious), backgroundColor: '#8f5a00' },
                    { label: 'Fatal %', data: bins.map(b => d.hour_severity[b].Fatal), backgroundColor: '#b3261e' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true, max: 100 } },
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }

    // High-Severity Share by Vehicle Type Chart
    const vehSevCtx = document.getElementById('vehSevChart');
    if (vehSevCtx && d && d.vehicle_severity) {
        const groups = Object.keys(d.vehicle_severity).sort(
            (a, b) => (d.vehicle_severity[b].serious + d.vehicle_severity[b].fatal) - (d.vehicle_severity[a].serious + d.vehicle_severity[a].fatal));
        new Chart(vehSevCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: groups.map(g => `${g} (n=${d.vehicle_severity[g].n.toLocaleString('en-GB')})`),
                datasets: [
                    { label: 'Serious %', data: groups.map(g => d.vehicle_severity[g].serious), backgroundColor: '#8f5a00', borderRadius: 4 },
                    { label: 'Fatal %', data: groups.map(g => d.vehicle_severity[g].fatal), backgroundColor: '#b3261e', borderRadius: 4 }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true } },
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
            }
        });
    }
    });
}

// Initialize Leaflet Map for Hotspots (real DBSCAN centroids from dashboard_data.json)
let HOTSPOT_LAYERS = [];
let CLUSTER = null;
const RISK_COLOR = { fatal: '#b3261e', serious: '#8f5a00', slight: '#12457e' };

function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    const map = L.map('map').setView([54.5, -3.0], 6);
    window.mapInstance = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Colour scale legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = '<b>Hotspot risk</b><br>' +
            `<i style="background:${RISK_COLOR.fatal}"></i>Fatal collision present<br>` +
            `<i style="background:${RISK_COLOR.serious}"></i>High serious share<br>` +
            `<i style="background:${RISK_COLOR.slight}"></i>Lower severity share`;
        return div;
    };
    legend.addTo(map);

    // "Show my location" button
    const locate = L.control({ position: 'topleft' });
    locate.onAdd = function () {
        const bar = L.DomUtil.create('div', 'leaflet-bar');
        const a = L.DomUtil.create('a', '', bar);
        a.href = '#'; a.title = 'Show my location'; a.setAttribute('aria-label', 'Show my location');
        a.innerHTML = '&#128205;';
        a.style.fontSize = '16px'; a.style.lineHeight = '26px'; a.style.textAlign = 'center';
        L.DomEvent.on(a, 'click', function (e) {
            L.DomEvent.stop(e);
            if (!navigator.geolocation) return;
            navigator.geolocation.getCurrentPosition(function (pos) {
                const ll = [pos.coords.latitude, pos.coords.longitude];
                map.setView(ll, 12);
                L.circleMarker(ll, { radius: 8, color: '#12457e', fillColor: '#12457e', fillOpacity: 0.9 })
                    .addTo(map).bindPopup('You are here').openPopup();
            });
        });
        return bar;
    };
    locate.addTo(map);

    map.on('click', (e) => {
        const lat = e.latlng.lat.toFixed(4);
        const lng = e.latlng.lng.toFixed(4);
        L.popup()
            .setLatLng(e.latlng)
            .setContent(`<b>${lat}, ${lng}</b><br><button type="button" onclick="predictHere(${lat}, ${lng})" style="margin-top:6px;padding:7px 12px;background:#12457e;color:#fff;border:0;border-radius:6px;font:500 12px/1.2 'Inter',sans-serif;cursor:pointer;">Predict severity here</button>`)
            .openOn(map);
    });

    CLUSTER = (typeof L.markerClusterGroup === 'function')
        ? L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false })
        : null;
    if (CLUSTER) map.addLayer(CLUSTER);

    const render = (hotspots) => {
        if (CLUSTER) CLUSTER.clearLayers();
        HOTSPOT_LAYERS.forEach(x => { if (!CLUSTER) map.removeLayer(x.layer); });
        HOTSPOT_LAYERS = [];
        (hotspots || []).forEach((hs, i) => {
            const cls = hs.fatal >= 1 ? 'fatal' : (hs.high_sev_pct >= 25 ? 'serious' : 'slight');
            const color = RISK_COLOR[cls];
            const size = 12 + Math.round(Math.min(18, hs.high_sev_pct / 2));
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:.85;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
                iconSize: [size, size], iconAnchor: [size / 2, size / 2]
            });
            const title = hs.name ? `${hs.rank ?? (i + 1)}. ${hs.name}` : `Hotspot ${i + 1}`;
            const marker = L.marker([hs.lat, hs.lng], { icon: icon, title: title });
            marker._sevClass = cls;
            marker.bindPopup(`<b>${title}</b><br>Serious or fatal: ${hs.high_sev_pct}%<br>Total ${hs.count} · Serious ${hs.serious} · Fatal ${hs.fatal} · Slight ${hs.slight}<br><span style="color:#64748b">${hs.lat}, ${hs.lng}</span>`);
            if (CLUSTER) CLUSTER.addLayer(marker); else marker.addTo(map);
            HOTSPOT_LAYERS.push({ layer: marker, hs: hs, idx: i });
        });
        if (HOTSPOT_LAYERS.length) {
            const bounds = CLUSTER ? CLUSTER.getBounds() : L.featureGroup(HOTSPOT_LAYERS.map(x => x.layer)).getBounds();
            map.fitBounds(bounds.pad(0.2));
        }
        updateHotspotCount(HOTSPOT_LAYERS.length, HOTSPOT_LAYERS.length);
        renderHotspotList();
    };

    fetch('/static/dashboard_data.json')
        .then(r => r.json())
        .then(d => {
            window.HOTSPOTS = d.hotspots || [];
            window.HOTSPOT_AVG = (d.totals && d.totals.high_sev_pct != null) ? d.totals.high_sev_pct : null;
            render(window.HOTSPOTS);
        })
        .catch(err => console.error('hotspot data missing:', err));
}

// Reflect how many areas the current filters are showing
function updateHotspotCount(shown, total) {
    const el = document.getElementById('hotspot-count');
    if (!el) return;
    const win = TIME_WINDOW === 'All' ? '' : ` · ${TIME_WINDOW.toLowerCase()} ${WINDOW_HOURS[TIME_WINDOW]}`;
    el.innerText = (total && shown !== total) ? `Showing ${shown} of ${total} areas${win}` : `${total} areas${win}`;
}

// ---- Hotspot filters: severity class and time of day ----
let SEV_FILTER = 'all';
let TIME_WINDOW = 'All';

// dashboard_data.json stores each area's collisions in 6-hour cells keyed
// "Weekday|00-06" through "Weekend|18-24", so the daytime windows read straight
// off one cell each and night is the two overnight cells combined.
const WINDOW_BUCKETS = {
    Morning: ['06-12'],
    Afternoon: ['12-18'],
    Night: ['18-24', '00-06']
};
const WINDOW_HOURS = { Morning: '06:00-12:00', Afternoon: '12:00-18:00', Night: '18:00-06:00' };

// Collisions recorded in one area inside the selected time window
function windowCount(hs, win) {
    if (!hs) return 0;
    if (!win || win === 'All' || !hs.cells) return hs.count || 0;
    const parts = WINDOW_BUCKETS[win] || [];
    let n = 0;
    ['Weekday', 'Weekend'].forEach(day => parts.forEach(part => {
        const cell = hs.cells[`${day}|${part}`];
        if (cell) n += cell.count || 0;
    }));
    return n;
}

// An area shows when it passes both the severity filter and the time filter
function hotspotVisible(entry) {
    const sevOk = SEV_FILTER === 'all' || (entry.layer && entry.layer._sevClass === SEV_FILTER);
    const timeOk = TIME_WINDOW === 'All' || windowCount(entry.hs, TIME_WINDOW) > 0;
    return sevOk && timeOk;
}

function setSegActive(group, btn) {
    if (!group) return;
    group.querySelectorAll('button').forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

// Filter Map Hotspots by severity class, report the count, and refit what is shown
function filterMap(type, btn) {
    SEV_FILTER = type;
    setSegActive(document.getElementById('sev-seg'), btn);
    applyFilters();
}

// Filter Map Hotspots by time of day (morning, afternoon, night)
function filterTime(win, btn) {
    TIME_WINDOW = (win === 'All' || WINDOW_BUCKETS[win]) ? win : 'All';
    setSegActive(document.getElementById('time-seg'), btn);
    applyFilters();
}

// Push both filters onto the map markers and the ranked list, then refit the view
function applyFilters() {
    if (!window.mapInstance) return;

    const visible = [];
    HOTSPOT_LAYERS.forEach(entry => {
        const l = entry.layer;
        const show = hotspotVisible(entry);
        if (show) visible.push(l);
        if (CLUSTER) {
            if (show && !CLUSTER.hasLayer(l)) CLUSTER.addLayer(l);
            if (!show && CLUSTER.hasLayer(l)) CLUSTER.removeLayer(l);
        } else {
            if (show && !window.mapInstance.hasLayer(l)) l.addTo(window.mapInstance);
            if (!show && window.mapInstance.hasLayer(l)) window.mapInstance.removeLayer(l);
        }
    });

    updateHotspotCount(visible.length, HOTSPOT_LAYERS.length);

    if (visible.length) {
        const bounds = CLUSTER ? CLUSTER.getBounds() : L.featureGroup(visible).getBounds();
        if (bounds && bounds.isValid()) window.mapInstance.fitBounds(bounds.pad(0.2), { maxZoom: 11 });
    }

    renderHotspotList();
}

// Plain-language risk band, relative to the national serious-or-fatal rate
function riskLabel(pct, avg) {
    const base = (avg == null) ? 24 : avg;
    if (pct >= base + 8) return { text: 'High risk', cls: 'risk-high' };
    if (pct >= base) return { text: 'Above average', cls: 'risk-mid' };
    return { text: 'Below average', cls: 'risk-low' };
}

// Ranked list beside the map: the top 10 areas for the current filters (click to zoom)
function renderHotspotList() {
    const el = document.getElementById('hotspot-list');
    if (!el) return;
    const byWindow = TIME_WINDOW !== 'All';
    const title = document.getElementById('hotspot-list-title');
    if (title) title.innerText = byWindow ? `Top 10 in the ${TIME_WINDOW.toLowerCase()}` : 'Top 10 by risk';

    const rows = HOTSPOT_LAYERS
        .filter(hotspotVisible)
        .map(entry => ({ hs: entry.hs, i: entry.idx, w: windowCount(entry.hs, TIME_WINDOW) }));

    if (byWindow) rows.sort((a, b) => b.w - a.w || a.i - b.i);
    else rows.sort((a, b) => (a.hs.rank ?? a.i + 1) - (b.hs.rank ?? b.i + 1));

    const items = rows.slice(0, 10);
    if (!items.length) {
        el.innerHTML = `<p class="t-caption fg-muted">No mapped area has a recorded collision in the ${byWindow ? TIME_WINDOW.toLowerCase() : 'current selection'}.</p>`;
        return;
    }
    el.innerHTML = '';
    items.forEach(({ hs, i, w }) => {
        const rank = hs.rank ?? (i + 1);
        const name = hs.name || `Hotspot ${rank}`;
        const risk = riskLabel(hs.high_sev_pct, window.HOTSPOT_AVG);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hotspot-item';
        b.innerHTML = `
            <div class="row1">
                <span class="t-label">${byWindow ? name : `${rank}. ${name}`}</span>
                <span class="risk ${risk.cls}">${risk.text}</span>
            </div>
            ${byWindow ? `<div class="meta">Collisions ${WINDOW_HOURS[TIME_WINDOW]}: <b class="fg-ink">${w}</b></div>` : ''}
            <div class="meta">Serious or fatal: <b class="fg-ink">${hs.high_sev_pct}%</b></div>
            <div class="meta">Total ${hs.count} · Serious ${hs.serious} · Fatal ${hs.fatal} · Slight ${hs.slight}</div>`;
        b.onclick = () => {
            if (!window.mapInstance) return;
            const found = HOTSPOT_LAYERS.find(x => (x.idx ?? -1) === i);
            if (!found) return;
            if (CLUSTER && CLUSTER.zoomToShowLayer) {
                CLUSTER.zoomToShowLayer(found.layer, () => {
                    window.mapInstance.setView(found.layer.getLatLng(), Math.max(window.mapInstance.getZoom(), 12));
                    found.layer.openPopup();
                });
            } else {
                window.mapInstance.setView([hs.lat, hs.lng], 11);
                setTimeout(() => found.layer.openPopup(), 300);
            }
        };
        el.appendChild(b);
    });
}

let LAST_PREDICT = null;
let PREDICT_MARKER = null;

// Predict -> Map: jump to the predicted area on the hotspot map
function viewPredictionOnMap() {
    if (!LAST_PREDICT) return;
    switchTab('hotspots');
    setTimeout(() => {
        const map = window.mapInstance;
        if (!map) return;
        if (PREDICT_MARKER) map.removeLayer(PREDICT_MARKER);
        PREDICT_MARKER = L.marker([LAST_PREDICT.lat, LAST_PREDICT.lng]).addTo(map);
        PREDICT_MARKER.bindPopup(`<b>Your prediction</b><br>Severity: ${LAST_PREDICT.severity}<br>${LAST_PREDICT.hotspot}<br>Confidence: ${LAST_PREDICT.conf}%`).openPopup();
        map.setView([LAST_PREDICT.lat, LAST_PREDICT.lng], 11);
    }, 250);
}

// Map -> Predict: click anywhere to score that spot
function predictHere(lat, lng) {
    const latEl = document.getElementById('lat');
    const lngEl = document.getElementById('lng');
    if (latEl) latEl.value = lat.toFixed(4);
    if (lngEl) lngEl.value = lng.toFixed(4);
    switchTab('predict');
}

// Handle ML Severity Prediction Form Submission (backend auto-selects best model)
function readFormPayload() {
    const hourEl = document.getElementById('hour');
    return {
        latitude: parseFloat(document.getElementById('lat').value),
        longitude: parseFloat(document.getElementById('lng').value),
        weather: document.getElementById('weather').value,
        road_surface: document.getElementById('surface').value,
        speed_limit: parseInt(document.getElementById('speed').value),
        hour: hourEl ? parseInt(hourEl.value) : 12,
        vehicle_type: document.getElementById('vehicle-type') ? document.getElementById('vehicle-type').value : '',
        age_band: document.getElementById('age-band') ? document.getElementById('age-band').value : '',
        light: document.getElementById('light') ? document.getElementById('light').value : '',
        road_type: document.getElementById('road-type') ? document.getElementById('road-type').value : '',
        junction: document.getElementById('junction') ? document.getElementById('junction').value : ''
    };
}

function validatePayload(p) {
    const hourHint = document.getElementById('hour-hint');
    const speedHint = document.getElementById('speed-hint');
    let ok = true;
    const badHour = !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23;
    const badSpeed = !Number.isFinite(p.speed_limit) || p.speed_limit < 5 || p.speed_limit > 90;
    if (hourHint) hourHint.classList.toggle('hidden', !badHour);
    if (speedHint) speedHint.classList.toggle('hidden', !badSpeed);
    if (badHour || badSpeed) ok = false;
    return ok;
}

function setLoading(loading, label) {
    const runBtn = document.getElementById('run-btn');
    const runLabel = document.getElementById('run-btn-label');
    const runIcon = document.getElementById('run-btn-icon');
    if (runBtn) runBtn.disabled = loading;
    if (loading) {
        if (runLabel) runLabel.innerText = label || 'Predicting…';
        if (runIcon) runIcon.className = 'fa-solid fa-circle-notch fa-spin';
    } else {
        if (runLabel) runLabel.innerText = 'Run prediction';
        if (runIcon) runIcon.className = 'fa-solid fa-arrow-right-long';
    }
}

async function handlePrediction(e) {
    e.preventDefault();
    const payload = readFormPayload();
    if (!validatePayload(payload)) return;
    setLoading(true);
    try {
        await submitPrediction(payload);
    } finally {
        setLoading(false);
    }
}

async function submitPrediction(payload) {

    try {
        const response = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status === 'success') {
            const severity = result.predicted_severity;
            const probs = result.probabilities;
            
            const slightProb = Math.round(probs['Slight'] ?? probs['Slight Injury'] ?? 60);
            const seriousProb = Math.round(probs['Serious'] ?? probs['Serious Injury'] ?? 30);
            const fatalProb = Math.round(probs['Fatal'] ?? probs['Fatal Injury'] ?? 10);
            const maxProb = Math.max(slightProb, seriousProb, fatalProb);

            let badgeClass = "badge-slight";
            if (severity.toLowerCase().includes('fatal')) {
                badgeClass = "badge-fatal";
            } else if (severity.toLowerCase().includes('serious')) {
                badgeClass = "badge-serious";
            }

            document.getElementById('prediction-result').classList.remove('hidden');
            document.getElementById('res-severity').innerText = severity + ` (${result.algorithm_used})`;
            document.getElementById('res-confidence').innerText = maxProb + '%';

            const insideHotspot = (result.cluster_id ?? -1) >= 0;
            const hsName = result.hotspot || (insideHotspot ? `Cluster #${result.cluster_id}` : 'Open road');
            document.getElementById('res-cluster').innerText = hsName;
            const hsSub = document.getElementById('res-cluster-sub');
            if (hsSub) {
                if (insideHotspot) {
                    const rank = result.hotspot_rank ? `Rank #${result.hotspot_rank} of ${result.n_hotspots}` : `Cluster #${result.cluster_id}`;
                    const sev = (result.hotspot_high_sev_pct != null) ? ` · ${result.hotspot_high_sev_pct}% serious or fatal` : '';
                    hsSub.innerText = `${rank} · ${result.hotspot_count} collisions${sev}`;
                } else {
                    hsSub.innerText = 'Not inside a mapped accident hotspot';
                }
            }
            
            const badge = document.getElementById('badge-severity');
            badge.className = "badge " + badgeClass;
            badge.innerText = severity;

            const timeBadge = document.getElementById('badge-time');
            if (timeBadge) {
                const tod = (result.time_of_day || 'Day').toString();
                const isNight = tod.toLowerCase().startsWith('night');
                timeBadge.className = "badge badge-neutral";
                timeBadge.innerText = isNight ? "Night" : "Day";
            }

            document.getElementById('prob-slight').innerText = slightProb + '%';
            document.getElementById('bar-slight').style.width = slightProb + '%';

            document.getElementById('prob-serious').innerText = seriousProb + '%';
            document.getElementById('bar-serious').style.width = seriousProb + '%';

            document.getElementById('prob-fatal').innerText = fatalProb + '%';
            document.getElementById('bar-fatal').style.width = fatalProb + '%';

            LAST_PREDICT = {
                lat: payload.latitude, lng: payload.longitude,
                severity: severity,
                hotspot: insideHotspot
                    ? `Hotspot: ${hsName}${result.hotspot_rank ? ' (rank #' + result.hotspot_rank + ')' : ''}`
                    : 'Open road (no mapped hotspot)',
                conf: maxProb
            };
            document.getElementById('prediction-result').scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Prediction error: ' + result.message);
        }
    } catch (error) {
        console.error('Error connecting to Flask backend:', error);
        alert('Could not connect to Flask server. Make sure app.py is running!');
    }
}

// Fetch served-model metrics and populate the dashboard stat cards and sidebar
async function loadModelMetrics() {
    try {
        const response = await fetch('/metrics');
        const result = await response.json();
        if (result.status !== 'success') return;

        const best = result.best_model || {};
        const scores = best.scores || {};

        const sideLabel = document.getElementById('sidebar-model');
        if (sideLabel && best.display) sideLabel.innerText = `Model: ${best.display}`;

        const foot = document.getElementById('model-footer');
        if (foot) {
            const rows = (result.stats && result.stats.total_rows)
                ? Number(result.stats.total_rows).toLocaleString('en-GB') + ' records' : 'UK STATS19';
            foot.innerText = `Model: ${best.display || 'served model'} · trained on ${rows}`;
        }

        const accCard = document.getElementById('stat-accuracy');
        if (accCard) {
            const v = scores.Macro_F1 ?? scores['F1-Score'];
            if (v != null) accCard.innerText = `${v}%`;
            const accSub = document.getElementById('stat-accuracy-sub');
            if (accSub && best.display) accSub.innerText = `${best.display} · macro-F1`;
        }

        if (result.stats) {
            const tot = document.getElementById('stat-total');
            if (tot && result.stats.total_rows) tot.innerText = Number(result.stats.total_rows).toLocaleString('en-GB');
            const hs = document.getElementById('stat-hotspots');
            if (hs && result.stats.n_clusters != null) hs.innerText = Number(result.stats.n_clusters).toLocaleString('en-GB');
        }
    } catch (err) {
        console.error('Error loading metrics:', err);
    }
}

// Load UK cities dropdown with real coordinates, auto-fill lat/lng (read-only display)
let UK_CITIES = [];

async function loadCities() {
    const citySelect = document.getElementById('city');
    const latInput = document.getElementById('lat');
    const lngInput = document.getElementById('lng');
    if (!citySelect) return;

    try {
        const response = await fetch('/static/uk_cities.json');
        let cities = await response.json();
        if (!Array.isArray(cities)) throw new Error('bad format');
        cities.sort((a, b) => a.name.localeCompare(b.name));
        UK_CITIES = cities;
    } catch (err) {
        console.error('Could not load uk_cities.json, using fallback:', err);
        UK_CITIES = [
            { name: 'London, England', lat: 51.5099, lng: -0.1181 },
            { name: 'Birmingham, England', lat: 52.4895, lng: -1.8986 },
            { name: 'Manchester, England', lat: 53.484, lng: -2.2446 }
        ];
    }

    citySelect.innerHTML = '';
    UK_CITIES.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = c.name;
        citySelect.appendChild(opt);
    });

    const setCoords = () => {
        const selected = UK_CITIES[parseInt(citySelect.value, 10)];
        if (selected && latInput && lngInput) {
            latInput.value = selected.lat;
            lngInput.value = selected.lng;
        }
    };
    citySelect.addEventListener('change', setCoords);

    // Default to London if present, else first city
    const londonIdx = UK_CITIES.findIndex(c => c.name.startsWith('London'));
    citySelect.value = String(londonIdx >= 0 ? londonIdx : 0);
    setCoords();
}

// ---- Data insights: enlarge a chart card into a readable overlay ----
let CHART_MODAL_BOX = null;
let CHART_MODAL_HOME = null;

function resizeChartIn(box) {
    if (!box || typeof Chart === 'undefined' || typeof Chart.getChart !== 'function') return;
    const canvas = box.querySelector('canvas');
    const chart = canvas ? Chart.getChart(canvas) : null;
    if (chart) chart.resize();
}

function openChartModal(card) {
    const modal = document.getElementById('chart-modal');
    const body = document.getElementById('chart-modal-body');
    const box = card.querySelector('.chart-box');
    if (!modal || !body || !box) return;

    const heading = card.querySelector('h3');
    const title = document.getElementById('chart-modal-title');
    const note = document.getElementById('chart-modal-note');
    if (title) title.innerText = heading ? heading.innerText : 'Chart';
    if (note) note.innerText = card.dataset.explain || '';

    CHART_MODAL_BOX = box;
    CHART_MODAL_HOME = { parent: box.parentNode, next: box.nextSibling };

    body.appendChild(box);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    resizeChartIn(box);

    const close = modal.querySelector('.chart-modal__close');
    if (close) close.focus();
}

function closeChartModal() {
    const modal = document.getElementById('chart-modal');
    if (!modal || modal.hidden) return;
    const box = CHART_MODAL_BOX;
    if (box && CHART_MODAL_HOME) {
        CHART_MODAL_HOME.parent.insertBefore(box, CHART_MODAL_HOME.next);
    }
    modal.hidden = true;
    CHART_MODAL_BOX = null;
    CHART_MODAL_HOME = null;
    document.body.style.overflow = '';
    if (box) resizeChartIn(box);
}

function initChartModal() {
    const modal = document.getElementById('chart-modal');
    if (!modal) return;
    document.querySelectorAll('.chart-card').forEach(card => {
        card.addEventListener('click', () => openChartModal(card));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                openChartModal(card);
            }
        });
    });
    modal.querySelectorAll('[data-close-chart]').forEach(el => {
        el.addEventListener('click', closeChartModal);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeChartModal();
    });
}

// Set live clock and initialize components on window load
window.onload = function() {
    // Restore saved theme, or follow the OS preference on first visit
    let saved = 'light';
    try {
        saved = localStorage.getItem('roadsafe-theme')
            || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } catch (e) {}
    applyTheme(saved === 'dark');

    const dashNav = document.getElementById('nav-dashboard');
    if (dashNav) dashNav.setAttribute('aria-current', 'page');

    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' | ' + now.toLocaleTimeString();
        const timeEl = document.getElementById('current-time');
        if (timeEl) timeEl.innerText = timeStr;
    }
    updateClock();
    setInterval(updateClock, 1000);

    initCharts();
    initMap();
    initChartModal();
    loadModelMetrics();
    loadCities();

    // Keep sidebar state correct when resizing between mobile and desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) {
            const sb = document.getElementById('sidebar');
            const bd = document.getElementById('sidebar-backdrop');
            if (sb) sb.classList.remove('closed');
            if (bd) bd.classList.add('hidden');
        } else {
            closeSidebar();
        }
    });

    // Keep Light and Hour consistent: picking darkness implies night.
    const lightSel = document.getElementById('light');
    const hourInput = document.getElementById('hour');
    if (lightSel && hourInput) {
        lightSel.addEventListener('change', () => {
            const v = lightSel.value;
            const h = parseInt(hourInput.value, 10);
            if (v.startsWith('Dark') && h >= 6 && h < 18) hourInput.value = 22;
            if (v === 'Daylight' && (h < 6 || h >= 18)) hourInput.value = 12;
        });
    }
};