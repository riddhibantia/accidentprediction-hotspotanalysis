// Global navigation and active tab management
const tabs = ['dashboard', 'analytics', 'predict', 'hotspots'];
const titles = {
    dashboard: 'Overview',
    predict: 'Severity predictor',
    hotspots: 'Hotspot analysis',
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
        setTimeout(() => {
            window.mapInstance.invalidateSize();
            // The map is built while its tab is hidden, so Leaflet's first fit
            // lands on the whole world. Re-apply the country view now it is up.
            if (MAP_NEEDS_FIT) fitHotspotOverview();
        }, 200);
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
let DASH_PROMISE = null;
function getDash() {
    if (DASH) return Promise.resolve(DASH);
    if (!DASH_PROMISE) {
        DASH_PROMISE = fetch('/static/dashboard_data.json')
            .then(r => r.json())
            .then(json => { DASH = json; return json; })
            .catch(err => {
                console.error('dashboard_data.json missing, using demo fallback:', err);
                return null;
            });
    }
    return DASH_PROMISE;
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
                    if (mapBack[label]) { setSeg('weather', mapBack[label]); refreshPredictor(); closeChartModal(); switchTab('predict'); }
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
                    if (mapBack[label]) { setSeg('surface', mapBack[label]); refreshPredictor(); closeChartModal(); switchTab('predict'); }
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
let MAP_NEEDS_FIT = true;      // the map is built inside a hidden tab, so the first fit is deferred
let SEARCH_RING = null;        // ring marking the area the search box found
let SEARCH_ROW = null;         // the ranked row the search box is pointing at
const RISK_COLOR = { fatal: '#b3261e', serious: '#8f5a00', slight: '#12457e' };
const GB_FALLBACK_BOUNDS = [[50.0, -5.6], [56.3, 2.1]];   // Great Britain, used until the areas load

// A Leaflet container inside a display:none tab measures zero, so the opening
// fit has to wait until the tab is actually shown.
function hotspotTabVisible() {
    const tab = document.getElementById('tab-hotspots');
    return !!tab && !tab.classList.contains('hidden');
}

// Default view: every mapped area, i.e. the country as the data covers it.
function fitHotspotOverview() {
    const map = window.mapInstance;
    if (!map) return;
    if (!hotspotTabVisible()) { MAP_NEEDS_FIT = true; return; }
    MAP_NEEDS_FIT = false;
    const home = window.HOTSPOT_HOME;
    if (home && home.pad) map.fitBounds(home.pad(0.06));
    else map.fitBounds(GB_FALLBACK_BOUNDS);
}

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
            window.HOTSPOT_HOME = bounds;
            fitHotspotOverview();
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
        b.dataset.idx = String(i);
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

/* ---------- Area search: name a place, show it on the map ---------- */

// Mapped areas first (they carry the risk numbers), then plain cities so a
// search for somewhere with no hotspot still moves the map.
function hotspotSearchIndex() {
    const entries = [];
    const seen = new Set();
    (window.HOTSPOTS || []).forEach(hs => {
        const label = String(hs.name || '').replace(/^near\s+/i, '').trim();
        if (!label || seen.has(label.toLowerCase())) return;
        seen.add(label.toLowerCase());
        entries.push({ kind: 'area', label: label, name: hs.name || label, lat: hs.lat, lng: hs.lng, hs: hs });
    });
    (UK_CITIES || []).forEach(c => {
        const label = String(c.name || '').trim();
        if (!label || seen.has(label.toLowerCase())) return;
        seen.add(label.toLowerCase());
        entries.push({ kind: 'city', label: label, name: label, lat: c.lat, lng: c.lng });
    });
    return entries;
}

// Exact name first, then names that start with the query, then any that contain it.
function findAreas(q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];
    const hits = [];
    hotspotSearchIndex().forEach(e => {
        const label = e.label.toLowerCase();
        const at = label.indexOf(needle);
        if (at === -1) return;
        hits.push({ e: e, tier: label === needle ? 0 : (at === 0 ? 1 : 2) });
    });
    hits.sort((a, b) => a.tier - b.tier
        || (a.e.kind === b.e.kind ? 0 : (a.e.kind === 'area' ? -1 : 1))
        || a.e.label.length - b.e.label.length);
    return hits.slice(0, 8).map(h => h.e);
}

function setSearchNote(text) {
    const note = document.getElementById('hotspot-search-note');
    if (!note) return;
    note.hidden = !text;
    note.innerText = text || '';
}

function clearAreaSearch(opts) {
    if (SEARCH_RING && window.mapInstance) window.mapInstance.removeLayer(SEARCH_RING);
    SEARCH_RING = null;
    if (SEARCH_ROW) { SEARCH_ROW.classList.remove('is-active'); SEARCH_ROW = null; }
    const clear = document.getElementById('hotspot-clear');
    if (clear) clear.classList.add('hidden');
    setSearchNote('');
    if (!opts || !opts.keepInput) {
        const input = document.getElementById('hotspot-q');
        if (input) input.value = '';
    }
}

function showArea(hit) {
    const map = window.mapInstance;
    if (!map || !hit) return;
    clearAreaSearch({ keepInput: true });
    const clear = document.getElementById('hotspot-clear');
    if (clear) clear.classList.remove('hidden');

    const target = [hit.lat, hit.lng];
    const entry = hit.kind === 'area' ? HOTSPOT_LAYERS.find(x => x.hs === hit.hs) : null;

    // Land on the area, spidering the marker out of its cluster first so its
    // popup is actually open when we get there
    const open = () => {
        if (entry && entry.layer && entry.layer.openPopup) entry.layer.openPopup();
    };
    if (entry && CLUSTER && typeof CLUSTER.zoomToShowLayer === 'function') {
        CLUSTER.zoomToShowLayer(entry.layer, () => {
            map.setView(target, Math.max(map.getZoom(), 12));
            open();
        });
    } else {
        map.setView(target, 12);
        open();
    }

    // A ring marks the spot even while the marker is still clustered
    SEARCH_RING = L.circleMarker(target, {
        radius: 20, color: RISK_COLOR.slight, weight: 2, opacity: 0.9,
        fillColor: RISK_COLOR.slight, fillOpacity: 0.1
    });
    SEARCH_RING.addTo(map);

    // Mark the ranked row when this area is in the top 10
    if (entry && entry.idx != null) {
        const row = document.querySelector('#hotspot-list .hotspot-item[data-idx="' + entry.idx + '"]');
        if (row) {
            row.classList.add('is-active');
            SEARCH_ROW = row;
            if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
        }
    }

    setSearchNote(hit.kind === 'area'
        ? `Showing ${hit.label} — ringed on the map and marked in the list.`
        : `No mapped hotspot in ${hit.label}. The map is centred on the area.`);
    const input = document.getElementById('hotspot-q');
    if (input) input.value = hit.label;
}

function runAreaSearch() {
    const input = document.getElementById('hotspot-q');
    if (!input) return;
    const q = input.value.trim();
    if (!q) { clearAreaSearch(); fitHotspotOverview(); return; }
    const hits = findAreas(q);
    if (!hits.length) {
        clearAreaSearch({ keepInput: true });
        const clear = document.getElementById('hotspot-clear');
        if (clear) clear.classList.remove('hidden');
        setSearchNote(`No area or city matched “${q}”.`);
        return;
    }
    showArea(hits[0]);
}

function refreshAreaSuggestions() {
    const list = document.getElementById('hotspot-suggest');
    const input = document.getElementById('hotspot-q');
    if (!list || !input) return;
    const q = input.value.trim();
    list.innerHTML = '';
    if (q.length < 2) return;
    findAreas(q).forEach(hit => {
        const opt = document.createElement('option');
        opt.value = hit.label;
        opt.label = hit.kind === 'area' ? 'Mapped hotspot' : 'City';
        list.appendChild(opt);
    });
}

function initAreaSearch() {
    const input = document.getElementById('hotspot-q');
    if (!input) return;
    input.addEventListener('input', refreshAreaSuggestions);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runAreaSearch(); }
        else if (e.key === 'Escape') { clearAreaSearch(); fitHotspotOverview(); input.blur(); }
    });
    // `change` fires when a suggestion is picked, but also on blur. Only act on
    // an exact name, so clicking away mid-word does not fling the map.
    input.addEventListener('change', () => {
        const typed = input.value.trim().toLowerCase();
        if (!typed) return;
        if (findAreas(input.value).some(h => h.label.toLowerCase() === typed)) runAreaSearch();
    });
    const clear = document.getElementById('hotspot-clear');
    if (clear) clear.addEventListener('click', () => {
        clearAreaSearch();
        fitHotspotOverview();
        input.focus();
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
    setCoords(lat, lng);
    const input = document.getElementById('city-search');
    if (input) input.value = '';
    const hint = document.getElementById('city-hint');
    if (hint) hint.innerText = 'Scoring the point you picked on the map.';
    switchTab('predict');
    refreshPredictor(0);
}

// ---- Severity predictor: segmented controls, live scoring, comparison ----
const SEG_PREFIX = '.seg-field[data-name="';

function segInput(name) {
    return document.querySelector(SEG_PREFIX + name + '"] input:checked');
}
function segValue(name) {
    const el = segInput(name);
    return el ? el.value : '';
}
function setSeg(name, value) {
    let hit = false;
    document.querySelectorAll(SEG_PREFIX + name + '"] input').forEach(el => {
        const on = el.value === String(value);
        el.checked = on;
        if (on) hit = true;
    });
    return hit;
}

function readFormPayload() {
    const num = (id, dflt) => {
        const el = document.getElementById(id);
        const v = el ? parseFloat(el.value) : NaN;
        return Number.isFinite(v) ? v : dflt;
    };
    const pick = (id) => {
        const el = document.getElementById(id);
        return el && el.value !== '' ? el.value : '';
    };
    return {
        latitude: num('lat', 51.5074),
        longitude: num('lng', -0.1278),
        weather: segValue('weather') || 'Clear',
        road_surface: segValue('surface') || 'Dry',
        speed_limit: parseInt(segValue('speed_limit'), 10) || 30,
        hour: num('hour', 12),
        vehicle_type: pick('vehicle-type'),
        age_band: segValue('age_band'),
        light: segValue('light'),
        road_type: pick('road-type'),
        junction: pick('junction')
    };
}

function validatePayload(p) {
    const hint = document.getElementById('coords-error');
    const bad = !Number.isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90
        || !Number.isFinite(p.longitude) || p.longitude < -180 || p.longitude > 180
        || !Number.isFinite(p.speed_limit) || p.speed_limit < 5 || p.speed_limit > 90;
    if (hint) hint.classList.toggle('hidden', !bad);
    return !bad;
}

let SCORE_TIMER = null;
let SCORE_SEQ = 0;
let PINNED = null;
let CURRENT_ASSESS = null;

function setScoring(on) {
    const panel = document.getElementById('prediction-result');
    const status = document.getElementById('assess-status');
    if (panel) panel.classList.toggle('is-scoring', on);
    if (status) status.classList.toggle('hidden', !on);
}

function showAssessError(message) {
    const panel = document.getElementById('prediction-result');
    if (!panel) return;
    let el = document.getElementById('assess-error');
    if (!el) {
        el = document.createElement('p');
        el.id = 'assess-error';
        el.className = 'field-error';
        el.setAttribute('role', 'alert');
        panel.appendChild(el);
    }
    el.innerText = message;
}

function clearAssessError() {
    const el = document.getElementById('assess-error');
    if (el) el.remove();
}

function scheduleAutoScore(delay) {
    clearTimeout(SCORE_TIMER);
    SCORE_TIMER = setTimeout(runAutoScore, delay == null ? 300 : delay);
}

function runAutoScore() {
    const payload = readFormPayload();
    if (!validatePayload(payload)) return;
    submitPrediction(payload);
}

function setLoading(loading) {
    const runBtn = document.getElementById('run-btn');
    const label = document.getElementById('run-btn-label');
    const icon = document.getElementById('run-btn-icon');
    if (runBtn) runBtn.disabled = loading;
    if (label) label.innerText = loading ? 'Scoring…' : 'Score these conditions';
    if (icon) icon.className = loading
        ? 'fa-solid fa-circle-notch fa-spin'
        : 'fa-solid fa-arrow-right-long';
}

async function handlePrediction(e) {
    if (e) e.preventDefault();
    clearTimeout(SCORE_TIMER);
    const payload = readFormPayload();
    if (!validatePayload(payload)) return;
    setLoading(true);
    try {
        await submitPrediction(payload);
        // An explicit run is the one time we move the page for you
        const panel = document.getElementById('prediction-result');
        if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
        setLoading(false);
    }
}

// Re-read the controls and score again (used by presets, links and the chart jumps)
function refreshPredictor(delay) {
    updateHourReadout();
    updateMoreState();
    scheduleAutoScore(delay);
}

async function submitPrediction(payload) {
    const seq = ++SCORE_SEQ;
    setScoring(true);
    try {
        const response = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (seq !== SCORE_SEQ) return null;
        if (result.status !== 'success') throw new Error(result.message || 'Prediction failed');
        renderAssessment(result, payload);
        return result;
    } catch (error) {
        if (seq === SCORE_SEQ) {
            console.error('Prediction failed:', error);
            showAssessError('Could not score those conditions: ' + (error && error.message ? error.message : error));
        }
        return null;
    } finally {
        if (seq === SCORE_SEQ) setScoring(false);
    }
}

// ---- Rendering the assessment ----
function sevClass(severity) {
    const s = String(severity).toLowerCase();
    if (s.indexOf('fatal') >= 0) return 'fg-fatal';
    if (s.indexOf('serious') >= 0) return 'fg-serious';
    return 'fg-slight';
}

function fmtPct(v) {
    return (Math.round(v * 10) / 10).toFixed(1) + '%';
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function setProb(key, value) {
    const label = document.getElementById('prob-' + key);
    const bar = document.getElementById('bar-' + key);
    if (label) label.innerText = fmtPct(value);
    if (bar) bar.style.width = Math.max(0, Math.min(100, value)) + '%';
}

function renderAssessment(result, payload) {
    clearAssessError();
    const probs = result.probabilities || {};
    const slight = probs['Slight'] ?? probs['Slight Injury'] ?? 0;
    const serious = probs['Serious'] ?? probs['Serious Injury'] ?? 0;
    const fatal = probs['Fatal'] ?? probs['Fatal Injury'] ?? 0;
    const severity = result.predicted_severity || '—';
    const conf = Math.max(slight, serious, fatal);
    const hour = Number.isFinite(result.hour) ? result.hour : Math.round(payload.hour);

    const verdict = document.getElementById('res-severity');
    if (verdict) {
        verdict.innerText = severity;
        verdict.className = 'assess-verdict ' + sevClass(severity);
    }
    const confEl = document.getElementById('res-confidence');
    if (confEl) confEl.innerText = fmtPct(conf);

    const sevBadge = document.getElementById('badge-severity');
    if (sevBadge) {
        const cls = sevClass(severity);
        sevBadge.className = 'badge ' + (cls === 'fg-fatal' ? 'badge-fatal'
            : cls === 'fg-serious' ? 'badge-serious' : 'badge-slight');
        sevBadge.innerText = severity;
    }
    const timeBadge = document.getElementById('badge-time');
    if (timeBadge) {
        const night = (hour < 6 || hour >= 18);
        timeBadge.className = 'badge badge-neutral';
        timeBadge.innerText = String(hour).padStart(2, '0') + ':00 · ' + (night ? 'night' : 'day');
    }

    setProb('slight', slight);
    setProb('serious', serious);
    setProb('fatal', fatal);

    const algo = document.getElementById('res-algo');
    if (algo) algo.innerText = 'Scored by ' + (result.algorithm_used || 'the served model') + ', the fatal-first pick.';

    renderContext(result.context || [], result.context_baseline_pct);

    const insideHotspot = (result.cluster_id ?? -1) >= 0;
    const hsName = result.hotspot || (insideHotspot ? 'Cluster #' + result.cluster_id : 'Open road');
    const cluster = document.getElementById('res-cluster');
    if (cluster) cluster.innerText = hsName;
    const hsSub = document.getElementById('res-cluster-sub');
    if (hsSub) {
        if (insideHotspot) {
            const rank = result.hotspot_rank
                ? 'Rank #' + result.hotspot_rank + ' of ' + result.n_hotspots
                : 'Cluster #' + result.cluster_id;
            const sev = (result.hotspot_high_sev_pct != null)
                ? ' · ' + result.hotspot_high_sev_pct + '% serious or fatal' : '';
            hsSub.innerText = rank + ' · ' + Number(result.hotspot_count).toLocaleString('en-GB') + ' collisions' + sev;
        } else {
            hsSub.innerText = 'Not inside a mapped accident hotspot.';
        }
    }

    LAST_PREDICT = {
        lat: payload.latitude, lng: payload.longitude,
        severity: severity,
        hotspot: insideHotspot
            ? 'Hotspot: ' + hsName + (result.hotspot_rank ? ' (rank #' + result.hotspot_rank + ')' : '')
            : 'Open road (no mapped hotspot)',
        conf: Math.round(conf)
    };

    CURRENT_ASSESS = {
        label: describePayload(payload),
        probs: { slight: slight, serious: serious, fatal: fatal }
    };
    renderCompare();
}

function renderContext(rows, baseline) {
    const host = document.getElementById('context-list');
    const baseEl = document.getElementById('context-base');
    if (!host) return;
    if (!rows.length) {
        host.innerHTML = '<p class="t-caption fg-muted" style="margin:0">No record breakdown for these values.</p>';
        if (baseEl) baseEl.innerText = '';
        return;
    }
    const base = Number.isFinite(baseline) ? baseline : null;
    if (baseEl) baseEl.innerText = base == null ? '' : 'vs ' + base + '% overall';
    const scale = Math.max.apply(null, rows.map(r => r.hs_pct).concat(base == null ? [] : [base])) * 1.12 || 1;
    host.innerHTML = rows.map(r => {
        const d = base == null ? null : Math.round((r.hs_pct - base) * 10) / 10;
        const cls = d == null || Math.abs(d) <= 0.05 ? 'flat' : (d > 0 ? 'up' : 'down');
        const delta = d == null ? ''
            : '<span class="ctx__delta ' + cls + '">' + (d > 0 ? '+' : '') + d.toFixed(1) + '</span>';
        const fill = Math.max(2, Math.min(100, r.hs_pct / scale * 100));
        const mark = base == null ? ''
            : '<div class="ctx__base" style="left:' + (base / scale * 100).toFixed(1) + '%"></div>';
        return '<div class="ctx">'
            + '<div class="ctx__name">' + esc(r.label) + ' — <b>' + esc(r.display) + '</b></div>'
            + '<div class="ctx__val">' + r.hs_pct.toFixed(1) + '%' + delta + '</div>'
            + '<div class="ctx__track"><div class="ctx__fill" style="width:' + fill.toFixed(1) + '%"></div>' + mark + '</div>'
            + '</div>';
    }).join('');
}

function describePayload(p) {
    const lightWord = { 'Daylight': 'daylight', 'Dark (lit)': 'lit', 'Dark (unlit)': 'unlit' }[p.light] || 'unknown light';
    return String(Math.round(p.hour)).padStart(2, '0') + ':00 · ' + lightWord
        + (p.road_type ? ' · ' + p.road_type : '');
}

function renderCompare() {
    const box = document.getElementById('compare-block');
    if (!box) return;
    if (!PINNED || !CURRENT_ASSESS) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    const rows = [['Slight', 'slight'], ['Serious', 'serious'], ['Fatal', 'fatal']].map(pair => {
        const a = PINNED.probs[pair[1]];
        const b = CURRENT_ASSESS.probs[pair[1]];
        const d = Math.round((b - a) * 10) / 10;
        const cls = Math.abs(d) <= 0.05 ? 'flat' : (d > 0 ? 'up' : 'down');
        return '<div class="compare-row">'
            + '<span class="t-label fg-ink">' + pair[0] + '</span>'
            + '<span class="t-caption fg-muted num">' + fmtPct(a) + ' → <b class="fg-ink">' + fmtPct(b) + '</b></span>'
            + '<span class="compare-delta ' + cls + ' num">' + (d > 0 ? '+' : '') + d.toFixed(1) + '</span>'
            + '</div>';
    }).join('');
    box.innerHTML = '<div class="section-head" style="margin-bottom:10px">'
        + '<p class="t-label-strong fg-ink" style="margin:0">Against pinned</p>'
        + '<button type="button" class="link-btn t-caption" id="clear-pin">Clear</button>'
        + '</div>'
        + '<p class="t-caption fg-muted" style="margin:0 0 10px">' + esc(PINNED.label) + '</p>'
        + rows;
    box.classList.remove('hidden');
    const clear = document.getElementById('clear-pin');
    if (clear) clear.addEventListener('click', clearPin);
}

function pinScenario() {
    if (PINNED) {
        clearPin();
        return;
    }
    if (!CURRENT_ASSESS) return;
    PINNED = { label: CURRENT_ASSESS.label, probs: Object.assign({}, CURRENT_ASSESS.probs) };
    const label = document.getElementById('pin-label');
    if (label) label.innerText = 'Unpin';
    renderCompare();
}

function clearPin() {
    PINNED = null;
    const label = document.getElementById('pin-label');
    if (label) label.innerText = 'Pin to compare';
    renderCompare();
}

async function copyLink() {
    const payload = readFormPayload();
    const params = new URLSearchParams();
    params.set('lat', payload.latitude);
    params.set('lng', payload.longitude);
    params.set('hour', payload.hour);
    ['weather', 'road_surface', 'light', 'age_band', 'speed_limit', 'vehicle_type', 'road_type', 'junction']
        .forEach(k => { if (payload[k] !== undefined && payload[k] !== '') params.set(k, payload[k]); });
    const url = window.location.origin + window.location.pathname + '?' + params.toString() + '#predict';
    const label = document.getElementById('share-label');
    let ok = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            ok = true;
        }
    } catch (e) { ok = false; }
    if (!ok) {
        try {
            const field = document.createElement('input');
            field.value = url;
            document.body.appendChild(field);
            field.select();
            ok = document.execCommand('copy');
            field.remove();
        } catch (e) { ok = false; }
    }
    if (label) {
        label.innerText = ok ? 'Link copied' : 'Copy failed';
        setTimeout(() => { label.innerText = 'Copy link'; }, 1800);
    }
}

