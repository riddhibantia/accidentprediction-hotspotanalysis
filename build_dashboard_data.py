"""Build static/dashboard_data.json and static/location_data.json from the real
STATS19 CSVs plus the training artifacts.

dashboard_data.json powers the Overview console and the High-risk areas page:
  - national distributions used by the charts
  - a day-type x time-of-day breakdown so the whole console can be filtered
  - per-area breakdown + profile for the situation panel and the map filter
  - one risk rank shared by the map popups and the ranked list

location_data.json powers the Location explorer: one profile per UK city.

Run after train_model.py (needs spatial.pkl), or import and call build().
"""
import json

import joblib
import numpy as np
import pandas as pd

HOUR_BINS = [('12 AM', 0, 2), ('3 AM', 3, 5), ('6 AM', 6, 8), ('9 AM', 9, 11),
             ('12 PM', 12, 14), ('3 PM', 15, 17), ('6 PM', 18, 20), ('9 PM', 21, 23)]

# Console filter: day type x time-of-day window. Keys are "<day>|<period>".
DAY_TYPES = [('Weekday', (2, 3, 4, 5, 6)), ('Weekend', (1, 7))]   # 1=Sun ... 7=Sat
PERIODS = [('00-06', 0, 5), ('06-12', 6, 11), ('12-18', 12, 17), ('18-24', 18, 23)]

JUNCTION_LABEL = {0: 'Not at a junction', 13: 'T or staggered junction', 16: 'Crossroads',
                  17: 'Private drive', 18: 'More than 4 arms', 19: 'Other junction',
                  -1: 'Unknown'}
LIGHT_LABEL = {1: 'Daylight', 4: 'Dark, lit', 5: 'Dark, unlit', 6: 'Dark, unlit',
               7: 'Unknown', -1: 'Unknown'}
ROAD_TYPE_LABEL = {1: 'Roundabout', 2: 'One-way street', 3: 'Dual carriageway',
                   6: 'Single carriageway', 7: 'Slip road', 9: 'Unknown', -1: 'Unknown'}
URBAN_LABEL = {1: 'Urban', 2: 'Rural', 3: 'Unallocated', -1: 'Unknown'}

HIGH_SEV = ('Serious', 'Fatal')
CITY_RADIUS_KM = 15
MIN_CITY_N = 300


def load_frame():
    acc = pd.read_csv('data/Accident_Information.csv', encoding='latin-1', low_memory=False)
    veh = pd.read_csv('data/Vehicle_Information.csv', encoding='latin-1', low_memory=False)
    acc = acc.rename(columns={'collision_index': 'Accident_Index', 'latitude': 'Latitude',
        'longitude': 'Longitude', 'speed_limit': 'Speed_limit',
        'weather_conditions': 'Weather', 'road_surface_conditions': 'Road_Surface',
        'collision_severity': 'Severity', 'time': 'Time', 'date': 'Date',
        'day_of_week': 'Day_of_Week', 'junction_detail': 'Junction_Detail',
        'light_conditions': 'Light', 'road_type': 'Road_Type',
        'urban_or_rural_area': 'Urban_Rural'})
    veh = veh.rename(columns={'collision_index': 'Accident_Index',
                               'vehicle_type': 'Veh_Type'})
    df = pd.merge(acc, veh.drop_duplicates(subset=['Accident_Index']),
                  on='Accident_Index', how='inner')
    df['Severity'] = df['Severity'].map({1: 'Fatal', 2: 'Serious', 3: 'Slight'})
    df['Weather'] = df['Weather'].map({1: 'Fine no high winds', 2: 'Raining no high winds',
        3: 'Snowing', 4: 'Fine no high winds', 5: 'Raining no high winds', 6: 'Snowing',
        7: 'Fog or mist', 8: 'Fine no high winds', 9: 'Fine no high winds', -1: 'Fine no high winds'})
    df['Road_Surface'] = df['Road_Surface'].map({1: 'Dry', 2: 'Wet or damp', 3: 'Snow',
        4: 'Frost or ice', 5: 'Wet or damp', 6: 'Dry', 7: 'Dry', 9: 'Dry', -1: 'Dry'})
    df['Hour'] = df['Time'].apply(lambda t: int(str(t).split(':')[0])
                                  if str(t).split(':')[0].isdigit() else 12)
    df['RoadTypeLabel'] = df['Road_Type'].map(ROAD_TYPE_LABEL).fillna('Unknown')
    df['JunctionLabel'] = df['Junction_Detail'].map(JUNCTION_LABEL).fillna('Unknown')
    df['LightLabel'] = df['Light'].map(LIGHT_LABEL).fillna('Unknown')
    df['UrbanLabel'] = df['Urban_Rural'].map(URBAN_LABEL).fillna('Unknown')
    return df.dropna(subset=['Latitude', 'Longitude', 'Severity'])


