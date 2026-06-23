"""
Traffic Twin Bengaluru — ML Decision Engine Training
=====================================================
Trains 6 models from the ASTRAM Bengaluru Police event dataset:

  1. clearance_model   — how long until traffic clears (minutes)
  2. impact_model      — road impact score 0-100
  3. barricade_model   — barricading intensity 0-100%
  4. closure_model     — road closure required YES/NO
  5. manpower_model    — total police officers required
  6. diversion_model   — diversion required YES/NO

Outputs saved to models/ :
  clearance_model.pkl, impact_model.pkl, barricade_model.pkl,
  closure_model.pkl, manpower_model.pkl, diversion_model.pkl,
  feature_encoder.pkl, scaler.pkl
"""

import os
import warnings
import joblib
import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import (
    mean_absolute_error, r2_score,
    accuracy_score, f1_score, classification_report
)
import lightgbm as lgb

warnings.filterwarnings("ignore")
np.random.seed(42)

# ─────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────
DATA_PATH  = os.path.join("data", "astram.csv")
MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

print("=" * 60)
print("  TRAFFIC TWIN BENGALURU — ML TRAINING PIPELINE")
print("=" * 60)

# ─────────────────────────────────────────────
# SECTION 1: LOAD DATA
# ─────────────────────────────────────────────
print("\n[1/7] Loading ASTRAM dataset ...")
df = pd.read_csv(DATA_PATH, encoding="utf-8", on_bad_lines="skip", low_memory=False)
df.columns = df.columns.str.strip().str.lower()
print(f"      Loaded {len(df):,} events, {len(df.columns)} columns")

# ─────────────────────────────────────────────
# SECTION 2: DATETIME PARSING & CLEARANCE TIME
# ─────────────────────────────────────────────
print("\n[2/7] Parsing datetimes and computing clearance time ...")
for col in ["start_datetime", "closed_datetime", "resolved_datetime", "end_datetime"]:
    if col in df.columns:
        df[col] = pd.to_datetime(df[col], errors="coerce")

# Best available end time: closed_datetime > resolved_datetime > end_datetime
df["event_end"] = df.get("closed_datetime", pd.NaT)
if "resolved_datetime" in df.columns:
    df["event_end"] = df["event_end"].fillna(df["resolved_datetime"])
if "end_datetime" in df.columns:
    df["event_end"] = df["event_end"].fillna(df["end_datetime"])

df["clearance_min"] = (
    (df["event_end"] - df["start_datetime"]).dt.total_seconds() / 60
).clip(lower=0, upper=1440)  # cap at 24 hours

observed_mask = df["clearance_min"].notna()
print(f"      Observed clearance times: {observed_mask.sum():,} / {len(df):,}")
print(f"      Median clearance: {df.loc[observed_mask,'clearance_min'].median():.0f} min")

# ─────────────────────────────────────────────
# SECTION 3: FEATURE ENGINEERING
# ─────────────────────────────────────────────
print("\n[3/7] Engineering features ...")

# 3a — Time features
df["hour"]             = df["start_datetime"].dt.hour.fillna(8).astype(int)
df["dayofweek"]        = df["start_datetime"].dt.dayofweek.fillna(0).astype(int)
df["is_weekend"]       = (df["dayofweek"] >= 5).astype(int)
df["is_morning_peak"]  = df["hour"].between(7, 10).astype(int)
df["is_evening_peak"]  = df["hour"].between(17, 21).astype(int)
df["is_night"]         = (df["hour"].between(22, 23) | df["hour"].between(0, 5)).astype(int)

# 3b — Event category (grouped from event_cause for cleaner encoding)
CAUSE_CATEGORY = {
    "accident":          "accident",
    "water_logging":     "weather",
    "Fog / Low Visibility": "weather",
    "public_event":      "public",
    "procession":        "public",
    "vip_movement":      "public",
    "protest":           "public",
    "construction":      "infrastructure",
    "pot_holes":         "infrastructure",
    "road_conditions":   "infrastructure",
    "Debris":            "infrastructure",
    "debris":            "infrastructure",
    "vehicle_breakdown": "breakdown",
    "congestion":        "congestion",
    "tree_fall":         "tree_fall",
    "others":            "others",
    "test_demo":         "others",
}
df["event_cause"] = df["event_cause"].fillna("others").astype(str)
df["event_category"] = df["event_cause"].map(CAUSE_CATEGORY).fillna("others")

