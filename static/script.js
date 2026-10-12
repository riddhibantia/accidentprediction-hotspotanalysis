// Global navigation and active tab management
const tabs = ['dashboard', 'predict', 'hotspots', 'analytics', 'comparison'];
const titles = {
    dashboard: 'Overview Dashboard',
    predict: 'Accident Severity Predictor',
    hotspots: 'Spatial Hotspot Analysis (DBSCAN)',
    analytics: 'Data Insights & Analytics',
    comparison: 'Algorithm Evaluation & Benchmarks'
};

function switchTab(tabId) {
    tabs.forEach(t => {
        const tabEl = document.getElementById(`tab-${t}`);
        const navEl = document.getElementById(`nav-${t}`);
        if (tabEl) tabEl.classList.add('hidden');
        if (navEl) {
            navEl.className = 'w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-slate-400 hover:bg-slate-800 hover:text-white';
        }
    });

    const activeTab = document.getElementById(`tab-${tabId}`);
    const activeNav = document.getElementById(`nav-${tabId}`);
    
    if (activeTab) activeTab.classList.remove('hidden');
    if (activeNav) {
        activeNav.className = 'w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all bg-blue-600 text-white shadow-lg shadow-blue-600/20';
    }

    const titleEl = document.getElementById('page-title');
    if (titleEl && titles[tabId]) {
        titleEl.innerText = titles[tabId];
    }

    // Refresh Leaflet map if hotspot tab is selected
    if (tabId === 'hotspots' && window.mapInstance) {
        setTimeout(() => { window.mapInstance.invalidateSize(); }, 200);
    }
}

