"""Flask backend for RoadSafe Analytics (pipeline v3: full STATS19 features, leak-free)."""
import os
import json
import joblib
import numpy as np
import pandas as pd
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)


def _load(name):
    return joblib.load(name) if os.path.exists(name) else None


models_dict = {
    'xgboost': _load('model.pkl'),
    'random_forest': _load('model_rf.pkl'),
    'logistic_regression': _load('model_lr.pkl'),
}
severity_encoder = _load('severity_encoder.pkl')
preprocessor = _load('preprocessor.pkl')
spatial = _load('spatial.pkl')
features_meta = {}
if os.path.exists('model_features.json'):
    try:
        with open('model_features.json') as f:
            features_meta = json.load(f)
    except Exception:
        features_meta = {}
DEFAULTS = features_meta.get('defaults', {})

DISPLAY_TO_KEY = {
    'Logistic Regression': 'logistic_regression',
    'Random Forest': 'random_forest',
    'XGBoost Classifier': 'xgboost',
}
KEY_TO_DISPLAY = {v: k for k, v in DISPLAY_TO_KEY.items()}

# Fatal-first selection: a model must be within this many macro-F1 points of the
# best to be considered, so a weak model can't win on fatal recall alone.
FATAL_FIRST_MACRO_GUARD = 1.0

WX_NORM = {'Clear': 'Fine no high winds', 'Rain': 'Raining no high winds',
           'Fog': 'Fog or mist', 'Snow': 'Snowing', 'Storm': 'Raining no high winds',
           'Fine no high winds': 'Fine no high winds',
           'Raining no high winds': 'Raining no high winds',
           'Fog or mist': 'Fog or mist', 'Snowing': 'Snowing'}
# UI surface value -> training label (values are already canonical)
RS_NORM = {'Dry': 'Dry', 'Wet or damp': 'Wet or damp',
           'Frost or ice': 'Frost or ice', 'Snow': 'Snow'}
# UI groups -> representative training codes (most common code in group)
VEH_NORM = {'Car': '9', 'Van': '19', 'Motorcycle': '3', 'Pedal cycle': '1',
            'Bus/Coach': '11', 'Taxi': '8', 'HGV': '21', 'Other': '90'}
AGE_NORM = {'Young (16-25)': '5', 'Adult (26-55)': '6', 'Older (56+)': '9',
            'Unknown': '-1'}
LIGHT_NORM = {'Daylight': '1', 'Dark (lit)': '4', 'Dark (unlit)': '6',
              'Unknown': '7'}
ROAD_NORM = {'Single carriageway': '6', 'Dual carriageway': '3', 'Roundabout': '1',
             'One-way / Slip road': '2', 'Unknown': '9'}
JUNC_NORM = {
    'Not at junction': '0',              # not at, or within 20 m of, a junction
    'T or staggered junction': '13',
    'Crossroads': '16',
    'More than 4 arms': '18',
    'Private drive or entrance': '17',
    'Other junction': '19',
}


def get_best_model():
    """Fatal-first selection.

    Keep every model within FATAL_FIRST_MACRO_GUARD of the best macro-F1, then
    serve the one with the highest Fatal recall (tie-break: macro-F1, then
    weighted F1). On the current metrics that is XGBoost.
    """
    fallback = ('xgboost', 'XGBoost Classifier', {})
    if not os.path.exists('model_metrics.json'):
        return fallback
    try:
        with open('model_metrics.json') as f:
            data = json.load(f)
    except Exception:
        return fallback
    rows = []
    for display, scores in data.items():
        if not isinstance(scores, dict):
            continue
        key = DISPLAY_TO_KEY.get(display)
        if key is None or models_dict.get(key) is None:
            continue
        try:
            macro = float(scores.get('Macro_F1', -1))
            fatal = float(scores.get('Fatal_Recall', -1))
            w = float(scores.get('F1-Score', scores.get('F1_Score', -1)))
        except (TypeError, ValueError):
            continue
        rows.append((key, display, scores, macro, fatal, w))
    if not rows:
        for k in ('xgboost', 'random_forest', 'logistic_regression'):
            if models_dict.get(k) is not None:
                return k, KEY_TO_DISPLAY.get(k, k), {}
        return fallback
    best_macro = max(r[3] for r in rows)
    eligible = [r for r in rows if r[3] >= best_macro - FATAL_FIRST_MACRO_GUARD]
    best = max(eligible, key=lambda r: (r[4], r[3], r[5]))
    return best[0], best[1], best[2]