// ---- Scenario presets ----
const PRESETS = {
    rush: {
        city: 'London, England', lat: 51.5074, lng: -0.1278, hour: 8,
        light: 'Daylight', weather: 'Clear', surface: 'Dry', speed_limit: '30',
        vehicle: 'Car', age: 'Adult (26-55)', road: 'Single carriageway', junction: 'T or staggered junction'
    },
    motorway: {
        city: 'Birmingham, England', lat: 52.4862, lng: -1.8904, hour: 17,
        light: 'Daylight', weather: 'Rain', surface: 'Wet or damp', speed_limit: '70',
        vehicle: 'Car', age: 'Adult (26-55)', road: 'Dual carriageway', junction: 'Not at junction'
    },
    rural: {
        city: 'Inverness, Scotland', lat: 57.4778, lng: -4.2247, hour: 22,
        light: 'Dark (unlit)', weather: 'Clear', surface: 'Dry', speed_limit: '60',
        vehicle: 'Car', age: 'Adult (26-55)', road: 'Single carriageway', junction: 'Not at junction'
    },
    weekend: {
        city: 'Manchester, England', lat: 53.4808, lng: -2.2426, hour: 1,
        light: 'Dark (lit)', weather: 'Clear', surface: 'Dry', speed_limit: '20',
        vehicle: 'Taxi', age: 'Young (16-25)', road: 'One-way / Slip road', junction: 'Crossroads'
    }
};

