# AI / ML Enhancements

**Status:** Planned — v0.9.x (Q2 2027)  
**Priority:** 🟢 Low  
**Effort:** 2–4 weeks  
**Blocker:** Solid test + observability foundation required first

---

## Overview

On-device machine learning features: spending anomaly detection, ML-based category auto-suggestion, budget recommendation, and predictive analytics — all privacy-preserving (no data leaves the server).

## Scope

### 1. Spending Anomaly Detection
- Tool: `actual_ml_detect_anomalies`
- Detects statistically unusual transactions (z-score or IQR) per payee/category
- Returns anomaly score + explanation: "This Starbucks charge ($89) is 4× your average"

### 2. Category Auto-Suggestion
- Tool: `actual_ml_suggest_category`
- Input: transaction `payee_name` + `amount` + optional `notes`
- Uses a lightweight text classifier trained on the user's own historical data
- Model: k-NN or TF-IDF cosine similarity over past categorized transactions

### 3. Budget Recommendation Engine
- Tool: `actual_ml_recommend_budget`
- Analyzes 3–12 months of history to suggest monthly budget targets per category
- Confidence interval: "Groceries: $400–$520/month (based on 6 months)"

### 4. Predictive Analytics
- Tool: `actual_ml_predict_expenses`
- Projects next month's spend per category based on trends + seasonality
- Simple: linear regression or seasonal decomposition

## Key Constraints

- **Privacy-first**: All inference runs locally (no external API calls)
- **Lightweight**: Models must run in <200ms on a Raspberry Pi 4 (1GB RAM budget)
- **Optional**: All tools gated behind `ML_ENABLED=true` env flag

## Dependencies (candidates)

- [`ml-knn`](https://www.npmjs.com/package/ml-knn) — k-Nearest Neighbours classifier
- [`natural`](https://www.npmjs.com/package/natural) — TF-IDF + tokenization
- TensorFlow.js (heavyweight, use only if accuracy demands it)

## References

- [ml.js ecosystem](https://github.com/mljs/ml)
- [natural NLP library](https://github.com/NaturalNode/natural)
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts)
- [`docs/feature/CF4_HYBRID_SEARCH.md`](./CF4_HYBRID_SEARCH.md) — embedding pipeline reuse possible