def _project_km(latlon, lat0):
    """Same equirectangular projection used in training (degrees -> km)."""
    ll = np.asarray(latlon, dtype=float)
    lat, lon = ll[..., 0], ll[..., 1]
    return np.stack([lon * 111.320 * np.cos(np.radians(lat0)), lat * 110.574], axis=-1)


def spatial_row(lat, lon):
    if spatial is None or len(spatial.get('centroids', [])) == 0:
        return 0.0, 0.0, 1, -1
    c = np.asarray(spatial['centroids'], dtype=float)
    eps = float(spatial.get('eps', 1.5))
    lat0 = float(spatial.get('lat0', 54.0))
    d = np.sqrt(((_project_km(np.array([lat, lon]), lat0) - _project_km(c, lat0)) ** 2).sum(axis=1))
    j = int(d.argmin())
    best = float(d[j])
    if best <= eps:
        return best, float(spatial['sizes'][j]), 0, j
    return best, 0.0, 1, -1


_HOTSPOT_LOOKUP = None


def hotspot_lookup():
    """cluster_id -> hotspot record from static/dashboard_data.json (cached)."""
    global _HOTSPOT_LOOKUP
    if _HOTSPOT_LOOKUP is None:
        _HOTSPOT_LOOKUP = {}
        try:
            with open('static/dashboard_data.json') as f:
                data = json.load(f)
            for h in data.get('hotspots', []):
                if h.get('cluster_id') is not None:
                    _HOTSPOT_LOOKUP[int(h['cluster_id'])] = h
        except Exception:
            _HOTSPOT_LOOKUP = {}
    return _HOTSPOT_LOOKUP


def _cat(col, value):
    v = str(value).strip() if value is not None else ''
    if v and v.lower() != 'none':
        return v
    return DEFAULTS.get(col, 'Unknown')


_CONDITION_RISK = None


def condition_risk_table():
    """Observed serious-or-fatal rate per condition value, from the console data.

    Written by build_dashboard_data.build_condition_risk() and keyed by the same
    values build_model_frame() puts in the model row.
    """
    global _CONDITION_RISK
    if _CONDITION_RISK is None:
        try:
            with open('static/dashboard_data.json') as f:
                _CONDITION_RISK = json.load(f).get('condition_risk') or {}
        except Exception:
            _CONDITION_RISK = {}
    return _CONDITION_RISK


# Fields the predictor can send, in the order the panel shows them:
# (condition_risk key, field label, model-row column)
CONDITION_ROWS = [
    ('weather', 'Weather', 'Weather'),
    ('surface', 'Road surface', 'Road_Surface'),
    ('light', 'Light', 'Light'),
    ('road_type', 'Road type', 'Road_Type'),
    ('junction', 'Junction', 'Junction_Detail'),
    ('vehicle', 'Vehicle', 'Veh_Type'),
    ('age_band', 'Driver age', 'Driver_AgeBand'),
    ('speed', 'Speed limit', 'Speed_limit'),
]

# Only rows whose model value is a bare code need a readable label; the rest
# (weather, surface, speed, vehicle groups) already read well.
CONDITION_DISPLAY = {
    'light': {'1': 'Daylight', '4': 'Dark \u2014 street lights lit',
              '5': 'Dark \u2014 unlit', '6': 'Dark \u2014 unlit', '7': 'Unknown'},
    'road_type': {'1': 'Roundabout', '2': 'One-way / slip road',
                  '3': 'Dual carriageway', '6': 'Single carriageway',
                  '7': 'Slip road', '9': 'Unknown'},
    'junction': {'0': 'Not at junction', '13': 'T or staggered junction',
                 '16': 'Crossroads', '17': 'Private drive or entrance',
                 '18': 'More than 4 arms', '19': 'Other junction'},
    'age_band': {'5': 'Young (16\u201325)', '6': 'Adult (26\u201355)',
                 '9': 'Older (56+)', '-1': 'Unknown'},
}


def _speed_key(v):
    try:
        return str(int(float(v)))
    except (TypeError, ValueError):
        return ''


def _vehicle_group(code):
    """Veh_Type code -> the group label the console and the data table use."""
    for name, c in VEH_NORM.items():
        if c == str(code):
            return name
    return ''