let ACTIVE_PRESET = null;

function markPresetButtons() {
    document.querySelectorAll('#preset-row .preset').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.preset === ACTIVE_PRESET);
    });
}

function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    setCoords(p.lat, p.lng);
    const city = document.getElementById('city-search');
    if (city) city.value = p.city;
    const hint = document.getElementById('city-hint');
    if (hint) hint.innerText = p.city + ' · ' + p.lat.toFixed(3) + ', ' + p.lng.toFixed(3);
    const hourEl = document.getElementById('hour');
    if (hourEl) hourEl.value = p.hour;
    setSeg('light', p.light);
    setSeg('weather', p.weather);
    setSeg('surface', p.surface);
    setSeg('speed_limit', p.speed_limit);
    setSeg('age_band', p.age);
    const veh = document.getElementById('vehicle-type');
    if (veh) veh.value = p.vehicle;
    const road = document.getElementById('road-type');
    if (road) road.value = p.road;
    const junction = document.getElementById('junction');
    if (junction) junction.value = p.junction;
    ACTIVE_PRESET = name;
    markPresetButtons();
    refreshPredictor(0);
}

// ---- Control plumbing ----
function setCoords(lat, lng) {
    const a = document.getElementById('lat');
    const b = document.getElementById('lng');
    if (a) a.value = Number(lat).toFixed(4);
    if (b) b.value = Number(lng).toFixed(4);
}