def _cell(sub):
    """Compact severity + context counts for a slice of collisions."""
    vc = sub['Severity'].value_counts()
    return {
        'count': int(len(sub)),
        'slight': int(vc.get('Slight', 0)),
        'serious': int(vc.get('Serious', 0)),
        'fatal': int(vc.get('Fatal', 0)),
        'junction': int((sub['Junction_Detail'] != 0).sum()),
        'darkness': int(sub['Light'].isin([4, 5, 6]).sum()),
        'urban': int((sub['Urban_Rural'] == 1).sum()),
    }


def _hotspot_cell(sub):
    vc = sub['Severity'].value_counts()
    return {'count': int(len(sub)), 'serious': int(vc.get('Serious', 0)),
            'fatal': int(vc.get('Fatal', 0))}


def _modal(series, fallback='Unknown'):
    s = series.dropna()
    if not len(s):
        return fallback
    return str(s.value_counts().index[0])


def _profile(frame):
    """Most common conditions among serious and fatal collisions."""
    hs = frame[frame['Severity'].isin(HIGH_SEV)]
    if not len(hs):
        hs = frame
    speeds = hs['Speed_limit'].dropna()
    return {
        'weather': _modal(hs['Weather'], 'Fine no high winds'),
        'road_type': _modal(hs['RoadTypeLabel']),
        'speed': ('%g mph' % int(speeds.mode().iloc[0])) if len(speeds) else 'Unknown',
        'junction': _modal(hs['JunctionLabel']),
        'light': _modal(hs['LightLabel']),
        'urban': _modal(hs['UrbanLabel']),
    }


def _projector(lat0):
    def proj(latlon):
        ll = np.asarray(latlon, dtype=float)
        x = ll[..., 1] * 111.320 * np.cos(np.radians(lat0))
        y = ll[..., 0] * 110.574
        return np.stack([x, y], axis=-1)
    return proj