def condition_context(row):
    """How often each of this payload's conditions was serious or fatal.

    Returns (rows, baseline_pct). Univariate context only - it says how these
    conditions behave across every record, not why this prediction came out so.
    """
    table = condition_risk_table()
    baseline = table.get('baseline_high_sev_pct')
    rows = []
    for key, label, column in CONDITION_ROWS:
        raw = row.get(column)
        if raw in (None, ''):
            continue
        if key == 'vehicle':
            value = _vehicle_group(raw)
        elif key == 'speed':
            value = _speed_key(raw)
        else:
            value = str(raw).strip()
        stats = (table.get(key) or {}).get(value) if value else None
        if not stats:
            continue
        rows.append({
            'field': key,
            'label': label,
            'display': CONDITION_DISPLAY.get(key, {}).get(value) or value,
            'n': stats['n'],
            'hs_pct': stats['hs_pct'],
        })
    return rows, baseline


def build_model_frame(payload):
    try:
        lat = float(payload.get('latitude', 51.5074))
        lon = float(payload.get('longitude', -0.1278))
        speed = float(payload.get('speed_limit', 30))
    except (TypeError, ValueError):
        raise ValueError('latitude, longitude and speed_limit must be numbers')
    if not -90 <= lat <= 90:
        raise ValueError('latitude must be -90..90, got %r' % (payload.get('latitude'),))
    if not -180 <= lon <= 180:
        raise ValueError('longitude must be -180..180, got %r' % (payload.get('longitude'),))
    if not 5 <= speed <= 90:
        raise ValueError('speed_limit must be 5..90 mph, got %r' % (payload.get('speed_limit'),))
    if payload.get('hour') not in (None, ''):
        try:
            hour = int(float(payload.get('hour')))
        except (TypeError, ValueError):
            raise ValueError('hour must be a number 0-23, got %r' % (payload.get('hour'),))
        if not 0 <= hour <= 23:
            raise ValueError('hour must be 0-23, got %s' % (payload.get('hour'),))
    else:  # backward compat with Day/Night select
        raw_dn = payload.get('day_night', payload.get('time_of_day', 'Day'))
        hour = 22 if str(raw_dn).strip().lower().startswith('night') else 12
    is_night = 1 if (hour < 6 or hour >= 18) else 0
    dist, size, noise, cluster_id = spatial_row(lat, lon)
    row = {
        'Latitude': lat, 'Longitude': lon, 'Speed_limit': speed,
        'Is_Night': is_night,
        'Hour_sin': float(np.sin(2 * np.pi * hour / 24)),
        'Hour_cos': float(np.cos(2 * np.pi * hour / 24)),
        'hotspot_dist': dist, 'hotspot_size': size, 'is_noise': noise,
        'Weather': WX_NORM.get(str(payload.get('weather', 'Clear')).strip(), 'Fine no high winds'),
        'Road_Surface': RS_NORM.get(str(payload.get('road_surface', 'Dry Asphalt')).strip(), 'Dry'),
        'Day_of_Week': _cat('Day_of_Week', payload.get('day_of_week')),
        'Month': _cat('Month', payload.get('month')),
        'Light': LIGHT_NORM.get(str(payload.get('light', '')).strip(), _cat('Light', None)),
        'Road_Type': ROAD_NORM.get(str(payload.get('road_type', '')).strip(), _cat('Road_Type', None)),
        'Road_Class1': _cat('Road_Class1', payload.get('road_class')),
        'Road_Class2': _cat('Road_Class2', None),
        'Junction_Detail': JUNC_NORM.get(str(payload.get('junction', '')).strip(), _cat('Junction_Detail', None)),
        'Junction_Control': _cat('Junction_Control', None),
        'Ped_Crossing': _cat('Ped_Crossing', None),
        'Site_Cond': _cat('Site_Cond', None),
        'Carriage_Haz': _cat('Carriage_Haz', None),
        'Urban_Rural': _cat('Urban_Rural', None),
        'Trunk': _cat('Trunk', None),
        'Veh_Type': VEH_NORM.get(str(payload.get('vehicle_type', '')).strip(), _cat('Veh_Type', None)),
        'Veh_Manoeuvre': _cat('Veh_Manoeuvre', None),
        'Junction_Loc': _cat('Junction_Loc', None),
        'Dir_From': _cat('Dir_From', None),
        'Dir_To': _cat('Dir_To', None),
        'Driver_Sex': _cat('Driver_Sex', payload.get('driver_sex')),
        'Driver_AgeBand': AGE_NORM.get(str(payload.get('age_band', '')).strip(), _cat('Driver_AgeBand', None)),
        'Veh_AgeBand': _cat('Veh_AgeBand', None),
        'Journey': _cat('Journey', None),
        'Propulsion': _cat('Propulsion', None),
    }
    if preprocessor is None:
        raise RuntimeError('preprocessor.pkl missing. Run train_model.py first.')
    return (preprocessor.transform(pd.DataFrame([row])),
            {'dist': dist, 'size': size, 'is_noise': noise, 'cluster_id': cluster_id,
             'hour': hour, 'is_night': is_night},
            row)