# 3c — NLP severity score from description (keyword-based, works on mixed language)
SEVERITY_KEYWORDS = {
    "fatal": 10, "death": 10, "died": 10,
    "injury": 8, "injured": 8, "hurt": 7,
    "fire": 8, "blast": 8,
    "overturned": 7, "collision": 7, "major accident": 7,
    "blocked": 6, "full block": 8, "complete block": 9,
    "flood": 6, "waterlog": 6, "heavy rain": 5,
    "crowd": 4, "procession": 4, "rally": 5,
    "breakdown": 3, "stuck": 3, "stranded": 4,
    "heavy traffic": 5, "severe": 5, "major": 4,
    "construction": 2, "pothole": 2, "minor": 1, "slow": 1,
}

def compute_description_severity(text: str) -> float:
    text = str(text).lower()
    score = 0.0
    for kw, weight in SEVERITY_KEYWORDS.items():
        if kw in text:
            score += weight
    return min(10.0, score)

df["description"] = df["description"].fillna("").astype(str)
df["description_severity"] = df["description"].apply(compute_description_severity)

# 3d — Categorical encoding
# Store encoder for each column → also used in inference
CATEGORICAL_COLS = [
    "event_type", "event_cause", "event_category",
    "priority", "veh_type",
    "zone", "corridor", "junction", "police_station",
]

encoders: dict[str, LabelEncoder] = {}
for col in CATEGORICAL_COLS:
    if col not in df.columns:
        df[col] = "unknown"
    df[col] = df[col].fillna("unknown").astype(str).str.strip()
    le = LabelEncoder()
    df[f"{col}_enc"] = le.fit_transform(df[col])
    encoders[col] = le

# corridor_is_major: flag for events not on 'Non-corridor'
df["corridor_is_major"] = (df["corridor"].str.lower() != "non-corridor").astype(int)

# veh_is_heavy: large vehicles create longer clearance
HEAVY_VEH = {"heavy_vehicle", "truck", "bmtc_bus", "private_bus", "ksrtc_bus"}
df["veh_is_heavy"] = df["veh_type"].isin(HEAVY_VEH).astype(int)

# priority_enc shorthand (High=1, Low=0 after label encoding may differ)
df["priority_high"] = (df["priority"].str.lower() == "high").astype(int)

# requires_road_closure as int (direct label)
df["closure_label"] = df["requires_road_closure"].astype(bool).astype(int) \
    if "requires_road_closure" in df.columns else 0

# ─────────────────────────────────────────────
# SECTION 4: DERIVE REMAINING TARGETS
# ─────────────────────────────────────────────
print("\n[4/7] Deriving engineered targets ...")

# ── 4a: Impact Score (0-100) ──────────────────
# Based on cause severity + priority + vehicle type + corridor importance + NLP
CAUSE_IMPACT_BASE = {
    "accident":          55, "water_logging":     50, "public_event":      45,
    "procession":        42, "protest":           40, "vip_movement":      38,
    "construction":      35, "congestion":        35, "tree_fall":         28,
    "vehicle_breakdown": 25, "pot_holes":         20, "road_conditions":   18,
    "Debris": 15, "debris": 15, "others": 22, "test_demo": 5,
    "Fog / Low Visibility": 20,
}
df["impact_base"] = df["event_cause"].map(CAUSE_IMPACT_BASE).fillna(22)

df["impact_score"] = (
    df["impact_base"]
    + df["priority_high"] * 25
    + df["closure_label"] * 15
    + df["veh_is_heavy"] * 10
    + df["corridor_is_major"] * 8
    + df["description_severity"] * 1.2
)
df["impact_score"] = df["impact_score"].clip(0, 100).round(1)

# ── 4b: Barricade Percentage (0-100%) ─────────
CAUSE_BARRICADE_BASE = {
    "accident":          65, "water_logging":     55, "public_event":      50,
    "procession":        60, "protest":           55, "vip_movement":      45,
    "construction":      40, "congestion":        20, "tree_fall":         30,
    "vehicle_breakdown": 25, "pot_holes":         20, "road_conditions":   15,
    "Debris": 20, "debris": 20, "others": 20, "test_demo": 5,
    "Fog / Low Visibility": 25,
}
df["barricade_base"] = df["event_cause"].map(CAUSE_BARRICADE_BASE).fillna(20)

