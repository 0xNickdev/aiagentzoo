# Forward check: the coefficients in odds.ts on launches they never saw, then one-number baselines. Paste new
# coefficients here when ODDS_FIT changes. curve5 and trades5 exist only for launches taped after 2026-11-07.
import pandas as pd,numpy as np,sys,json
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score as auc, brier_score_loss as brier
d=pd.read_csv(sys.argv[1]); print('rows',len(d),'ageH',d.ageH.min(),d.ageH.max())
RUN=dict(still5=1.0635,dumped5=-1.5096,devSold5=.2266,logPrior=-.4692,priorDumpShare=-.492,priorGrad=.5685,bundle15=-.0634,launchShare=3.6616,devShare=11.2021,logB1=-.4147,logB5=.6745,insiders=.4176,wash=-2.1802,crew2=.5282,ring3=-.2193,social=.5938,mayhem=.8704,funderEx=.3672,funderMany=-.0821); RI=-4.5509
DD=dict(still5=1.7846,dumped5=-7.9006,devSold5=-.8198,logPrior=-.1203,priorDumpShare=3.083,priorGrad=-.0079,bundle15=-2.4286,launchShare=2.9102,devShare=4.0896,logB1=.057,logB5=.0481,insiders=-.6629,wash=-1.6454,crew2=-.7616,ring3=-1.6221,social=.1288,mayhem=-.1446,funderEx=.0953,funderMany=.9752); DI=-1.7451
X=pd.DataFrame(index=d.index)
X["still5"]=d.still5;X["dumped5"]=d.dumped5;X["devSold5"]=d.devSold5;X["logPrior"]=np.log1p(d.priorLaunches);X["priorDumpShare"]=d.priorDumped/(d.priorLaunches+1);X["priorGrad"]=(d.priorGrad>0)*1
X["bundle15"]=(d.launchShare>=.15)*1;X["launchShare"]=d.launchShare.clip(0,1);X["devShare"]=d.devShare.clip(0,.3);X["logB1"]=np.log1p(d.buyers1m);X["logB5"]=np.log1p(d.buyers5)
X["insiders"]=((d.earlyHeld.fillna(0)>=.25)&(d.earlyWallets.fillna(0)>=2))*1;X["wash"]=d.washShare.fillna(0);X["crew2"]=(d.creatorCrew.fillna(0)>=2)*1;X["ring3"]=(d.ringWallets.fillna(0)>=3)*1
X["social"]=(d.nSocial>0)*1;X["mayhem"]=d.mayhem;X["funderEx"]=d.funderEx.fillna(0);X["funderMany"]=(d.funderDevs.fillna(0)>=3)*1
sig=lambda z:1/(1+np.exp(-z))
def sc(c,i,X=X): return sig(i+sum(X[k]*w for k,w in c.items()))
def rep(name,y,p):
    y=np.asarray(y);p=np.asarray(p)
    z=np.log(np.clip(p,1e-6,1-1e-6)/(1-np.clip(p,1e-6,1-1e-6))).reshape(-1,1)
    cal=LogisticRegression(C=1e6,max_iter=500).fit(z,y); o=np.argsort(-p); k=max(1,len(p)//10)
    print(f"{name:42s} n={len(y):6d} base={y.mean():.4f} AUC={auc(y,p):.3f} slope={cal.coef_[0][0]:.2f} predMean={p.mean():.4f} brier={brier(y,p):.4f} top10hit={y[o[:k]].mean():.3f}")
y=d.peakAfter5; pr=sc(RUN,RI)
print('\n# run target, SHIPPED coefficients on a cohort the fit never saw'); rep('all',y,pr)
m=d.still5==1; rep('only coins with trades after min 5',y[m],pr[m]); print('run rate still5=1',y[m].mean(),' still5=0',y[~m].mean(),'share still5',m.mean())
print('\n# one number alone (rank only)')
for n,v in [('still5',d.still5),('logB5 buyers by min5',X.logB5),('curve at min 5',d.curve5.fillna(0)),('trades per curve SOL',(d.trades5/(d.curve5.clip(lower=.01))).fillna(0)),('logB1',X.logB1)]:
    print(f"  {n:24s} AUC all={auc(y,v):.3f}  within still5={auc(y[m],v[m]) if v[m].nunique()>1 else float('nan'):.3f}")
# refit, older half to newer half, as the repo does
o=d.ageH.sort_values(ascending=False).index;c=len(o)//2;tr,te=o[:c],o[c:]
def fit(cols,y,tr=tr,te=te,mask=None):
    a=tr if mask is None else tr[mask.loc[tr]]; b=te if mask is None else te[mask.loc[te]]
    l=LogisticRegression(C=.5,max_iter=3000).fit(XX[cols].loc[a],y.loc[a]);return auc(y.loc[b],l.predict_proba(XX[cols].loc[b])[:,1])
XX=X.copy();XX['logSol5']=np.log1p(d.curve5.fillna(0).clip(lower=0))
full=list(X.columns);who=['logPrior','priorDumpShare','priorGrad','bundle15','launchShare','devShare','insiders','wash','crew2','ring3','social','mayhem','funderEx','funderMany','dumped5','devSold5']
print('\n# refit on this cohort, older half -> newer half')
print('  full 19',round(fit(full,y),3),' drop still5',round(fit([c for c in full if c!='still5'],y),3),' within still5, full',round(fit([c for c in full if c!='still5'],y,mask=m),3))
print('  activity only logB5+curve5',round(fit(['logB5','logSol5'],y),3),' within still5',round(fit(['logB5','logSol5'],y,mask=m),3))
print('  who only',round(fit(who,y),3),' within still5',round(fit(who,y,mask=m),3))
print('  full+curve5 within still5',round(fit([c for c in full if c!='still5']+['logSol5'],y,mask=m),3))
y2=d.dumpedLater;p2=sc(DD,DI)
print('\n# dev dumps, SHIPPED'); rep('all',y2,p2); n=d.dumped5==0; rep('dev had NOT dumped by min 5 (the real use)',y2[n],p2[n]); n2=n&m; rep('and trades after min 5',y2[n2],p2[n2])
print('share dumped5',d.dumped5.mean())
print('\n# calibration tenths, run, shipped');q=pd.qcut(pd.Series(pr).rank(method='first'),10,labels=False);print(pd.DataFrame({'p':pr,'y':y,'q':q}).groupby('q').agg(n=('y','size'),pred=('p','mean'),act=('y','mean')).round(4).to_string())
