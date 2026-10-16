"""Reproduce the exact held-out test evaluation and dump per-class metrics +
confusion matrices to paper_eval.json. Replicates train_model.py's preprocessing
and the same stratified split (random_state=42); uses the saved artifacts so no
retraining is needed. Run once to source the research paper's tables."""
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import (classification_report, confusion_matrix,
                             accuracy_score, balanced_accuracy_score,
                             matthews_corrcoef, log_loss,
                             precision_recall_fscore_support, roc_auc_score)

RANDOM_STATE = 42

_norm = {
    'accident_index': 'Accident_Index', 'collision_index': 'Accident_Index',
    'latitude': 'Latitude', 'longitude': 'Longitude', 'speed_limit': 'Speed_limit',
    'weather_conditions': 'Weather_Conditions',
    'road_surface_conditions': 'Road_Surface_Conditions',
    'accident_severity': 'Accident_Severity', 'collision_severity': 'Accident_Severity',
    'time': 'Time', 'date': 'Date', 'day_of_week': 'Day_of_Week',
    'light_conditions': 'Light', 'road_type': 'Road_Type',
    'first_road_class': 'Road_Class1', 'second_road_class': 'Road_Class2',
    'junction_detail': 'Junction_Detail', 'junction_control': 'Junction_Control',
    'pedestrian_crossing': 'Ped_Crossing',
    'special_conditions_at_site': 'Site_Cond', 'carriageway_hazards': 'Carriage_Haz',
    'urban_or_rural_area': 'Urban_Rural', 'trunk_road_flag': 'Trunk',
    'vehicle_type': 'Veh_Type', 'vehicle_manoeuvre': 'Veh_Manoeuvre',
    'junction_location': 'Junction_Loc', 'vehicle_direction_from': 'Dir_From',
    'vehicle_direction_to': 'Dir_To', 'sex_of_driver': 'Driver_Sex',
    'age_band_of_driver': 'Driver_AgeBand', 'age_of_vehicle': 'Veh_Age',
    'journey_purpose_of_driver': 'Journey', 'propulsion_code': 'Propulsion',
}
RAW_NUM = ['Latitude', 'Longitude', 'Speed_limit', 'Is_Night', 'Hour_sin', 'Hour_cos']
RAW_CAT = ['Weather', 'Road_Surface', 'Day_of_Week', 'Month', 'Light', 'Road_Type',
           'Road_Class1', 'Road_Class2', 'Junction_Detail', 'Junction_Control',
           'Ped_Crossing', 'Site_Cond', 'Carriage_Haz', 'Urban_Rural', 'Trunk',
           'Veh_Type', 'Veh_Manoeuvre', 'Junction_Loc', 'Dir_From', 'Dir_To',
           'Driver_Sex', 'Driver_AgeBand', 'Veh_AgeBand', 'Journey', 'Propulsion']
SPAT = ['hotspot_dist', 'hotspot_size', 'is_noise']

acc = pd.read_csv('data/Accident_Information.csv', encoding='latin-1', low_memory=False)
veh = pd.read_csv('data/Vehicle_Information.csv', encoding='latin-1', low_memory=False)
acc = acc.rename(columns={c: _norm.get(c, _norm.get(c.lower(), c)) for c in acc.columns})
veh = veh.rename(columns={c: _norm.get(c, _norm.get(c.lower(), c)) for c in veh.columns})
df = pd.merge(acc, veh.drop_duplicates(subset=['Accident_Index']),
              on='Accident_Index', how='inner', suffixes=('', '_veh'))
df = df.rename(columns={'Weather_Conditions': 'Weather', 'Road_Surface_Conditions': 'Road_Surface',
                        'Accident_Severity': 'Severity'})
_sev = {1: 'Fatal', 2: 'Serious', 3: 'Slight', 1.0: 'Fatal', 2.0: 'Serious', 3.0: 'Slight',
        '1': 'Fatal', '2': 'Serious', '3': 'Slight'}
df['Severity'] = df['Severity'].map(lambda v: _sev.get(v, v))
_wx = {1: 'Fine no high winds', 2: 'Raining no high winds', 3: 'Snowing', 4: 'Fine no high winds',
       5: 'Raining no high winds', 6: 'Snowing', 7: 'Fog or mist', 8: 'Fine no high winds',
       9: 'Fine no high winds', -1: 'Fine no high winds'}
_rs = {1: 'Dry', 2: 'Wet or damp', 3: 'Snow', 4: 'Frost or ice', 5: 'Wet or damp',
       6: 'Dry', 7: 'Dry', 9: 'Dry', -1: 'Dry'}
df['Weather'] = df['Weather'].map(lambda v: _wx.get(v, 'Fine no high winds'))
df['Road_Surface'] = df['Road_Surface'].map(lambda v: _rs.get(v, 'Dry'))
_hour = lambda t: (lambda h: h if 0 <= h <= 23 else 12)(int(str(t).split(':')[0])) \
    if str(t).split(':')[0].lstrip('-').isdigit() else 12