if any(models_dict.values()) and severity_encoder is not None:
    print("-> Models + encoder loaded. Best:", get_best_model()[1])
else:
    print("-> Warning: model files missing. Run train_model.py first.")


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/metrics', methods=['GET'])
def get_metrics():
    if not os.path.exists('model_metrics.json'):
        return jsonify({'status': 'error',
                        'message': 'Metrics file not found. Run train_model.py first.'}), 404
    with open('model_metrics.json') as f:
        data = json.load(f)
    best_key, best_display, best_scores = get_best_model()
    return jsonify({'status': 'success', 'metrics': data,
                    'best_model': {'key': best_key, 'display': best_display,
                                   'scores': best_scores},
                    'stats': {'total_rows': features_meta.get('total_rows'),
                              'n_clusters': features_meta.get('n_clusters'),
                              'selection': 'fatal-first (within 1.0 macro-F1 of best)'}})


@app.route('/best_model', methods=['GET'])
def best_model_info():
    best_key, best_display, best_scores = get_best_model()
    return jsonify({'status': 'success', 'key': best_key,
                    'display': best_display, 'scores': best_scores})


@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json(force=True)
        best_key, best_display, _ = get_best_model()
        active_model = models_dict.get(best_key)
        if active_model is None:
            for k in ('xgboost', 'random_forest', 'logistic_regression'):
                if models_dict.get(k) is not None:
                    active_model = models_dict[k]
                    best_key, best_display = k, KEY_TO_DISPLAY.get(k, k)
                    break
        if active_model is None or severity_encoder is None:
            raise RuntimeError('Model files missing. Run train_model.py first.')
        X, spat, row = build_model_frame(data)
        pred_encoded = active_model.predict(X)[0]
        pred_probs = (active_model.predict_proba(X)[0]
                      if hasattr(active_model, 'predict_proba') else [0.33, 0.33, 0.34])
        severity_label = severity_encoder.inverse_transform([pred_encoded])[0]
        classes = severity_encoder.classes_
        prob_dict = {str(cls): float(prob * 100)
                     for cls, prob in zip(classes, pred_probs)}
        lookup = hotspot_lookup()
        cid = int(spat['cluster_id'])
        info = lookup.get(cid) if cid >= 0 else None
        if info is not None:
            hotspot_label = info.get('name', f'Cluster #{cid}')
            hotspot_rank = info.get('rank')
            hotspot_count = int(info.get('count', spat['size']))
            hotspot_high = info.get('high_sev_pct')
        elif cid >= 0:
            hotspot_label = f'Cluster #{cid}'
            hotspot_rank = None
            hotspot_count = int(spat['size'])
            hotspot_high = None
        else:
            hotspot_label = 'Open road (no mapped hotspot)'
            hotspot_rank = hotspot_count = hotspot_high = None
        context, context_baseline = condition_context(row)
        return jsonify({
            'status': 'success',
            'predicted_severity': severity_label,
            'probabilities': prob_dict,
            'context': context,
            'context_baseline_pct': context_baseline,
            'cluster_id': cid,
            'hotspot': hotspot_label,
            'hotspot_rank': hotspot_rank,
            'hotspot_count': hotspot_count,
            'hotspot_high_sev_pct': hotspot_high,
            'n_hotspots': len(lookup),
            'hotspot_dist': round(spat['dist'], 5),
            'algorithm_used': best_display,
            'best_model_key': best_key,
            'selection_reason': 'fatal-first selection (within 1.0 macro-F1 of best)',
            'time_of_day': 'Night' if spat['is_night'] == 1 else 'Day',
            'hour': spat['hour'],
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400


if __name__ == '__main__':
    app.run(debug=True, port=5000)
