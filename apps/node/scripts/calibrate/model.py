import pandas as pd, numpy as np, sys, json
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, brier_score_loss
d = pd.read_csv(sys.argv[1])
def feats(d):
    X = pd.DataFrame(index=d.index)
    X["still5"] = d.still5
    X["dumped5"] = d.dumped5
    X["devSold5"] = d.devSold5
    X["logPrior"] = np.log1p(d.priorLaunches)
    X["priorDumpShare"] = d.priorDumped / (d.priorLaunches + 1)
    X["priorGrad"] = (d.priorGrad > 0).astype(int)
    X["bundle15"] = (d.launchShare >= 0.15).astype(int)
    X["launchShare"] = d.launchShare.clip(0, 1)
    X["devShare"] = d.devShare.clip(0, 0.3)
    X["logB1"] = np.log1p(d.buyers1m)
    X["logB5"] = np.log1p(d.buyers5)
    X["insiders"] = ((d.earlyHeld.fillna(0) >= 0.25) & (d.earlyWallets.fillna(0) >= 2)).astype(int)
    X["wash"] = d.washShare.fillna(0)
    X["crew2"] = (d.creatorCrew.fillna(0) >= 2).astype(int)
    X["ring3"] = (d.ringWallets.fillna(0) >= 3).astype(int)
    X["social"] = (d.nSocial > 0).astype(int)
    X["mayhem"] = d.mayhem
    X["funderEx"] = d.funderEx.fillna(0)
    X["funderMany"] = (d.funderDevs.fillna(0) >= 3).astype(int)
    return X
X = feats(d)
# time split: older half trains, newer half tests (no look-ahead)
order = d.ageH.sort_values(ascending=False).index
cut = len(order) // 2
tr, te = order[:cut], order[cut:]
out = {}
for target in ["peakAfter5", "alive", "dumpedLater"]:
    y = d[target]
    lr = LogisticRegression(C=0.5, max_iter=2000, class_weight=None).fit(X.loc[tr], y.loc[tr])
    p = lr.predict_proba(X.loc[te])[:, 1]
    gb = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05).fit(X.loc[tr], y.loc[tr])
    pg = gb.predict_proba(X.loc[te])[:, 1]
    # what today's verdict says: avoid = dumped5 | serial | bundle15
    avoid = ((d.dumped5 == 1) | (d.serial == 1) | (d.launchShare >= 0.15)).astype(int).loc[te]
    print(f"\n== {target}: base {y.loc[te].mean():.4f}  AUC logit {roc_auc_score(y.loc[te], p):.3f}  AUC gbm {roc_auc_score(y.loc[te], pg):.3f}  AUC current-verdict {roc_auc_score(y.loc[te], 1-avoid):.3f}  brier {brier_score_loss(y.loc[te], p):.4f}")
    q = pd.qcut(pd.Series(p, index=te).rank(method="first"), 10, labels=False)
    tab = pd.DataFrame({"p": p, "y": y.loc[te].values, "q": q.values}).groupby("q").agg(n=("y", "size"), predicted=("p", "mean"), actual=("y", "mean"))
    print(tab.round(4).to_string())
    lr_all = LogisticRegression(C=0.5, max_iter=2000).fit(X, y)
    out[target] = {"intercept": float(lr_all.intercept_[0]), "coef": {c: round(float(v), 4) for c, v in zip(X.columns, lr_all.coef_[0])}}
    print({c: round(float(v), 2) for c, v in zip(X.columns, lr_all.coef_[0])})
json.dump(out, open(sys.argv[2], "w"), indent=1)
print("MEANS", json.dumps({c: round(float(v), 4) for c, v in X.mean().items()}))
