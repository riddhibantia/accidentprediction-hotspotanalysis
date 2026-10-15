"""UK Road Accident Severity & Hotspot Pipeline v3 (full features, leak-free).

v3 adds real STATS19 predictors (v2 had only 7 base fields):
time (hour sin/cos), month, day of week, light, road type/class, junction
detail/control, second road class, pedestrian crossing, site conditions,
carriageway hazards, urban/rural, trunk flag, vehicle type/manoeuvre,
junction location, travel direction, driver sex/age band, vehicle age band,
journey purpose, propulsion. Outcome columns (casualties, vehicle counts,
police attendance, adjusted-severity derivatives) are EXCLUDED as leakage.

Protocol (unchanged from v2): stratified split first; DBSCAN hotspot shapes
fit on train only; one-hot + scaled preprocessor fit on train only; balanced
class weights; depth-limited RF; small tuned XGB grid on macro-F1;
selection by macro-F1, tie-break Fatal recall.
"""
import os
import json
import time
import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (classification_report, accuracy_score, log_loss,
                             precision_recall_fscore_support, confusion_matrix,
                             balanced_accuracy_score, matthews_corrcoef, roc_auc_score)
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.cluster import DBSCAN
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

RANDOM_STATE = 42
EPS_KM = 1.5          # DBSCAN neighbourhood radius in kilometres
MIN_SAMPLES = 10
FATAL_FIRST_MACRO_GUARD = 1.0   # served model must be within this of best macro-F1


def project_km(latlon, lat0):
    """Equirectangular projection of (lat, lon) degrees to kilometres.

    DBSCAN on raw degrees is wrong: one degree of longitude is ~60% of a
    degree of latitude at UK latitudes, so clusters come out stretched.
    """
    ll = np.asarray(latlon, dtype=float)
    lat, lon = ll[..., 0], ll[..., 1]
    x = lon * 111.320 * np.cos(np.radians(lat0))
    y = lat * 110.574
    return np.stack([x, y], axis=-1)

print("==================================================")
print(" UK ROAD ACCIDENT SEVERITY & HOTSPOT PIPELINE v3")
print("==================================================")