function matchCity() {
    const input = document.getElementById('city-search');
    const hint = document.getElementById('city-hint');
    if (!input) return;
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    const hit = UK_CITIES.find(c => c.name.toLowerCase() === q)
        || UK_CITIES.find(c => c.name.toLowerCase().indexOf(q) === 0)
        || UK_CITIES.find(c => c.name.toLowerCase().indexOf(q) >= 0);
    if (hit) {
        setCoords(hit.lat, hit.lng);
        input.value = hit.name;
        if (hint) hint.innerText = hit.name + ' · ' + hit.lat.toFixed(3) + ', ' + hit.lng.toFixed(3);
    } else if (hint) {
        hint.innerText = 'No match — coordinates left unchanged.';
    }
}

function useMyLocation() {
    const hint = document.getElementById('city-hint');
    if (!navigator.geolocation) {
        if (hint) hint.innerText = 'Location is not available in this browser.';
        return;
    }
    if (hint) hint.innerText = 'Locating…';
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            setCoords(pos.coords.latitude, pos.coords.longitude);
            const input = document.getElementById('city-search');
            if (input) input.value = '';
            if (hint) hint.innerText = 'Using your current position.';
            refreshPredictor(0);
        },
        function () {
            if (hint) hint.innerText = 'Could not get your location — coordinates unchanged.';
        }
    );
}

