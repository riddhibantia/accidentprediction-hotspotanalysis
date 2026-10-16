"""Generate the research-paper figures as 300 dpi PNGs in paper_figures/.

Sources: paper_eval.json + paper_probs.npz (held-out evaluation, produced by
paper_eval.py), static/dashboard_data.json (dataset + hotspots), and
model_features.json (CV grid). Figure 5 (feature importance) is reused from
static/feature_importance.png; Figure 9 (app screenshots) must be captured by
hand from the running web app.
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = "paper_figures"
os.makedirs(OUT, exist_ok=True)

with open("paper_eval.json") as f:
    EV = json.load(f)
with open("model_features.json") as f:
    FEAT = json.load(f)
with open("static/dashboard_data.json") as f:
    DASH = json.load(f)
P = np.load("paper_probs.npz")
yte = P["yte"]
CLASSES = EV["class_names"]                       # ['Fatal','Serious','Slight']
MODELS = ["Logistic Regression", "Random Forest", "XGBoost Classifier"]
SHORT = {"Logistic Regression": "Logistic\nRegression",
         "Random Forest": "Random\nForest",
         "XGBoost Classifier": "XGBoost"}
COLORS = {"Logistic Regression": "#94a3b8",
          "Random Forest": "#3b82f6",
          "XGBoost Classifier": "#1d4ed8"}

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                     "axes.titlesize": 11, "axes.titleweight": "bold"})


# ---------------------------------------------------------------- helpers
def _box(ax, x, y, w, h, text, face, edge="#1e293b", fs=8.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                 boxstyle="round,pad=0.012,rounding_size=0.02",
                 linewidth=1.1, edgecolor=edge, facecolor=face))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            fontsize=fs, color="#0f172a")


def _arrow(ax, x1, y1, x2, y2):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>",
                 mutation_scale=11, linewidth=1.1, color="#334155"))


# ---------------------------------------------------------------- Fig 1
def fig1_architecture():
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    ax.text(0.5, 0.985, "Offline training pipeline", ha="center", fontsize=10,
            fontweight="bold", color="#1d4ed8")
    ax.plot([0.03, 0.97], [0.155, 0.155], color="#cbd5e1", lw=1)
    ax.text(0.5, 0.125, "Online serving", ha="center", fontsize=9.5,
            fontweight="bold", color="#b45309")

    _box(ax, 0.30, 0.885, 0.40, 0.075, "STATS19 CSVs\n(Accident + Vehicle)", "#e2e8f0", fs=8)
    _box(ax, 0.30, 0.785, 0.40, 0.075, "Clean + engineer\n(decode labels, time features)", "#dbeafe", fs=8)
    _box(ax, 0.30, 0.685, 0.40, 0.075, "Stratified 80/20 split\n(BEFORE any fitting)", "#dbeafe", fs=8)
    _box(ax, 0.02, 0.560, 0.45, 0.085, "DBSCAN hotspots\n(train coords only, eps 1.5 km)", "#dbeafe", fs=8)
    _box(ax, 0.53, 0.560, 0.45, 0.085, "Preprocess\n(scale + one-hot -> 221 features)", "#dbeafe", fs=8)
    _box(ax, 0.30, 0.435, 0.40, 0.085, "Train LR / RF / XGBoost\n(6x3 CV + calibration)", "#c7d2fe", fs=8)
    _box(ax, 0.30, 0.315, 0.40, 0.085, "Evaluate + safety-first select", "#bfdbfe", fs=8)
    _box(ax, 0.30, 0.190, 0.40, 0.085, "Artifacts: model.pkl, preprocessor.pkl,\n"
                                     "spatial.pkl, metrics.json", "#c7d2fe", fs=8)

    _arrow(ax, 0.50, 0.885, 0.50, 0.862)
    _arrow(ax, 0.50, 0.785, 0.50, 0.762)
    _arrow(ax, 0.42, 0.687, 0.30, 0.647)
    _arrow(ax, 0.58, 0.687, 0.70, 0.647)
    _arrow(ax, 0.28, 0.560, 0.44, 0.522)
    _arrow(ax, 0.72, 0.560, 0.56, 0.522)
    _arrow(ax, 0.50, 0.435, 0.50, 0.402)
    _arrow(ax, 0.50, 0.315, 0.50, 0.277)

    _box(ax, 0.03, 0.005, 0.42, 0.095, "Flask API\n/predict  /metrics  /best_model", "#fde68a", fs=8)
    _box(ax, 0.55, 0.005, 0.42, 0.095, "Web dashboard\nmap + hotspot + predictor", "#fde68a", fs=8)
    _arrow(ax, 0.35, 0.190, 0.24, 0.102)
    _arrow(ax, 0.45, 0.052, 0.55, 0.052)
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig1_system_architecture.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 2
def fig2_pipeline():
    steps = ["1.  Ingest & merge STATS19  (104,246 collision rows)",
             "2.  Clean + engineer  (decode labels, hour sin/cos, age band)",
             "3.  Stratified 80/20 split  (BEFORE any fitting)",
             "4.  DBSCAN hotspots on train coords  (503 clusters, eps 1.5 km)",
             "5.  Preprocess  (scale + one-hot  ->  221 features)",
             "6.  Train  (balanced LR / RF / XGBoost, 6x3 CV + calibration)",
             "7.  Evaluate + serve  (safety-first selection)"]
    fig, ax = plt.subplots(figsize=(6.4, 6.0))
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    ax.text(0.5, 0.99, "Leak-free modelling pipeline", ha="center",
            fontsize=11, fontweight="bold", color="#1d4ed8")
    top, h, gap = 0.85, 0.09, 0.025
    ys = [top - i * (h + gap) for i in range(len(steps))]
    for i, (s, y) in enumerate(zip(steps, ys)):
        _box(ax, 0.08, y, 0.84, h, s, "#dbeafe" if i < 5 else "#c7d2fe", fs=9)
        if i:
            _arrow(ax, 0.5, ys[i - 1], 0.5, y + h)
    ax.text(0.5, ys[-1] - 0.06, "Every fitted component uses training data only",
            ha="center", fontsize=8.5, style="italic", color="#475569")
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig2_pipeline_flowchart.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 3
def fig3_class_distribution():
    sev = DASH["severity"]
    labels, counts = sev["labels"], sev["counts"]
    fig, ax = plt.subplots(figsize=(5.4, 3.4))
    bars = ax.bar(labels, counts, color=["#93c5fd", "#3b82f6", "#1e3a8a"])
    for b, c in zip(bars, counts):
        ax.text(b.get_x() + b.get_width() / 2, c, f"{c:,}\n({c/sum(counts)*100:.2f}%)",
                ha="center", va="bottom", fontsize=8.5)
    ax.axhline(sum(counts) * 0.7606, color="#dc2626", ls="--", lw=1,
               label="Majority-class baseline (76.06%)")
    ax.set_ylabel("Collisions")
    ax.set_ylim(0, max(counts) * 1.28)
    ax.set_title("Class distribution (104,246 collisions)")
    ax.legend(fontsize=7.5, loc="upper right")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig3_class_distribution.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 4
def fig4_hotspot_map():
    hs = DASH["hotspots"]
    lat = np.array([h["lat"] for h in hs])
    lng = np.array([h["lng"] for h in hs])
    pct = np.array([h["high_sev_pct"] for h in hs])
    cnt = np.array([h["count"] for h in hs])
    fig, ax = plt.subplots(figsize=(5.6, 7.0))
    sc = ax.scatter(lng, lat, c=pct, s=cnt * 1.6, cmap="YlOrRd",
                    edgecolor="#334155", linewidth=0.4, alpha=0.9, vmin=23.9, vmax=50)
    cb = fig.colorbar(sc, ax=ax, fraction=0.045)
    cb.set_label("High-severity % (Serious+Fatal)")
    ax.set_xlabel("Longitude"); ax.set_ylabel("Latitude")
    ax.set_title("DBSCAN high-severity hotspots (78 ranked)")
    ax.text(0.02, 0.02, "National baseline 23.9%", transform=ax.transAxes,
            fontsize=7.5, color="#475569")
    ax.grid(alpha=0.15)
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig4_hotspot_map.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 6
def fig6_confusion():
    fig, axes = plt.subplots(1, 3, figsize=(9.6, 3.4))
    for ax, m in zip(axes, MODELS):
        cm = np.array(EV[m]["confusion_matrix"], dtype=float)
        row = cm.sum(1, keepdims=True)
        norm = cm / row
        im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
        ax.set_xticks(range(3)); ax.set_yticks(range(3))
        ax.set_xticklabels(CLASSES, fontsize=6.5, rotation=30, ha="right")
        ax.set_yticklabels(CLASSES, fontsize=6.5)
        ax.set_xlabel("Predicted", fontsize=8)
        if ax is axes[0]:
            ax.set_ylabel("True", fontsize=8)
        ax.set_title(SHORT[m], fontsize=9)
        for i in range(3):
            for j in range(3):
                ax.text(j, i, f"{int(cm[i, j])}", ha="center", va="center",
                        fontsize=7, color="white" if norm[i, j] > 0.5 else "#0f172a")
    fig.colorbar(im, ax=axes, fraction=0.025, label="Row-normalised share")
    fig.suptitle("Confusion matrices on the held-out test set", fontsize=10,
                 fontweight="bold", y=1.02)
    fig.savefig(f"{OUT}/fig6_confusion_matrices.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 7
def fig7_model_comparison():
    macro_f1 = [np.mean([EV[m]["per_class"][c]["f1"] for c in CLASSES]) for m in MODELS]
    fatal_rec = [EV[m]["per_class"]["Fatal"]["recall"] for m in MODELS]
    x = np.arange(3); w = 0.36
    fig, ax = plt.subplots(figsize=(5.8, 3.5))
    b1 = ax.bar(x - w / 2, macro_f1, w, label="Macro-F1", color="#3b82f6")
    b2 = ax.bar(x + w / 2, fatal_rec, w, label="Fatal recall", color="#dc2626")
    best_macro = max(macro_f1)
    ax.axhline(best_macro - 1.0, color="#059669", ls="--", lw=1,
               label=f"Selection guard band ({best_macro-1.0:.2f})")
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.6,
                    f"{b.get_height():.1f}", ha="center", fontsize=7)
    ax.set_xticks(x); ax.set_xticklabels([SHORT[m] for m in MODELS], fontsize=8)
    ax.set_ylabel("Score (%)"); ax.set_ylim(0, max(max(macro_f1), max(fatal_rec)) * 1.3)
    ax.set_title("Macro-F1 vs fatal recall with the selection guard band")
    ax.legend(fontsize=7.5, ncol=3, loc="upper center")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig7_model_comparison.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 8
def fig8_reliability():
    import numpy as np
    pr = P["xgb"]
    fig, axes = plt.subplots(1, 3, figsize=(9.4, 3.2))
    for k, (ax, cls) in enumerate(zip(axes, CLASSES)):
        p = pr[:, k]
        y = (yte == k).astype(float)
        edges = np.linspace(0, 1, 11)
        xs, ys = [], []
        for lo, hi in zip(edges[:-1], edges[1:]):
            m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
            if m.sum() >= 10:
                xs.append(p[m].mean()); ys.append(y[m].mean())
        ax.plot([0, 1], [0, 1], ls="--", color="#94a3b8", lw=1)
        ax.plot(xs, ys, "o-", color="#1d4ed8", ms=4, lw=1.3)
        ax.set_title(cls, fontsize=9)
        ax.set_xlabel("Predicted probability", fontsize=8)
        if ax is axes[0]:
            ax.set_ylabel("Observed frequency", fontsize=8)
        ax.set_xlim(0, 1); ax.set_ylim(0, 1.02)
        ax.grid(alpha=0.15)
    fig.suptitle("Reliability of XGBoost probabilities (held-out set)", fontsize=10,
                 fontweight="bold", y=1.03)
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig8_reliability.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- Fig 10
def fig10_cv():
    cv = FEAT["best_cv_table"]
    vals = [c["macro_f1"] for c in cv]
    labels = [f"#{i+1}" for i in range(len(cv))]
    best = int(np.argmax(vals))
    colors = ["#c7d2fe"] * len(vals); colors[best] = "#1d4ed8"
    fig, ax = plt.subplots(figsize=(5.6, 3.3))
    bars = ax.bar(labels, vals, color=colors)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.15, f"{v:.2f}",
                ha="center", fontsize=7.5)
    ax.set_ylabel("CV macro-F1 (%)"); ax.set_ylim(35, 42)
    ax.set_title("XGBoost 6-config x 3-fold CV (best = #5)")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(f"{OUT}/fig10_cv_macro_f1.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    fig1_architecture()
    fig2_pipeline()
    fig3_class_distribution()
    fig4_hotspot_map()
    fig6_confusion()
    fig7_model_comparison()
    fig8_reliability()
    fig10_cv()
    print("wrote:", sorted(os.listdir(OUT)))