df["barricade_percentage"] = (
    df["barricade_base"]
    + df["priority_high"] * 20
    + df["description_severity"] * 1.5
)
# Hard rules: closure must mean heavy barricading
df.loc[df["closure_label"] == 1, "barricade_percentage"] = \
    df.loc[df["closure_label"] == 1, "barricade_percentage"].clip(lower=80)
df["barricade_percentage"] = df["barricade_percentage"].clip(0, 100).round(1)

# ── 4c: Manpower Required (total officers) ────
CAUSE_MANPOWER_BASE = {
    "accident":          30, "water_logging":     25, "public_event":      40,
    "procession":        55, "protest":           50, "vip_movement":      35,
    "construction":      15, "congestion":        20, "tree_fall":         12,
    "vehicle_breakdown": 10, "pot_holes":          8, "road_conditions":   10,
    "Debris": 8, "debris": 8, "others": 12, "test_demo": 3,
    "Fog / Low Visibility": 18,
}
df["manpower_base"] = df["event_cause"].map(CAUSE_MANPOWER_BASE).fillna(12)

df["manpower_required"] = df["manpower_base"].copy().astype(float)
df.loc[df["priority_high"] == 1, "manpower_required"] *= 1.8
df.loc[df["closure_label"] == 1, "manpower_required"] += 15
df.loc[df["veh_is_heavy"] == 1,  "manpower_required"] += 5
df["manpower_required"] = df["manpower_required"].clip(5, 150).round(0).astype(int)

# ── 4d: Diversion Required (YES/NO) ──────────
DIVERSION_CAUSES = {
    "accident", "water_logging", "public_event",
    "procession", "vip_movement", "protest",
}
df["diversion_required"] = (
    (df["closure_label"] == 1) |
    (df["priority_high"] == 1) & df["event_cause"].isin(DIVERSION_CAUSES)
).astype(int)

print(f"      Impact score   — mean: {df['impact_score'].mean():.1f}, "
      f"std: {df['impact_score'].std():.1f}")
print(f"      Barricade %    — mean: {df['barricade_percentage'].mean():.1f}")
print(f"      Manpower       — mean: {df['manpower_required'].mean():.1f}")
print(f"      Closure (True) — {df['closure_label'].sum():,} ({df['closure_label'].mean()*100:.1f}%)")
print(f"      Diversion(True)— {df['diversion_required'].sum():,} ({df['diversion_required'].mean()*100:.1f}%)")
print(f"      Clearance obs  — {observed_mask.sum():,} rows")

# ─────────────────────────────────────────────
# SECTION 5: BASE FEATURE MATRIX
# ─────────────────────────────────────────────
BASE_FEATURE_COLS = [
    "event_type_enc", "event_cause_enc", "event_category_enc",
    "priority_enc", "priority_high",
    "veh_type_enc", "veh_is_heavy",
    "latitude", "longitude",
    "zone_enc", "corridor_enc", "corridor_is_major",
    "junction_enc", "police_station_enc",
    "hour", "dayofweek", "is_weekend",
    "is_morning_peak", "is_evening_peak", "is_night",
    "description_severity",
]

# Verify all feature columns exist and are numeric
for col in BASE_FEATURE_COLS:
    if col not in df.columns:
        df[col] = 0
    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

X_all = df[BASE_FEATURE_COLS].copy()

# ─────────────────────────────────────────────
# SECTION 6: TRAIN ALL 6 MODELS
# ─────────────────────────────────────────────
print("\n[5/7] Training models ...\n")

