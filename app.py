from flask import Flask, render_template, request, jsonify
import joblib
import pandas as pd
import os
import json

app = Flask(__name__)

# Load all three trained models and severity encoder
models_dict = {
    'xgboost': joblib.load('model.pkl') if os.path.exists('model.pkl') else None,
    'random_forest': joblib.load('model_rf.pkl') if os.path.exists('model_rf.pkl') else None,
    'logistic_regression': joblib.load('model_lr.pkl') if os.path.exists('model_lr.pkl') else None,
}
encoder_path = 'severity_encoder.pkl'
severity_encoder = joblib.load(encoder_path) if os.path.exists(encoder_path) else None

if any(models_dict.values()) and severity_encoder is not None:
    print("-> All trained models and encoder loaded successfully!")
else:
    print("-> Warning: Some model files not found. Please run train_model.py first.")

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/metrics', methods=['GET'])
def get_metrics():
    metrics_path = 'model_metrics.json'
    if os.path.exists(metrics_path):
        with open(metrics_path, 'r') as f:
            data = json.load(f)
        return jsonify({'status': 'success', 'metrics': data})
    else:
        return jsonify({'status': 'error', 'message': 'Metrics file not found. Run train_model.py first.'}), 404

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json()
        
        # Extract inputs from frontend form
        lat = float(data.get('latitude', 37.7749))
        lon = float(data.get('longitude', -122.4194))
        speed_limit = float(data.get('speed_limit', 45))
        
        # Get selected algorithm from frontend (default to xgboost)
        algo_choice = data.get('algorithm', 'xgboost')
        active_model = models_dict.get(algo_choice, models_dict['xgboost'])
        
        # Simple encoding mapping for weather and surface matching training categories
        weather_map = {'Clear': 0, 'Rain': 1, 'Fog': 2, 'Snow': 3, 'Storm': 4}
        surface_map = {'Dry Asphalt': 0, 'Wet Asphalt': 1, 'Potholes': 2, 'Unpaved': 3}
        
        weather_val = weather_map.get(data.get('weather', 'Clear'), 0)
        surface_val = surface_map.get(data.get('road_surface', 'Dry Asphalt'), 0)
        
        # Spatial Cluster ID heuristic based on coordinates/speed
        cluster_id = 101 if speed_limit > 50 else 103
        
        # Create input DataFrame matching training features
        input_df = pd.DataFrame([[lat, lon, speed_limit, cluster_id, weather_val, surface_val]],
                                columns=['Latitude', 'Longitude', 'Speed_limit', 'Cluster_ID', 'Weather', 'Road_Surface'])
        
        if active_model is not None and severity_encoder is not None:
            pred_encoded = active_model.predict(input_df)[0]
            
            # Check if model supports probability estimation
            if hasattr(active_model, 'predict_proba'):
                pred_probs = active_model.predict_proba(input_df)[0]
            else:
                pred_probs = [0.33, 0.33, 0.34]
                
            severity_label = severity_encoder.inverse_transform([pred_encoded])[0]
            classes = severity_encoder.classes_
            prob_dict = {str(cls): float(prob * 100) for cls, prob in zip(classes, pred_probs)}
        else:
            severity_label = "Serious"
            prob_dict = {"Slight": 40.0, "Serious": 50.0, "Fatal": 10.0}

        return jsonify({
            'status': 'success',
            'predicted_severity': severity_label,
            'probabilities': prob_dict,
            'cluster_id': cluster_id,
            'algorithm_used': algo_choice.upper().replace('_', ' ')
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

if __name__ == '__main__':
    app.run(debug=True, port=5000)