function updateHourReadout() {
    const el = document.getElementById('hour');
    if (!el) return;
    const parsed = parseInt(el.value, 10);
    const hour = Number.isFinite(parsed) ? parsed : 12;
    const period = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'night';
    const read = document.getElementById('hour-read');
    if (read) read.innerText = String(hour).padStart(2, '0') + ':00 · ' + period;
    const mark = document.getElementById('day-arc-mark');
    if (mark) mark.style.left = (hour / 23 * 100) + '%';

    // Hour and light stay consistent; lit versus unlit stays the user's call.
    const cur = segInput('light');
    if (!cur) return;
    const night = (hour < 6 || hour >= 18);
    if (night && cur.value === 'Daylight') setSeg('light', 'Dark (lit)');
    else if (!night && cur.value.indexOf('Dark') === 0) setSeg('light', 'Daylight');
}

function updateMoreState() {
    const el = document.getElementById('more-state');
    if (!el) return;
    const shortOf = (id) => {
        const sel = document.getElementById(id);
        if (!sel) return '';
        const opt = sel.options[sel.selectedIndex];
        return opt ? (opt.dataset.short || opt.textContent) : '';
    };
    el.innerText = [shortOf('vehicle-type'), segValue('age_band'), shortOf('road-type'), shortOf('junction')]
        .filter(Boolean).join(' · ');
}