df['Hour'] = df['Time'].apply(_hour) if 'Time' in df.columns else 12
df['Hour_sin'] = np.sin(2 * np.pi * df['Hour'] / 24)
df['Hour_cos'] = np.cos(2 * np.pi * df['Hour'] / 24)
df['Is_Night'] = (((df['Hour'] < 6) | (df['Hour'] >= 18))).astype(int)
_dt = pd.to_datetime(df['Date'], format='%d/%m/%Y', errors='coerce') if 'Date' in df.columns else pd.Series(pd.NaT, index=df.index)
df['Month'] = _dt.dt.month.fillna(6).astype(int).astype(str)
def _veh_age_band(a):
    try:
        a = int(a)
    except Exception:
        return 'Unknown'
    if a < 0:
        return 'Unknown'
    if a <= 3:
        return 'New'
    if a <= 8:
        return 'Mid'
    return 'Old'
df['Veh_AgeBand'] = df['Veh_Age'].apply(_veh_age_band) if 'Veh_Age' in df.columns else 'Unknown'
for c in RAW_NUM + RAW_CAT:
    if c not in df.columns:
        df[c] = 0 if c in RAW_NUM else 'Unknown'
df = df.dropna(subset=['Latitude', 'Longitude', 'Severity', 'Speed_limit'])
for c in RAW_CAT:
    df[c] = df[c].fillna('Unknown').astype(str)
X_raw = df[RAW_NUM + RAW_CAT].copy()
sev_enc = joblib.load('severity_encoder.pkl')
y = sev_enc.transform(df['Severity'])
Xtr_raw, Xte_raw, ytr, yte = train_test_split(
    X_raw, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)

sp = joblib.load('spatial.pkl')
centroids = np.asarray(sp['centroids'], dtype=float)
sizes = np.asarray(sp['sizes'], dtype=float)
LAT0 = float(sp['lat0'])
EPS = float(sp['eps'])
def project_km(ll, lat0):
    ll = np.asarray(ll, dtype=float)
    return np.stack([ll[..., 1] * 111.320 * np.cos(np.radians(lat0)), ll[..., 0] * 110.574], -1)
CENTROIDS_KM = project_km(centroids, LAT0)
def spatial_features(coords):
    coords = np.asarray(coords, dtype=float)
    xy = project_km(coords, LAT0)
    d = np.sqrt(((xy[:, None, :] - CENTROIDS_KM[None, :, :]) ** 2).sum(2))
    j = d.argmin(1)
    best = d[np.arange(len(coords)), j]
    matched = best <= EPS
    return np.column_stack([best, np.where(matched, sizes[j], 0).astype(float), (~matched).astype(float)])
def frame_with_spatial(Xr):
    F = Xr[RAW_NUM].copy()
    S = spatial_features(Xr[['Latitude', 'Longitude']].values)
    for i, c in enumerate(SPAT):
        F[c] = S[:, i]
    for c in RAW_CAT:
        F[c] = Xr[c].values
    return F
pre = joblib.load('preprocessor.pkl')
Xte = pre.transform(frame_with_spatial(Xte_raw))

models = {'Logistic Regression': joblib.load('model_lr.pkl'),
          'Random Forest': joblib.load('model_rf.pkl'),
          'XGBoost Classifier': joblib.load('model.pkl')}
names = list(sev_enc.classes_)
out = {'test_rows': int(len(yte)), 'class_names': names}
_safe = {'Logistic Regression': 'logreg', 'Random Forest': 'rf', 'XGBoost Classifier': 'xgb'}
probs_dump = {}
for name, clf in models.items():
    p = clf.predict(Xte)
    pr = clf.predict_proba(Xte)
    probs_dump[_safe[name]] = pr
    per_p, per_r, per_f1, support = precision_recall_fscore_support(yte, p, average=None, zero_division=0)
    cm = confusion_matrix(yte, p)
    out[name] = {
        'per_class': {names[i]: {'precision': round(float(per_p[i]) * 100, 2),
                                 'recall': round(float(per_r[i]) * 100, 2),
                                 'f1': round(float(per_f1[i]) * 100, 2),
                                 'support': int(support[i])} for i in range(len(names))},
        'confusion_matrix': cm.tolist(),
        'accuracy': round(float(accuracy_score(yte, p)) * 100, 2),
        'balanced_accuracy': round(float(balanced_accuracy_score(yte, p)) * 100, 2),
        'mcc': round(float(matthews_corrcoef(yte, p)), 3),
        'macro_auc': round(float(roc_auc_score(yte, pr, multi_class='ovr', average='macro')) * 100, 2),
        'logloss': round(float(log_loss(yte, pr)), 3),
    }
with open('paper_eval.json', 'w') as f:
    json.dump(out, f, indent=4)
np.savez('paper_probs.npz', yte=yte, **probs_dump)
print(json.dumps(out, indent=2))
