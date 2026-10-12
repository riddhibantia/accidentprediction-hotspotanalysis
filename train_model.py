import os
import pandas as pd
import numpy as np
import joblib
import matplotlib
matplotlib.use('Agg') # Non-interactive backend for saving plots
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.cluster import DBSCAN
from xgboost import XGBClassifier

print("==================================================")
print(" UK ROAD ACCIDENT SEVERITY & HOTSPOT PIPELINE")
print("==================================================")

# ==========================================
# STEP 1: DATA EXTRACTION & INGESTION
# ==========================================
print("\n[Step 1/6] Extracting and loading raw datasets...")
accident_path = 'data/Accident_Information.csv'
vehicle_path = 'data/Vehicle_Information.csv'

if os.path.exists(accident_path) and os.path.exists(vehicle_path):
    print("-> Found STATS19 CSV files. Loading with latin-1 encoding...")
    accident_df = pd.read_csv(accident_path, encoding='latin-1', low_memory=False)
    vehicle_df = pd.read_csv(vehicle_path, encoding='latin-1', low_memory=False)
    
    vehicle_subset = vehicle_df.drop_duplicates(subset=['Accident_Index'])
    df = pd.merge(accident_df, vehicle_subset, on='Accident_Index', how='inner', suffixes=('', '_veh'))
    print(f"-> Successfully merged datasets! Initial shape: {df.shape}")
else:
    print("-> Warning: Datasets not found. Generating simulation dataset...")
    np.random.seed(42)
    n_samples = 2000
    df = pd.DataFrame({
        'Latitude': np.random.uniform(50.5, 53.5, n_samples),
        'Longitude': np.random.uniform(-2.5, 0.5, n_samples),
        'Speed_limit': np.random.choice([30, 40, 50, 60, 70], n_samples),
        'Weather': np.random.choice(['Fine no high winds', 'Raining no high winds', 'Fog or mist', 'Snowing'], n_samples),
        'Road_Surface': np.random.choice(['Dry', 'Wet or damp', 'Frost or ice', 'Snow'], n_samples),
        'Accident_Severity': np.random.choice(['Slight', 'Serious', 'Fatal'], n_samples, p=[0.75, 0.20, 0.05])
    })

# ==========================================
# STEP 2: DATA CLEANING & MISSING VALUE TREATMENT
# ==========================================
print("\n[Step 2/6] Cleaning data and handling missing values...")
column_mapping = {
    'Weather_Conditions': 'Weather',
    'Road_Surface_Conditions': 'Road_Surface',
    'Accident_Severity': 'Severity'
}
df = df.rename(columns=column_mapping)

df = df.dropna(subset=['Latitude', 'Longitude', 'Severity'])
print(f"-> Cleaned dataset rows: {len(df)}")

# ==========================================
# STEP 3: DATA TRANSFORMATION & DBSCAN SPATIAL CLUSTERING
# ==========================================
print("\n[Step 3/6] Performing DBSCAN Spatial Corridor Clustering...")
coords = df[['Latitude', 'Longitude']].values
dbscan = DBSCAN(eps=0.015, min_samples=10).fit(coords)
df['Cluster_ID'] = dbscan.labels_
n_clusters = len(set(dbscan.labels_)) - (1 if -1 in dbscan.labels_ else 0)
print(f"-> DBSCAN identified {n_clusters} high-risk spatial accident corridors.")

categorical_cols = ['Weather', 'Road_Surface']
for col in categorical_cols:
    if col in df.columns:
        le = LabelEncoder()
        df[col] = df[col].fillna('Unknown')
        df[col] = le.fit_transform(df[col].astype(str))

feature_columns = ['Latitude', 'Longitude', 'Speed_limit', 'Cluster_ID'] + [c for c in categorical_cols if c in df.columns]

# Clean missing rows directly in the DataFrame before extracting X and y
df_clean = df.dropna(subset=feature_columns + ['Severity']).copy()

X = df_clean[feature_columns]
severity_encoder = LabelEncoder()
y = severity_encoder.fit_transform(df_clean['Severity'])

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# ==========================================
# STEP 4: MODEL COMPARISON (Baseline vs Advanced)
# ==========================================
print("\n[Step 4/6] Running Model Comparison Benchmarks...")
# 1. Baseline: Logistic Regression
lr_model = LogisticRegression(max_iter=500, random_state=42)
lr_model.fit(X_train, y_train)
lr_acc = accuracy_score(y_test, lr_model.predict(X_test))
print(f"   -> Baseline (Logistic Regression) Accuracy: {lr_acc * 100:.2f}%")

# 2. Ensemble: Random Forest
rf_model = RandomForestClassifier(n_estimators=50, random_state=42)
rf_model.fit(X_train, y_train)
rf_acc = accuracy_score(y_test, rf_model.predict(X_test))
print(f"   -> Intermediate (Random Forest) Accuracy: {rf_acc * 100:.2f}%")

# ==========================================
# STEP 5: XGBOOST TRAINING & FEATURE IMPORTANCE
# ==========================================
print("\n[Step 5/6] Training Optimized XGBoost Classifier...")
model = XGBClassifier(n_estimators=100, learning_rate=0.1, max_depth=6, random_state=42, eval_metric='mlogloss')
model.fit(X_train, y_train)

y_pred = model.predict(X_test)
xgb_acc = accuracy_score(y_test, y_pred)
print(f"   -> Proposed Hybrid (XGBoost) Accuracy: {xgb_acc * 100:.2f}%")

# Generate and save Feature Importance Plot
os.makedirs('static', exist_ok=True)
plt.figure(figsize=(8, 5))
importances = model.feature_importances_
plt.barh(feature_columns, importances, color='#2563eb')
plt.xlabel('Importance Score')
plt.title('XGBoost Feature Importance Analysis')
plt.tight_layout()
plt.savefig('static/feature_importance.png', dpi=300)
plt.close()
print("-> Saved feature importance plot as 'static/feature_importance.png'.")

# ==========================================
# STEP 6: MODEL SERIALIZATION
# ==========================================
print("\n[Step 6/6] Saving Trained Model and Encoders...")
joblib.dump(model, 'model.pkl')
joblib.dump(severity_encoder, 'severity_encoder.pkl')
print("-> Success! Pipeline execution completed.")
print("==================================================")

import json
from sklearn.metrics import precision_recall_fscore_support

# Evaluate all three models comprehensively
models = {
    "Logistic Regression": lr_model,
    "Random Forest": rf_model,
    "XGBoost Classifier": model
}

metrics_data = {}
for name, clf in models.items():
    preds = clf.predict(X_test)
    acc = accuracy_score(y_test, preds)
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, preds, average='weighted', zero_division=0)
    
    metrics_data[name] = {
        "Accuracy": round(acc * 100, 2),
        "Precision": round(precision * 100, 2),
        "Recall": round(recall * 100, 2),
        "F1-Score": round(f1 * 100, 2)
    }

# Save metrics to JSON for the web dashboard
with open('model_metrics.json', 'w') as f:
    json.dump(metrics_data, f, indent=4)
print("-> Saved model comparison metrics to 'model_metrics.json'.")

# Save all three models for live multi-model inference
joblib.dump(model, 'model.pkl')            # XGBoost
joblib.dump(rf_model, 'model_rf.pkl')    # Random Forest
joblib.dump(lr_model, 'model_lr.pkl')    # Logistic Regression
print("-> Saved all three models (XGBoost, Random Forest, Logistic Regression) successfully.")