function onPredictInput(e) {
    const t = e && e.target;
    if (t && t.type === 'radio' && t.name === 'light') {
        const hourEl = document.getElementById('hour');
        const h = hourEl ? parseInt(hourEl.value, 10) : 12;
        if (hourEl && t.value.indexOf('Dark') === 0 && h >= 6 && h < 18) hourEl.value = 22;
        if (hourEl && t.value === 'Daylight' && (h < 6 || h >= 18)) hourEl.value = 12;
    }
    ACTIVE_PRESET = null;
    markPresetButtons();
    refreshPredictor();
}

function applyQueryState() {
    if (!window.location.search) return;
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    const has = (k) => params.has(k) && params.get(k) !== '';
    if (has('lat') && has('lng')) setCoords(parseFloat(params.get('lat')), parseFloat(params.get('lng')));
    if (has('hour')) {
        const el = document.getElementById('hour');
        if (el) el.value = params.get('hour');
    }
    [['weather', 'weather'], ['road_surface', 'surface'], ['light', 'light'],
     ['age_band', 'age_band'], ['speed_limit', 'speed_limit']].forEach(pair => {
        if (has(pair[0])) setSeg(pair[1], params.get(pair[0]));
    });
    [['vehicle_type', 'vehicle-type'], ['road_type', 'road-type'], ['junction', 'junction']].forEach(pair => {
        if (!has(pair[0])) return;
        const el = document.getElementById(pair[1]);
        if (el) el.value = params.get(pair[0]);
    });
}