// Initialize Overview & Analytics Charts
function initCharts() {
    // Overview Severity Doughnut Chart
    const overviewCtx = document.getElementById('overviewSeverityChart');
    if (overviewCtx) {
        new Chart(overviewCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Slight Injury', 'Serious Injury', 'Fatal Injury'],
                datasets: [{
                    data: [75.2, 19.8, 5.0],
                    backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'],
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
                labels: ['Fine, no high winds', 'Raining, no high winds', 'Fog or mist', 'Snowing', 'Other'],
                datasets: [{
                    label: 'Accidents Count',
                    data: [1020000, 240000, 65000, 35000, 29640],
                    backgroundColor: '#3b82f6',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }

    // Time of Day Chart
    const timeCtx = document.getElementById('timeChart');
    if (timeCtx) {
        new Chart(timeCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM'],
                datasets: [{
                    label: 'Accidents Frequency',
                    data: [25000, 12000, 75000, 210000, 180000, 260000, 310000, 110000],
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.05)',
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
                labels: ['Dry', 'Wet or damp', 'Frost/Ice', 'Snow', 'Flood'],
                datasets: [{
                    data: [950000, 380000, 35000, 15000, 9640],
                    backgroundColor: ['#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { boxWidth: 10 } } }
            }
        });
    }

    // Speed Limit vs High Severity Chart
    const speedCtx = document.getElementById('speedChart');
    if (speedCtx) {
        new Chart(speedCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['20 MPH', '30 MPH', '40 MPH', '50 MPH', '60 MPH', '70 MPH'],
                datasets: [{
                    label: 'High Severity Rate (%)',
                    data: [8.5, 12.1, 15.6, 22.4, 28.9, 34.2],
                    backgroundColor: '#1e3a8a',
                    borderRadius: 6
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
}

// Initialize Leaflet Map for Hotspots
function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    const map = L.map('map').setView([51.5074, -0.1278], 11);
    window.mapInstance = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Dummy high-risk hotspot markers for demonstration
    const hotspots = [
        { lat: 51.515, lng: -0.141, severity: 'fatal', cluster: 'Cluster #101', count: 142 },
        { lat: 51.503, lng: -0.119, severity: 'serious', cluster: 'Cluster #103', count: 98 },
        { lat: 51.520, lng: -0.100, severity: 'fatal', cluster: 'Cluster #107', count: 115 },
        { lat: 51.490, lng: -0.150, severity: 'serious', cluster: 'Cluster #112', count: 88 },
        { lat: 51.530, lng: -0.130, severity: 'serious', cluster: 'Cluster #115', count: 76 }
    ];

    hotspots.forEach(hs => {
        const color = hs.severity === 'fatal' ? '#f43f5e' : '#f59e0b';
        const circle = L.circle([hs.lat, hs.lng], {
            color: color,
            fillColor: color,
            fillOpacity: 0.5,
            radius: hs.count * 3
        }).addTo(map);

        circle.bindPopup(`<b>${hs.cluster}</b><br>Severity: ${hs.severity.toUpperCase()}<br>Accident Density: ${hs.count} cases`);
    });
}

// Filter Map Hotspots (Placeholder logic)
function filterMap(type) {
    console.log("Filtering map by:", type);
    // Can be expanded to filter marker layers dynamically
}

// Handle ML Severity Prediction Form Submission
async function handlePrediction(e) {
    e.preventDefault();
    
    const payload = {
        latitude: parseFloat(document.getElementById('lat').value),
        longitude: parseFloat(document.getElementById('lng').value),
        weather: document.getElementById('weather').value,
        road_surface: document.getElementById('surface').value,
        speed_limit: parseInt(document.getElementById('speed').value),
        algorithm: document.getElementById('algorithm-select').value
    };

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
            
            const slightProb = Math.round(probs['Slight'] || probs['Slight Injury'] || 60);
            const seriousProb = Math.round(probs['Serious'] || probs['Serious Injury'] || 30);
            const fatalProb = Math.round(probs['Fatal'] || probs['Fatal Injury'] || 10);
            const maxProb = Math.max(slightProb, seriousProb, fatalProb);

            let badgeClass = "bg-emerald-100 text-emerald-700";
            if (severity.toLowerCase().includes('fatal')) {
                badgeClass = "bg-rose-100 text-rose-700";
            } else if (severity.toLowerCase().includes('serious')) {
                badgeClass = "bg-amber-100 text-amber-700";
            }

            document.getElementById('prediction-result').classList.remove('hidden');
            document.getElementById('res-severity').innerText = severity + ` (${result.algorithm_used})`;
            document.getElementById('res-confidence').innerText = maxProb + '%';
            document.getElementById('res-cluster').innerText = `Cluster #${result.cluster_id} (DBSCAN)`;
            
            const badge = document.getElementById('badge-severity');
            badge.className = "px-3 py-1 rounded-full text-xs font-semibold uppercase " + badgeClass;
            badge.innerText = severity;

            document.getElementById('prob-slight').innerText = slightProb + '%';
            document.getElementById('bar-slight').style.width = slightProb + '%';

            document.getElementById('prob-serious').innerText = seriousProb + '%';
            document.getElementById('bar-serious').style.width = seriousProb + '%';

            document.getElementById('prob-fatal').innerText = fatalProb + '%';
            document.getElementById('bar-fatal').style.width = fatalProb + '%';

            document.getElementById('prediction-result').scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Prediction error: ' + result.message);
        }
    } catch (error) {
        console.error('Error connecting to Flask backend:', error);
        alert('Could not connect to Flask server. Make sure app.py is running!');
    }
}

// Fetch and render model comparison metrics
async function loadModelMetrics() {
    try {
        const response = await fetch('/metrics');
        const result = await response.json();
        
        if (result.status === 'success') {
            const metrics = result.metrics;
            const tbody = document.getElementById('metrics-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            
            const labels = Object.keys(metrics);
            const accuracies = [];
            
            for (const [modelName, scores] of Object.entries(metrics)) {
                accuracies.push(scores.Accuracy);
                const isBest = modelName.includes('XGBoost');
                
                const row = document.createElement('tr');
                row.className = isBest ? 'bg-blue-50/50 font-semibold' : 'hover:bg-slate-50/50';
                row.innerHTML = `
                    <td class="p-4 flex items-center space-x-2">
                        <span>${modelName}</span>
                        ${isBest ? '<span class="px-2 py-0.5 bg-blue-600 text-white text-[10px] rounded-full">Proposed Hybrid</span>' : ''}
                    </td>
                    <td class="p-4 text-blue-600">${scores.Accuracy}%</td>
                    <td class="p-4">${scores.Precision}%</td>
                    <td class="p-4">${scores.Recall}%</td>
                    <td class="p-4">${scores['F1-Score'] || scores.F1_Score}%</td>
                `;
                tbody.appendChild(row);
            }
            
            // Render Comparison Chart
            const ctx = document.getElementById('comparisonBarChart');
            if (ctx) {
                new Chart(ctx.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Accuracy (%)',
                            data: accuracies,
                            backgroundColor: ['#64748b', '#3b82f6', '#1d4ed8'],
                            borderRadius: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { min: 70, max: 100 } }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Error loading metrics:', err);
    }
}

// Set live clock and initialize components on window load
window.onload = function() {
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
    loadModelMetrics();
};