# ================= STEP 1: DATA =================
print("\n[Step 1/7] Loading datasets...")
accident_path = 'data/Accident_Information.csv'
vehicle_path = 'data/Vehicle_Information.csv'
_norm = {
    'accident_index': 'Accident_Index', 'collision_index': 'Accident_Index',
    'latitude': 'Latitude', 'longitude': 'Longitude',
    'speed_limit': 'Speed_limit',
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
acc = pd.read_csv(accident_path, encoding='latin-1', low_memory=False)
veh = pd.read_csv(vehicle_path, encoding='latin-1', low_memory=False)
acc = acc.rename(columns={c: _norm.get(c, _norm.get(c.lower(), c)) for c in acc.columns})
veh = veh.rename(columns={c: _norm.get(c, _norm.get(c.lower(), c)) for c in veh.columns})
df = pd.merge(acc, veh.drop_duplicates(subset=['Accident_Index']),
              on='Accident_Index', how='inner', suffixes=('', '_veh'))
print(f"-> Merged shape: {df.shape} (first vehicle row per collision)")

# ================= STEP 2: CLEAN + ENGINEER =================
print("\n[Step 2/7] Cleaning + feature engineering...")
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


def _hour(t):
    try:
        h = int(str(t).split(':')[0])
        return h if 0 <= h <= 23 else 12
    except Exception:
        return 12


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

RAW_NUM = ['Latitude', 'Longitude', 'Speed_limit', 'Is_Night', 'Hour_sin', 'Hour_cos']
RAW_CAT = ['Weather', 'Road_Surface', 'Day_of_Week', 'Month', 'Light', 'Road_Type',
           'Road_Class1', 'Road_Class2', 'Junction_Detail', 'Junction_Control',
           'Ped_Crossing', 'Site_Cond', 'Carriage_Haz', 'Urban_Rural', 'Trunk',
           'Veh_Type', 'Veh_Manoeuvre', 'Junction_Loc', 'Dir_From', 'Dir_To',
           'Driver_Sex', 'Driver_AgeBand', 'Veh_AgeBand', 'Journey', 'Propulsion']
for c in RAW_NUM + RAW_CAT:
    if c not in df.columns:
        df[c] = 0 if c in RAW_NUM else 'Unknown'
df = df.dropna(subset=['Latitude', 'Longitude', 'Severity', 'Speed_limit'])
for c in RAW_CAT:
    df[c] = df[c].fillna('Unknown').astype(str)
print(f"-> Rows: {len(df)} | balance: {df['Severity'].value_counts(normalize=True).round(4).to_dict()}")

X_raw = df[RAW_NUM + RAW_CAT].copy()
sev_enc = LabelEncoder()
y = sev_enc.fit_transform(df['Severity'])

# ================= STEP 3: SPLIT FIRST =================
print("\n[Step 3/7] Stratified split BEFORE fitting...")
Xtr_raw, Xte_raw, ytr, yte = train_test_split(
    X_raw, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y)
print(f"-> train {Xtr_raw.shape} test {Xte_raw.shape}")

# ================= STEP 4: SPATIAL (train-only) =================
print("\n[Step 4/7] DBSCAN on TRAIN coords only (kilometres, not raw degrees)...")
tr_coords = Xtr_raw[['Latitude', 'Longitude']].values
LAT0 = float(np.mean(tr_coords[:, 0]))
tr_xy = project_km(tr_coords, LAT0)
t0 = time.time()
db = DBSCAN(eps=EPS_KM, min_samples=MIN_SAMPLES).fit(tr_xy)
labels = db.labels_
n_clusters = int(len(set(labels)) - (1 if -1 in labels else 0))
print(f"-> {n_clusters} clusters, eps={EPS_KM} km ({time.time()-t0:.1f}s)")
centroids, sizes = [], []
for c in sorted(set(labels)):
    if c == -1:
        continue
    m = tr_coords[labels == c]
    centroids.append(m.mean(axis=0))            # kept in degrees for the map
    sizes.append(len(m))
centroids, sizes = np.array(centroids), np.array(sizes)
CENTROIDS_KM = project_km(centroids, LAT0) if len(centroids) else np.empty((0, 2))


def spatial_features(coords):
    coords = np.asarray(coords, dtype=float)
    if len(centroids) == 0:
        return np.column_stack([np.zeros(len(coords)), np.zeros(len(coords)),
                                np.ones(len(coords))])
    xy = project_km(coords, LAT0)
    d = np.sqrt(((xy[:, None, :] - CENTROIDS_KM[None, :, :]) ** 2).sum(axis=2))
    j = d.argmin(axis=1)
    best = d[np.arange(len(coords)), j]
    matched = best <= EPS_KM
    return np.column_stack([best, np.where(matched, sizes[j], 0).astype(float),
                            (~matched).astype(float)])


SPAT = ['hotspot_dist', 'hotspot_size', 'is_noise']
NUM = RAW_NUM + SPAT


def frame_with_spatial(Xr):
    F = Xr[RAW_NUM].copy()
    S = spatial_features(Xr[['Latitude', 'Longitude']].values)
    for i, c in enumerate(SPAT):
        F[c] = S[:, i]
    for c in RAW_CAT:
        F[c] = Xr[c].values
    return F


Xtr_f = frame_with_spatial(Xtr_raw)
Xte_f = frame_with_spatial(Xte_raw)

# ================= STEP 5: PREPROCESS =================
print("\n[Step 5/7] Preprocessor (scale + one-hot, fit on train)...")
pre = ColumnTransformer([
    ('num', StandardScaler(), NUM),
    ('cat', OneHotEncoder(handle_unknown='ignore'), RAW_CAT),
])
Xtr = pre.fit_transform(Xtr_f)
Xte = pre.transform(Xte_f)
feat_names = list(pre.get_feature_names_out())
print(f"-> {len(feat_names)} transformed features")
defaults = {c: str(Xtr_raw[c].mode().iloc[0]) for c in RAW_CAT}
joblib.dump(pre, 'preprocessor.pkl')
joblib.dump({'centroids': centroids, 'sizes': sizes, 'eps': EPS_KM,
             'lat0': LAT0, 'n_clusters': n_clusters}, 'spatial.pkl')
joblib.dump(sev_enc, 'severity_encoder.pkl')

# ================= STEP 6: TRAIN =================
print("\n[Step 6/7] Training with balanced weights...")
sw_tr = compute_sample_weight(class_weight='balanced', y=ytr)
lr_model = LogisticRegression(max_iter=1000, class_weight='balanced', random_state=RANDOM_STATE)
lr_model.fit(Xtr, ytr)
print("-> LR done")
rf_model = RandomForestClassifier(n_estimators=200, max_depth=14, min_samples_leaf=5,
                                  class_weight='balanced_subsample',
                                  random_state=RANDOM_STATE, n_jobs=-1)
rf_model.fit(Xtr, ytr)
print("-> RF done")
grid = [
    {'max_depth': 4, 'learning_rate': 0.05, 'n_estimators': 300, 'min_child_weight': 5,
     'subsample': 0.8, 'colsample_bytree': 0.8},
    {'max_depth': 6, 'learning_rate': 0.05, 'n_estimators': 300, 'min_child_weight': 5,
     'subsample': 0.8, 'colsample_bytree': 0.8},
    {'max_depth': 4, 'learning_rate': 0.1, 'n_estimators': 200, 'min_child_weight': 1,
     'subsample': 0.8, 'colsample_bytree': 0.8},
    {'max_depth': 6, 'learning_rate': 0.1, 'n_estimators': 200, 'min_child_weight': 1,
     'subsample': 0.8, 'colsample_bytree': 0.8},
    {'max_depth': 6, 'learning_rate': 0.05, 'n_estimators': 500, 'min_child_weight': 3,
     'subsample': 0.9, 'colsample_bytree': 0.9},
    {'max_depth': 3, 'learning_rate': 0.1, 'n_estimators': 300, 'min_child_weight': 10,
     'subsample': 0.8, 'colsample_bytree': 0.8},
]
skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)
best_cfg, best_cv, cv_table = None, -1.0, []
for g, cfg in enumerate(grid):
    f1s = []
    for tri, vai in skf.split(Xtr, ytr):
        clf = XGBClassifier(**cfg, random_state=RANDOM_STATE, eval_metric='mlogloss',
                            tree_method='hist', n_jobs=-1)
        clf.fit(Xtr[tri], ytr[tri], sample_weight=sw_tr[tri])
        _, _, f1, _ = precision_recall_fscore_support(ytr[vai], clf.predict(Xtr[vai]),
                                                      average='macro', zero_division=0)
        f1s.append(f1)
    mean_f1 = float(np.mean(f1s))
    cv_table.append({'cfg': cfg, 'macro_f1': round(mean_f1 * 100, 2)})
    print(f"   XGB cfg {g+1}/{len(grid)}: CV macro-F1={mean_f1*100:.2f}")
    if mean_f1 > best_cv:
        best_cv, best_cfg = mean_f1, cfg