def build():
    df = load_frame()
    sp = joblib.load('spatial.pkl')
    C = np.asarray(sp['centroids'], dtype=float)
    lat0 = float(sp.get('lat0', 54.0))
    proj = _projector(lat0)

    coords = proj(df[['Latitude', 'Longitude']].values)
    C_km = proj(C)
    d = np.sqrt(((coords[:, None, :] - C_km[None, :, :]) ** 2).sum(2))
    j = d.argmin(1)
    matched = d[np.arange(len(df)), j] <= sp['eps']
    df = df.copy()
    df['hs'] = np.where(matched, j, -1)

    sev_order = ['Slight', 'Serious', 'Fatal']
    sev_counts = df['Severity'].value_counts()
    wx_counts = df['Weather'].value_counts()
    rs_counts = df['Road_Surface'].value_counts()
    hour_counts = (df['Hour'].clip(0, 23).value_counts()
                   .reindex(range(24), fill_value=0))
    speeds = sorted(df['Speed_limit'].dropna().unique().tolist())
    high_sev = [(df.loc[df['Speed_limit'] == s, 'Severity'].isin(HIGH_SEV).mean() * 100)
                for s in speeds]

    # Hour-bin x severity shares (for the "when is it serious?" heatmap)
    df['HourBin'] = pd.cut(df['Hour'].clip(0, 23),
                           bins=[-1, 2, 5, 8, 11, 14, 17, 20, 23],
                           labels=[b[0] for b in HOUR_BINS])
    hour_sev = {}
    for b in [x[0] for x in HOUR_BINS]:
        grp = df[df['HourBin'] == b]['Severity']
        hour_sev[b] = {s: round(float((grp == s).mean() * 100), 1)
                       for s in ['Slight', 'Serious', 'Fatal']}

    # Vehicle-group x severity shares (codes -> readable groups)
    def veh_group(v):
        v = str(v)
        if v == '9':
            return 'Car'
        if v == '19':
            return 'Van'
        if v in ('2', '3', '4', '5', '23', '33', '97'):
            return 'Motorcycle'
        if v == '1':
            return 'Pedal cycle'
        if v in ('10', '11'):
            return 'Bus/Coach'
        if v == '8':
            return 'Taxi'
        if v in ('20', '21'):
            return 'HGV'
        return 'Other'
    df['VehGroup'] = df['Veh_Type'].apply(veh_group)
    veh_sev = {}
    for g, grp in df.groupby('VehGroup'):
        n = len(grp)
        if n < 100:
            continue
        veh_sev[g] = {'n': int(n),
                      'serious': round(float((grp['Severity'] == 'Serious').mean() * 100), 1),
                      'fatal': round(float((grp['Severity'] == 'Fatal').mean() * 100), 1)}

    # --- Per-area (DBSCAN cluster) records ---------------------------------
    hotspots = []
    for c, grp in df[df['hs'] >= 0].groupby('hs'):
        n = len(grp)
        if n < 40:
            continue
        vc = grp['Severity'].value_counts()
        cells = {}
        for dname, dvals in DAY_TYPES:
            dmask = grp['Day_of_Week'].isin(dvals)
            for pname, lo, hi in PERIODS:
                cells['%s|%s' % (dname, pname)] = _hotspot_cell(
                    grp[dmask & grp['Hour'].between(lo, hi)])
        hotspots.append({
            'cluster_id': int(c),
            'lat': round(float(C[c][0]), 5), 'lng': round(float(C[c][1]), 5),
            'count': int(n),
            'fatal': int(vc.get('Fatal', 0)), 'serious': int(vc.get('Serious', 0)),
            'slight': int(vc.get('Slight', 0)),
            'high_sev_pct': round(float((vc.get('Fatal', 0) + vc.get('Serious', 0)) / n * 100), 1),
            'cells': cells,
            'profile': _profile(grp),
        })
    hotspots.sort(key=lambda h: -h['count'])
    hotspots = hotspots[:80]

    # Give each hotspot a place name (nearest UK city) instead of a bare "#n".
    try:
        with open('static/uk_cities.json') as f:
            cities = json.load(f)
        cnames = [c['name'] for c in cities]
        cc = np.array([[c['lat'], c['lng']] for c in cities], dtype=float)
        for h in hotspots:
            dy = (cc[:, 0] - h['lat']) * 111.0
            dx = (cc[:, 1] - h['lng']) * 111.0 * np.cos(np.radians(h['lat']))
            dkm = np.sqrt(dx * dx + dy * dy)
            k = int(dkm.argmin())
            km = round(float(dkm[k]), 1)
            h['name'] = cnames[k] if km <= 12 else 'Near ' + cnames[k]
            h['city_dist_km'] = km
    except Exception as e:
        print('-> city naming skipped:', e)

    # One risk rank, shared by the map popups and the side list
    hotspots.sort(key=lambda h: (-h['high_sev_pct'], -h['count']))
    for i, h in enumerate(hotspots):
        h['rank'] = i + 1

    # --- National breakdown (day type x period) ----------------------------
    cells = {}
    for dname, dvals in DAY_TYPES:
        dmask = df['Day_of_Week'].isin(dvals)
        for pname, lo, hi in PERIODS:
            cells['%s|%s' % (dname, pname)] = _cell(df[dmask & df['Hour'].between(lo, hi)])

    hourly = []
    for h in range(24):
        vc = df[df['Hour'] == h]['Severity'].value_counts()
        hourly.append({'slight': int(vc.get('Slight', 0)),
                       'serious': int(vc.get('Serious', 0)),
                       'fatal': int(vc.get('Fatal', 0))})

    hourly_by_day = {}
    for dname, dvals in DAY_TYPES:
        sub = df[df['Day_of_Week'].isin(dvals)]
        series = []
        for h in range(24):
            vc = sub[sub['Hour'] == h]['Severity'].value_counts()
            series.append({'slight': int(vc.get('Slight', 0)),
                           'serious': int(vc.get('Serious', 0)),
                           'fatal': int(vc.get('Fatal', 0))})
        hourly_by_day[dname] = series

    wd_order = [(2, 'Mon'), (3, 'Tue'), (4, 'Wed'), (5, 'Thu'), (6, 'Fri'), (7, 'Sat'), (1, 'Sun')]
    weekday = []
    for code, _label in wd_order:
        vc = df[df['Day_of_Week'] == code]['Severity'].value_counts()
        weekday.append({'slight': int(vc.get('Slight', 0)),
                        'serious': int(vc.get('Serious', 0)),
                        'fatal': int(vc.get('Fatal', 0))})

    data = {
        'severity': {'labels': ['Slight Injury', 'Serious Injury', 'Fatal Injury'],
                     'counts': [int(sev_counts.get(s, 0)) for s in sev_order]},
        'weather': {'labels': list(wx_counts.index),
                    'counts': [int(v) for v in wx_counts.values]},
        'hour': {'labels': [b[0] for b in HOUR_BINS],
                 'counts': [int(hour_counts.loc[b[1]:b[2]].sum()) for b in HOUR_BINS]},
        'surface': {'labels': list(rs_counts.index),
                    'counts': [int(v) for v in rs_counts.values]},
        'speed': {'labels': ['%g MPH' % s for s in speeds],
                  'high_sev_pct': [round(float(v), 1) for v in high_sev]},
        'hour_severity': hour_sev,
        'vehicle_severity': veh_sev,
        'hotspots': hotspots,
        'cells': cells,
        'days': ['All', 'Weekday', 'Weekend'],
        'periods': ['All', '00-06', '06-12', '12-18', '18-24'],
        'hourly': hourly,
        'hourly_by_day': hourly_by_day,
        'weekday': weekday,
        'weekday_labels': [label for _code, label in wd_order],
        'profile': _profile(df),
        'totals': {'rows': int(len(df)), 'clusters': int(sp['n_clusters']),
                   'high_sev_pct': round(float(df['Severity'].isin(HIGH_SEV).mean() * 100), 1),
                   'fatal': int(sev_counts.get('Fatal', 0)),
                   'serious': int(sev_counts.get('Serious', 0)),
                   'slight': int(sev_counts.get('Slight', 0)),
                   'hotspots': len(hotspots)},
    }
    with open('static/dashboard_data.json', 'w') as f:
        json.dump(data, f)
    print('wrote static/dashboard_data.json: %d hotspots, %d rows'
          % (len(hotspots), len(df)))

    build_locations(df, hotspots, proj)
    return data