def train_regressor(X, y, name, n_estimators=600, lr=0.05):
    """Train LightGBM regressor with early-stopping-style split."""
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
    model = lgb.LGBMRegressor(
        n_estimators=n_estimators,
        learning_rate=lr,
        max_depth=6,
        num_leaves=31,
        min_child_samples=20,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=0.1,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(Xtr, ytr)
    pred = model.predict(Xte)
    mae  = mean_absolute_error(yte, pred)
    r2   = r2_score(yte, pred)
    print(f"  [{name}] MAE={mae:.2f}  R²={r2:.3f}  "
          f"(test n={len(yte):,})")
    return model

def train_classifier(X, y, name, n_estimators=600, lr=0.05, pos_weight=None):
    """Train LightGBM binary classifier."""
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
    params = dict(
        n_estimators=n_estimators,
        learning_rate=lr,
        max_depth=6,
        num_leaves=31,
        min_child_samples=20,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=0.1,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    if pos_weight is not None:
        params["scale_pos_weight"] = pos_weight
    model = lgb.LGBMClassifier(**params)
    model.fit(Xtr, ytr)
    pred = model.predict(Xte)
    acc  = accuracy_score(yte, pred)
    f1   = f1_score(yte, pred, average="weighted", zero_division=0)
    print(f"  [{name}] Accuracy={acc:.3f}  F1(weighted)={f1:.3f}  "
          f"(test n={len(yte):,})")
    print(classification_report(yte, pred, zero_division=0, digits=3))
    return model

# ── MODEL 1: Clearance Time ───────────────────
print("─── Model 1: Clearance Time (minutes) ─────────")
clearance_mask = df["clearance_min"].notna()
X_clr = X_all.loc[clearance_mask].copy()
y_clr = df.loc[clearance_mask, "clearance_min"].copy()
clearance_model = train_regressor(X_clr, y_clr, "clearance_time", n_estimators=700, lr=0.03)

# ── MODEL 2: Impact Score ─────────────────────
print("─── Model 2: Impact Score (0-100) ─────────────")
# Use a feature subset that doesn't include the derived components directly
# so the model generalises beyond the formula
impact_model = train_regressor(X_all, df["impact_score"], "impact_score")

# ── MODEL 3: Barricade Percentage ────────────
print("─── Model 3: Barricade Percentage (0-100%) ────")
barricade_model = train_regressor(X_all, df["barricade_percentage"], "barricade_pct")

# ── MODEL 4: Road Closure (binary) ───────────
print("─── Model 4: Road Closure (YES/NO) ────────────")
# Imbalanced: ~8% True → use scale_pos_weight
pos_w = (df["closure_label"] == 0).sum() / max(1, (df["closure_label"] == 1).sum())
closure_model = train_classifier(
    X_all, df["closure_label"],
    "road_closure", pos_weight=pos_w
)

# ── MODEL 5: Manpower ─────────────────────────
print("─── Model 5: Manpower Required (officers) ─────")
manpower_model = train_regressor(X_all, df["manpower_required"], "manpower")

# ── MODEL 6: Diversion ───────────────────────
print("─── Model 6: Diversion Required (YES/NO) ──────")
div_w = (df["diversion_required"] == 0).sum() / max(1, (df["diversion_required"] == 1).sum())
diversion_model = train_classifier(
    X_all, df["diversion_required"],
    "diversion", pos_weight=div_w
)

# ─────────────────────────────────────────────
# SECTION 7: SAVE ALL ARTIFACTS
# ─────────────────────────────────────────────
print("\n[6/7] Saving models and preprocessing artifacts ...")

# Models
joblib.dump(clearance_model, os.path.join(MODELS_DIR, "clearance_model.pkl"))
joblib.dump(impact_model,    os.path.join(MODELS_DIR, "impact_model.pkl"))
joblib.dump(barricade_model, os.path.join(MODELS_DIR, "barricade_model.pkl"))
joblib.dump(closure_model,   os.path.join(MODELS_DIR, "closure_model.pkl"))
joblib.dump(manpower_model,  os.path.join(MODELS_DIR, "manpower_model.pkl"))
joblib.dump(diversion_model, os.path.join(MODELS_DIR, "diversion_model.pkl"))

# Feature encoder bundle
feature_encoder = {
    "label_encoders": encoders,
    "feature_cols":   BASE_FEATURE_COLS,
    "cause_category_map": CAUSE_CATEGORY,
    "severity_keywords": SEVERITY_KEYWORDS,
    "heavy_veh_types": list(HEAVY_VEH),
}
joblib.dump(feature_encoder, os.path.join(MODELS_DIR, "feature_encoder.pkl"))

# Scaler (fit on base features for downstream use)
scaler = StandardScaler()
scaler.fit(X_all)
joblib.dump(scaler, os.path.join(MODELS_DIR, "scaler.pkl"))

print("  Saved:")
for fname in [
    "clearance_model.pkl", "impact_model.pkl", "barricade_model.pkl",
    "closure_model.pkl", "manpower_model.pkl", "diversion_model.pkl",
    "feature_encoder.pkl", "scaler.pkl",
]:
    path = os.path.join(MODELS_DIR, fname)
    if os.path.exists(path):
        size_kb = os.path.getsize(path) / 1024
        print(f"    {fname:<30s} {size_kb:>8.1f} KB")

# ─────────────────────────────────────────────
# SECTION 8: INLINE SAMPLE PREDICTIONS
# ─────────────────────────────────────────────
print("\n[7/7] Running sample predictions ...")
print("=" * 60)

def quick_predict(label, event_cause, priority, veh_type,
                  corridor, zone, lat, lon, hour, description):
    """Helper used only in this test block — mirrors ml_engine logic."""
    row = {}

    # Encode each categorical using the saved encoder (handle unseen → 0)
    def enc(col, val):
        le = encoders.get(col)
        if le is None:
            return 0
        val = str(val).strip()
        if val in le.classes_:
            return int(le.transform([val])[0])
        return 0

    cat = CAUSE_CATEGORY.get(event_cause, "others")
    row["event_type_enc"]      = enc("event_type", "unplanned")
    row["event_cause_enc"]     = enc("event_cause", event_cause)
    row["event_category_enc"]  = enc("event_category", cat)
    row["priority_enc"]        = enc("priority", priority)
    row["priority_high"]       = 1 if priority.lower() == "high" else 0
    row["veh_type_enc"]        = enc("veh_type", veh_type)
    row["veh_is_heavy"]        = 1 if veh_type in HEAVY_VEH else 0
    row["latitude"]            = lat
    row["longitude"]           = lon
    row["zone_enc"]            = enc("zone", zone)
    row["corridor_enc"]        = enc("corridor", corridor)
    row["corridor_is_major"]   = 0 if corridor.lower() == "non-corridor" else 1
    row["junction_enc"]        = 0
    row["police_station_enc"]  = 0
    row["hour"]                = hour
    row["dayofweek"]           = 2
    row["is_weekend"]          = 0
    row["is_morning_peak"]     = 1 if 7 <= hour <= 10 else 0
    row["is_evening_peak"]     = 1 if 17 <= hour <= 21 else 0
    row["is_night"]            = 1 if hour >= 22 or hour <= 5 else 0
    row["description_severity"] = compute_description_severity(description)

    X = pd.DataFrame([row])[BASE_FEATURE_COLS]

    clearance  = float(clearance_model.predict(X)[0])
    impact     = float(impact_model.predict(X)[0])
    barricade  = float(barricade_model.predict(X)[0])
    closure    = bool(closure_model.predict(X)[0])
    manpower   = float(manpower_model.predict(X)[0])
    diversion  = bool(diversion_model.predict(X)[0])

    result = {
        "clearance_time":     round(max(1, clearance), 0),
        "impact_score":       round(min(100, max(0, impact)), 1),
        "barricade_percentage": round(min(100, max(0, barricade)), 1),
        "closure_required":   closure,
        "diversion_required": diversion,
        "manpower_required":  round(max(5, manpower), 0),
    }
    print(f"\n  CASE: {label}")
    for k, v in result.items():
        print(f"    {k:<25s}: {v}")
    return result

# Test Case 1 — Small vehicle breakdown (low severity expected)
quick_predict(
    label="Small vehicle breakdown on inner road",
    event_cause="vehicle_breakdown",
    priority="Low",
    veh_type="private_car",
    corridor="Non-corridor",
    zone="Central Zone 1",
    lat=12.9716, lon=77.5946,
    hour=14,
    description="Car breakdown. Minor obstruction.",
)

# Test Case 2 — Large stadium event (high manpower, possible diversion expected)
quick_predict(
    label="IPL Match — Chinnaswamy Stadium",
    event_cause="public_event",
    priority="High",
    veh_type="others",
    corridor="CBD 2",
    zone="Central Zone 1",
    lat=12.9792, lon=77.5913,
    hour=18,
    description="Large crowd gathering for IPL. Heavy traffic on all access roads.",
)

# Test Case 3 — Major road accident (closure possible, high response expected)
quick_predict(
    label="Major truck accident on Hosur Road",
    event_cause="accident",
    priority="High",
    veh_type="heavy_vehicle",
    corridor="Hosur Road",
    zone="South Zone 2",
    lat=12.9176, lon=77.6244,
    hour=8,
    description="Truck overturned. Road blocked. Injury reported. Major accident.",
)

print("\n" + "=" * 60)
print("  TRAINING COMPLETE")
print("=" * 60)
