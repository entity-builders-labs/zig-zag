"""Strict subset parser for OSM opening_hours -> per-weekday windows, or None (UNKNOWN).
Supported: '24/7'; bare times '10:00-17:00' (= every day); rules 'Mo-Fr 09:00-18:00', 'Sa,Su 10:00-14:00,16:00-20:00', 'Tu off'/'closed',
rules separated by ';' (later rules override earlier days, OSM semantics), optional 'PH ...' rules ignored.
Anything else (months, dates, sunrise, '+', week numbers, comments) -> UNKNOWN."""
import re
DAYS=['Mo','Tu','We','Th','Fr','Sa','Su']
def _days(spec):
    out=[]
    for part in spec.split(','):
        part=part.strip()
        if re.fullmatch(r'(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)',part):
            a,b=part.split('-'); i,j=DAYS.index(a),DAYS.index(b)
            out+= [DAYS[(i+k)%7] for k in range(((j-i)%7)+1)]
        elif part in DAYS: out.append(part)
        else: return None
    return out
def _times(spec):
    w=[]
    for part in spec.split(','):
        m=re.fullmatch(r'(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})',part.strip())
        if not m: return None
        a=int(m[1])*60+int(m[2]); b=int(m[3])*60+int(m[4])
        if b==0: b=1440
        if b<=a: return None
        w.append((a,b))
    return w
def parse(value):
    if not value: return None
    v=value.strip()
    if v=='24/7': return {d:[(0,1440)] for d in DAYS}
    week={}
    for rule in [r.strip() for r in v.split(';') if r.strip()]:
        if rule.startswith('PH'): continue
        if re.fullmatch(r'[\d:,\- ]+',rule):
            rule='Mo-Su '+rule
        m=re.fullmatch(r'([A-Za-z,\-]+)\s+(.+)',rule)
        if not m: return None
        days=_days(m[1])
        if days is None: return None
        rest=m[2].strip()
        if rest in ('off','closed'): win=[]
        else:
            win=_times(rest)
            if win is None: return None
        for d in days: week[d]=win
    if not week: return None
    # days not mentioned are closed when a weekly pattern is given
    return {d:week.get(d,[]) for d in DAYS}