print(f"-> Best XGB (CV macro-F1={best_cv*100:.2f}): {best_cfg}")
xgb_base = XGBClassifier(**best_cfg, random_state=RANDOM_STATE, eval_metric='mlogloss',
                         tree_method='hist', n_jobs=-1)
xgb_base.fit(Xtr, ytr, sample_weight=sw_tr)
print("-> XGB done; building calibrated variants (sigmoid, isotonic)...")
xgb_candidates = {'raw': xgb_base}
for method in ('sigmoid', 'isotonic'):
    try:
        cm = CalibratedClassifierCV(xgb_base, method=method, cv=3)
        cm.fit(Xtr, ytr, sample_weight=sw_tr)
        xgb_candidates[method] = cm
        print(f"-> XGB {method}-calibrated")
    except Exception as e:
        print(f"-> {method} calibration skipped ({e})")

# ================= STEP 7: EVALUATE =================
print("\n[Step 7/7] Evaluating...")
sev_names = list(sev_enc.classes_)


def evaluate(clf):
    p = clf.predict(Xte)
    pr = clf.predict_proba(Xte)
    try:
        macro_auc = float(roc_auc_score(yte, pr, multi_class='ovr', average='macro'))
    except ValueError:
        macro_auc = float('nan')
    onehot = np.zeros_like(pr)
    onehot[np.arange(len(yte)), yte] = 1
    brier = float(((pr - onehot) ** 2).sum(axis=1).mean())
    wP, wR, wF1, _ = precision_recall_fscore_support(yte, p, average='weighted', zero_division=0)
    mP, mR, mF1, _ = precision_recall_fscore_support(yte, p, average='macro', zero_division=0)
    per = precision_recall_fscore_support(yte, p, average=None, zero_division=0)
    fatal_rec = float(per[1][sev_names.index('Fatal')])
    return {
        "Accuracy": round(accuracy_score(yte, p) * 100, 2),
        "Train_Acc": round(accuracy_score(ytr, clf.predict(Xtr)) * 100, 2),
        "Balanced_Accuracy": round(balanced_accuracy_score(yte, p) * 100, 2),
        "MCC": round(float(matthews_corrcoef(yte, p)), 3),
        "Macro_AUC": round(macro_auc * 100, 2) if macro_auc == macro_auc else None,
        "Brier": round(brier, 4),
        "Precision": round(wP * 100, 2), "Recall": round(wR * 100, 2),
        "F1-Score": round(wF1 * 100, 2),
        "Macro_F1": round(mF1 * 100, 2), "Macro_Precision": round(mP * 100, 2),
        "Macro_Recall": round(mR * 100, 2),
        "Fatal_Recall": round(fatal_rec * 100, 2),
        "LogLoss": round(float(log_loss(yte, pr)), 3),
    }


models = {"Logistic Regression": lr_model, "Random Forest": rf_model,
          "XGBoost Classifier": xgb_base}