function initPredictor() {
    const form = document.getElementById('prediction-form');
    if (form) {
        form.addEventListener('input', onPredictInput);
        form.addEventListener('change', onPredictInput);
    }
    const presetRow = document.getElementById('preset-row');
    if (presetRow) {
        presetRow.addEventListener('click', (e) => {
            const btn = e.target.closest ? e.target.closest('.preset') : null;
            if (btn && btn.dataset.preset) applyPreset(btn.dataset.preset);
        });
    }
    const loc = document.getElementById('use-location');
    if (loc) loc.addEventListener('click', useMyLocation);
    const pin = document.getElementById('pin-btn');
    if (pin) pin.addEventListener('click', pinScenario);
    const share = document.getElementById('share-btn');
    if (share) share.addEventListener('click', copyLink);

    applyQueryState();
    updateHourReadout();
    updateMoreState();
    markPresetButtons();
    scheduleAutoScore(0);
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

// Load UK cities into the searchable datalist, fill coordinates from a match
let UK_CITIES = [];

async function loadCities() {
    const input = document.getElementById('city-search');
    const list = document.getElementById('city-list');
    if (!input) return;

    try {
        const response = await fetch('/static/uk_cities.json');
        const cities = await response.json();
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

    if (list) {
        list.innerHTML = '';
        UK_CITIES.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            list.appendChild(opt);
        });
    }

    input.addEventListener('change', matchCity);

    if (!input.value) {
        const london = UK_CITIES.find(c => c.name.indexOf('London') === 0) || UK_CITIES[0];
        if (london) {
            input.value = london.name;
            setCoords(london.lat, london.lng);
            const hint = document.getElementById('city-hint');
            if (hint) hint.innerText = london.name + ' · ' + london.lat.toFixed(3) + ', ' + london.lng.toFixed(3);
        }
    }
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

// ---- Landing: the dial is real data, the copy cycles, both can be stilled ----
const LANDING_PHRASES = ['hour by hour', 'after dark', 'on rural roads', 'in the wet'];
let LANDING_CYCLE = null;

function startHeadlineCycle() {
    const host = document.getElementById('landing-cycle');
    if (!host) return;
    let i = 0;
    const make = (text) => {
        const span = document.createElement('span');
        span.className = 'landing__cycle-word is-in';
        span.innerText = text;
        return span;
    };
    host.innerHTML = '';
    host.appendChild(make(LANDING_PHRASES[0]));
    LANDING_CYCLE = setInterval(() => {
        const landing = document.getElementById('landing');
        if (!landing || landing.hidden) { clearInterval(LANDING_CYCLE); LANDING_CYCLE = null; return; }
        i = (i + 1) % LANDING_PHRASES.length;
        const old = host.firstElementChild;
        if (old) {
            old.classList.remove('is-in');
            old.classList.add('is-out');
            setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 460);
        }
        host.appendChild(make(LANDING_PHRASES[i]));
    }, 3400);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k]));
    return el;
}

function polarPoint(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx, cy, r, startDeg, endDeg) {
    const a = polarPoint(cx, cy, r, startDeg);
    const b = polarPoint(cx, cy, r, endDeg);
    const large = (endDeg - startDeg) > 180 ? 1 : 0;
    return 'M ' + a[0].toFixed(2) + ' ' + a[1].toFixed(2)
        + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + b[0].toFixed(2) + ' ' + b[1].toFixed(2);
}

// Three-hour windows, matching the bins the pipeline builds
const DIAL_BINS = [
    ['12 AM', '00:00–03:00'], ['3 AM', '03:00–06:00'], ['6 AM', '06:00–09:00'], ['9 AM', '09:00–12:00'],
    ['12 PM', '12:00–15:00'], ['3 PM', '15:00–18:00'], ['6 PM', '18:00–21:00'], ['9 PM', '21:00–24:00']
];
const DIAL_TIER = ['#5fb98a', '#d7a154', '#e2796f'];

function drawIn(path, index) {
    if (typeof path.getTotalLength !== 'function' || typeof requestAnimationFrame !== 'function') return;
    let len = 0;
    try { len = path.getTotalLength(); } catch (e) { return; }
    if (!len) return;
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    path.style.transition = 'stroke-dashoffset .9s ease ' + (index * 70) + 'ms';
    requestAnimationFrame(() => { path.style.strokeDashoffset = 0; });
}