def build_locations(df, hotspots, proj):
    """One profile per UK city: a radius snapshot, its national standing, and
    the nearest ranked high-risk areas."""
    with open('static/uk_cities.json') as f:
        cities = json.load(f)

    rows = proj(df[['Latitude', 'Longitude']].values)
    hs_pts = proj(np.array([[h['lat'], h['lng']] for h in hotspots], dtype=float)) \
        if hotspots else np.zeros((0, 2))

    out = []
    for city in cities:
        cp = proj(np.array([[city['lat'], city['lng']]], dtype=float))[0]
        dkm = np.sqrt(((rows - cp) ** 2).sum(1))
        sub = df[dkm <= CITY_RADIUS_KM]
        n = int(len(sub))
        vc = sub['Severity'].value_counts() if n else pd.Series(dtype=int)
        fatal = int(vc.get('Fatal', 0)) if n else 0
        serious = int(vc.get('Serious', 0)) if n else 0
        slight = int(vc.get('Slight', 0)) if n else 0
        high_pct = round((fatal + serious) / n * 100, 1) if n else 0.0

        hourly = []
        for h in range(24):
            hourly.append(int((sub['Hour'] == h).sum()) if n else 0)
        wd = []
        for code in (2, 3, 4, 5, 6, 7, 1):
            wd.append(int((sub['Day_of_Week'] == code).sum()) if n else 0)

        nearest = []
        if len(hs_pts):
            dd = np.sqrt(((hs_pts - cp) ** 2).sum(1))
            for k in np.argsort(dd)[:3]:
                h = hotspots[int(k)]
                nearest.append({'rank': h['rank'], 'name': h['name'],
                                'km': round(float(dd[int(k)]), 1),
                                'high_sev_pct': h['high_sev_pct'], 'count': h['count']})

        out.append({
            'name': city['name'], 'lat': city['lat'], 'lng': city['lng'],
            'count': n, 'slight': slight, 'serious': serious, 'fatal': fatal,
            'high_sev_pct': high_pct,
            'hour': hourly, 'weekday': wd,
            'nearest': nearest,
            'profile': _profile(sub) if n else {},
            'low_data': n < MIN_CITY_N,
        })

    # National standing: rank cities by high-severity rate (only credible samples)
    ranked = sorted([c for c in out if not c['low_data']],
                    key=lambda c: (-c['high_sev_pct'], -c['count']))
    for i, c in enumerate(ranked):
        c['high_sev_rank'] = i + 1
    total_ranked = len(ranked)

    payload = {'radius_km': CITY_RADIUS_KM, 'min_n': MIN_CITY_N,
               'n_ranked': total_ranked, 'cities': out}
    with open('static/location_data.json', 'w') as f:
        json.dump(payload, f)
    print('wrote static/location_data.json: %d cities (%d ranked)'
          % (len(out), total_ranked))
    return payload


if __name__ == '__main__':
    build()