metrics_data = {name: evaluate(clf) for name, clf in models.items()}

# Pick the best XGBoost variant (raw vs calibrated) by the app's rule:
# macro-F1, then Fatal recall, then lower logloss.
best_variant = 'raw'
best_m = metrics_data["XGBoost Classifier"]
for variant, cand in xgb_candidates.items():
    if variant == 'raw':
        continue
    m = evaluate(cand)
    if (m["Macro_F1"], m["Fatal_Recall"], -m["LogLoss"]) > \
       (best_m["Macro_F1"], best_m["Fatal_Recall"], -best_m["LogLoss"]):
        best_variant, best_m = variant, m
if best_variant != 'raw':
    models["XGBoost Classifier"] = xgb_candidates[best_variant]
    metrics_data["XGBoost Classifier"] = best_m
print(f"-> XGBoost served as: {best_variant}")

for name, clf in models.items():
    md = metrics_data[name]
    p = clf.predict(Xte)
    print(f"\n{name}: acc={md['Accuracy']:.2f} (train {md['Train_Acc']:.2f}) "
          f"macroF1={md['Macro_F1']:.2f} fatalRec={md['Fatal_Recall']:.1f} "
          f"logloss={md['LogLoss']:.3f} mcc={md['MCC']:.3f}")
    print(classification_report(yte, p, target_names=sev_names, zero_division=0))
    print("confusion (true Fatal/Serious/Slight):\n", confusion_matrix(yte, p))

order = sorted(metrics_data.items(),
               key=lambda kv: (kv[1]["Macro_F1"], kv[1]["Fatal_Recall"], kv[1]["F1-Score"]),
               reverse=True)
print("\n-> Ranking by Macro-F1:", [(n, v["Macro_F1"], v["Fatal_Recall"]) for n, v in order])
with open('model_metrics.json', 'w') as f:
    json.dump(metrics_data, f, indent=4)

# Served model: fatal-first with a macro-F1 guard (matches app.get_best_model)
best_macro = max(v["Macro_F1"] for v in metrics_data.values())
eligible = {n: v for n, v in metrics_data.items()
            if v["Macro_F1"] >= best_macro - FATAL_FIRST_MACRO_GUARD}
best_name = max(eligible, key=lambda n: (eligible[n]["Fatal_Recall"],
                                         eligible[n]["Macro_F1"], eligible[n]["F1-Score"]))
print(f"-> Serving {best_name} (fatal-first): macro-F1 "
      f"{metrics_data[best_name]['Macro_F1']} fatal recall {metrics_data[best_name]['Fatal_Recall']}")

os.makedirs('static', exist_ok=True)
best_clf = models[best_name]
est = best_clf
if hasattr(est, 'calibrated_classifiers_'):   # unwrap calibrated XGBoost
    try:
        est = est.calibrated_classifiers_[0].estimator
    except Exception:
        pass
plt.figure(figsize=(10, 6))
if hasattr(est, 'feature_importances_'):
    imp, title = est.feature_importances_, f'{best_name} Feature Importance'
elif hasattr(est, 'coef_'):
    imp, title = np.abs(est.coef_).mean(axis=0), f'{best_name} |Mean Coefficient|'
else:
    imp, title = np.ones(len(feat_names)), f'{best_name} (importances unavailable)'
idx = np.argsort(imp)[-25:]
plt.barh([feat_names[i] for i in idx], np.array(imp)[idx], color='#2563eb')
plt.xlabel('Importance'); plt.title(title + ' (v3, top 25)')
plt.tight_layout(); plt.savefig('static/feature_importance.png', dpi=300); plt.close()

with open('model_features.json', 'w') as f:
    json.dump({'raw_num': RAW_NUM, 'raw_cat': RAW_CAT, 'transformed_count': len(feat_names),
               'defaults': defaults, 'n_clusters': n_clusters,
               'spatial': {'eps_km': EPS_KM, 'min_samples': MIN_SAMPLES, 'lat0': round(LAT0, 4)},
               'total_rows': int(len(df)),
               'class_balance': {k: round(float(v), 4) for k, v in
                                 df['Severity'].value_counts(normalize=True).items()},
               'best_cv_table': cv_table, 'best_xgb_cfg': best_cfg,
               'selection': 'fatal-first (within 1.0 macro-F1 of best)'}, f, indent=4)
joblib.dump(models["XGBoost Classifier"], 'model.pkl')
joblib.dump(rf_model, 'model_rf.pkl')
joblib.dump(lr_model, 'model_lr.pkl')
try:
    from build_dashboard_data import build as build_dashboard
    build_dashboard()
except Exception as e:
    print('-> dashboard data skipped:', e)
print("\n-> Saved. Done.")
print("==================================================")
