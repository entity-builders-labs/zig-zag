"""Derive the traversal-validator thresholds from the labelled raw metrics (G2).
Each distance threshold = midpoint of the observed gap between the largest positive
and the smallest negative that the condition is responsible for, floored to 0.1 m
(flooring moves the boundary toward the positives: fail-closed). Order uses the sign
of forward progress (the natural boundary); backtracking reuses the coverage tolerance."""
import json, os, math
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
r=json.load(open(os.path.join(ROOT,'raw_metrics.json')))
lab=[x for x in r if x['gt'] in ('VALID','CONSTRAINT_UNSATISFIED') and not x.get('empty_output')]
pos=[x for x in lab if x['gt']=='VALID']; neg=[x for x in lab if x['gt']=='CONSTRAINT_UNSATISFIED']
def floor1(v): return math.floor(v*10)/10
def gap(pos_vals,neg_vals):
    pmax=max(pos_vals); nmin=min(neg_vals); return pmax,nmin,(floor1((pmax+nmin)/2) if nmin>pmax else None)
# coverage responsibility: every negative that does not cover the segment = all non-reversed negatives
# coverage responsibility: negatives that do not own every required node (ground truth)
cov=gap([x['req_to_out_max_m'] for x in pos],[x['req_to_out_max_m'] for x in neg if (lambda e:e and e.get('required_nodes_owned') and e['required_nodes_owned'].split('/')[0]!=e['required_nodes_owned'].split('/')[1])(x.get('gt_evidence'))])
# on-segment responsibility: negatives whose output structurally leaves the required ways
# (ground truth found off-required points); negatives that stay on the segment but stop
# early or run backwards are the coverage/order conditions' responsibility
on=gap([x['out_to_req_max_m'] for x in pos],[x['out_to_req_max_m'] for x in neg if (x.get('gt_evidence') or {}).get('off_required_points',0)>0])
policy={'version':'traversal-validator-v1','calibration_dataset':'g2-2026-10-12',
 'max_required_to_output_m':cov[2],'max_output_to_required_m':on[2],
 'forward_progress':'> 0 (end projects after start along the required segment)',
 'max_backtrack_m':cov[2],'max_unmatched_points':max(x['unmatched_points'] or 0 for x in pos),
 'evidence':{'coverage':{'positive_max':cov[0],'negative_min':cov[1]},'on_segment':{'positive_max':on[0],'negative_min':on[1]},
   'forward_ratio':{'positive_min':round(min(x['forward_progress_m']/x['req_len_m'] for x in pos),4),'negative_max_reversed':round(max(x['forward_progress_m']/x['req_len_m'] for x in neg if x['kind']=='REVERSED'),4)},
   'backtrack_m':{'positive_max':max(x['backtrack_m'] for x in pos),'negative_min_reversed':min(x['backtrack_m'] for x in neg if x['kind']=='REVERSED')},
   'unmatched_points':{'positive_max':max(x['unmatched_points'] or 0 for x in pos),'negative_max':max(x['unmatched_points'] or 0 for x in neg),'note':'not exercised by any negative; kept as fail-closed guard at the positive maximum'}}}
def classify(x,p=policy):
    if x.get('empty_output'): return 'CONSTRAINT_UNSATISFIED'
    ok=(x['req_to_out_max_m']<=p['max_required_to_output_m'] and x['out_to_req_max_m']<=p['max_output_to_required_m']
        and x['forward_progress_m']>0 and x['backtrack_m']<=p['max_backtrack_m'] and (x['unmatched_points'] or 0)<=p['max_unmatched_points'])
    return 'VALID' if ok else 'CONSTRAINT_UNSATISFIED'
for x in r: x['classified']=classify(x)
fp=[x['output_id'] for x in lab if x['gt']=='CONSTRAINT_UNSATISFIED' and x['classified']=='VALID']
fn=[x['output_id'] for x in lab if x['gt']=='VALID' and x['classified']!='VALID']
# which condition rejects each negative (first failing)
def reason(x,p=policy):
    rs=[]
    if x['req_to_out_max_m']>p['max_required_to_output_m']: rs.append('coverage')
    if x['out_to_req_max_m']>p['max_output_to_required_m']: rs.append('on_segment')
    if x['forward_progress_m']<=0: rs.append('order')
    if x['backtrack_m']>p['max_backtrack_m']: rs.append('backtrack')
    return rs
from collections import Counter
rej=Counter(tuple(reason(x)) for x in neg)
per_provider={}
for prov in sorted({x['provider'] for x in lab}):
    ps=[x for x in pos if x['provider']==prov]; ns=[x for x in neg if x['provider']==prov]
    per_provider[prov]={'positives':len(ps),'negatives':len(ns),
        'pos_req_to_out_max':max((x['req_to_out_max_m'] for x in ps),default=None),'pos_out_to_req_max':max((x['out_to_req_max_m'] for x in ps),default=None),
        'neg_req_to_out_min_nonreversed':min((x['req_to_out_max_m'] for x in ns if x['kind']!='REVERSED'),default=None),
        'false_positives':sum(1 for x in ns if x['classified']=='VALID'),'false_negatives':sum(1 for x in ps if x['classified']!='VALID')}
summary={'segments':len({x['case'] for x in r}),'by_city':dict(Counter(x['city'] for x in {x['case']:x for x in r}.values())),
 'outputs':len(r),'labelled':len(lab),'positives':len(pos),'negatives':len(neg),'excluded':len(r)-len(lab),
 'negatives_by_kind':dict(Counter(x['kind']+('@'+x['provider']) for x in neg)),
 'positives_by_kind':dict(Counter(x['kind']+('@'+x['provider']) for x in pos)),
 'false_positives':fp,'false_negatives':fn,'rejection_conditions':{'+'.join(k) if k else 'NONE':v for k,v in rej.items()},
 'per_provider':per_provider,'san_telmo':[{'output_id':x['output_id'],'gt':x['gt'],'classified':x['classified'],'req_to_out':x['req_to_out_max_m'],'out_to_req':x['out_to_req_max_m']} for x in r if x['case']=='BA-00' and x['kind']=='REQUIRED']}
json.dump({'policy':policy,'summary':summary},open(os.path.join(ROOT,'calibration.json'),'w'),indent=1)
json.dump(r,open(os.path.join(ROOT,'raw_metrics.json'),'w'),indent=1)
print(json.dumps({'policy':policy,'summary':summary},indent=1))