function renderLandingDial(data) {
    const svg = document.getElementById('landing-dial');
    if (!svg) return;
    Array.prototype.slice.call(svg.querySelectorAll('g')).forEach(node => node.remove());
    const g = svgEl('g', {});
    svg.appendChild(g);

    const cx = 160, cy = 160, rInner = 97, wMin = 10, wMax = 33;
    const hourSev = (data && data.hour_severity) ? data.hour_severity : null;
    const values = DIAL_BINS.map(bin => {
        const s = hourSev ? hourSev[bin[0]] : null;
        return s ? (Number(s.Serious) || 0) + (Number(s.Fatal) || 0) : 0;
    });
    const peak = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
    const lo = Math.min.apply(null, values);
    const hi = Math.max.apply(null, values);
    const span = (hi - lo) || 1;

    g.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: rInner + wMax / 2, fill: 'none',
        stroke: '#1d242c', 'stroke-width': wMax
    }));

    const slot = 360 / DIAL_BINS.length;
    values.forEach((v, i) => {
        const t = (v - lo) / span;
        const weight = wMin + (wMax - wMin) * t;
        const tier = t > 0.66 ? 2 : (t > 0.33 ? 1 : 0);
        const path = svgEl('path', {
            d: arcPath(cx, cy, rInner + weight / 2, i * slot + 2.5, (i + 1) * slot - 2.5),
            fill: 'none', stroke: DIAL_TIER[tier], 'stroke-width': weight, 'stroke-linecap': 'butt'
        });
        g.appendChild(path);
        drawIn(path, i);
    });

    // 24 hour ticks, the current one picked out
    const nowHour = new Date().getHours();
    for (let h = 0; h < 24; h++) {
        const major = h % 3 === 0;
        const a = polarPoint(cx, cy, major ? 84 : 87, h * 15);
        const b = polarPoint(cx, cy, 76, h * 15);
        g.appendChild(svgEl('line', {
            x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1),
            stroke: h === nowHour ? '#9cc6ee' : '#39424c',
            'stroke-width': h === nowHour ? 2.4 : (major ? 1.4 : 1)
        }));
    }

    // A slow sweep, like a clock hand
    const sweep = svgEl('line', {
        x1: cx, y1: cy, x2: cx, y2: cy - 74,
        stroke: '#6ba3dd', 'stroke-width': 1.4, opacity: 0.5, 'stroke-linecap': 'round',
        'class': 'dial-sweep'
    });
    g.appendChild(sweep);

    const centre = (offsetY, text, size, fill, weight) => {
        const t = svgEl('text', {
            x: cx, y: cy + offsetY, 'text-anchor': 'middle', fill: fill,
            'font-size': size, 'font-family': 'Inter, system-ui, sans-serif',
            'font-weight': weight || 400,
            style: 'font-variant-numeric: tabular-nums lining-nums'
        });
        t.textContent = text;
        g.appendChild(t);
    };
    centre(-42, 'PEAK WINDOW', 10, '#7d8894');
    centre(-22, DIAL_BINS[peak][1], 13, '#cdd5dd');
    centre(10, values[peak].toFixed(1) + '%', 32, '#ffffff', 600);
    centre(28, 'serious or fatal', 10.5, '#98a2ad');

    const cap = document.getElementById('landing-dial-cap');
    if (cap && values[peak] && data && data.totals) {
        cap.innerText = 'Peak ' + DIAL_BINS[peak][1] + ' · ' + values[peak].toFixed(1)
            + '% serious or fatal, against ' + data.totals.high_sev_pct + '% overall';
    }
}

function dismissLanding(instant) {
    const landing = document.getElementById('landing');
    if (!landing || landing.hidden) return;
    if (LANDING_CYCLE) { clearInterval(LANDING_CYCLE); LANDING_CYCLE = null; }
    const finish = () => {
        landing.hidden = true;
        landing.classList.remove('is-leaving');
        if (window.mapInstance && window.mapInstance.invalidateSize) {
            setTimeout(() => window.mapInstance.invalidateSize(), 60);
        }
        const nav = document.getElementById('nav-dashboard');
        if (nav) nav.focus();
    };
    if (instant) { finish(); return; }
    landing.classList.add('is-leaving');
    setTimeout(finish, 460);
}

function initLanding() {
    const landing = document.getElementById('landing');
    if (!landing) return;
    const startBtn = document.getElementById('landing-start');
    const skipBtn = document.getElementById('landing-skip');

    // Shown on every load, so a refresh always starts here
    landing.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { dismissLanding(); return; }
        if (e.key !== 'Tab') return;
        const focusables = Array.prototype.slice.call(landing.querySelectorAll('button'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    if (startBtn) startBtn.addEventListener('click', () => dismissLanding());
    if (skipBtn) skipBtn.addEventListener('click', () => dismissLanding());

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) startHeadlineCycle();
    if (startBtn) startBtn.focus();

    getDash().then(data => renderLandingDial(data));
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

    initLanding();
    initCharts();
    initMap();
    initChartModal();
    initAreaSearch();
    loadModelMetrics();
    // The predictor needs the city list before it can apply a shared link
    loadCities().then(initPredictor);

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
};