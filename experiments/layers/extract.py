#!/usr/bin/env python3
"""Extract a trimmed corpus from the real Timeline data into data.js"""
import json, re, ast, os
ROOT = "/Users/michalkucera/Documents/CODE/timeline"
OUT  = os.path.join(ROOT, "experiments/layers")

ds  = json.load(open(f"{ROOT}/web/public/data/datasets.json"))
rel = json.load(open(f"{ROOT}/web/public/data/relations.json"))
lanes = json.load(open(f"{ROOT}/data/lanes.json"))

CATMAP = ds["CATMAP"]

# ---- parse EVENTS out of events.ts -----------------------------------------
src = open(f"{ROOT}/web/src/data/events.ts").read()
body = src.split("export const EVENTS: TLEvent[] = [",1)[1].split("\n];",1)[0]
EVENTS = []
for line in body.splitlines():
    line = line.strip().rstrip(",")
    if not line.startswith("["): continue
    try: EVENTS.append(ast.literal_eval(line))
    except Exception as ex: print("skip", line[:60], ex)
print("events parsed:", len(EVENTS))

LIVES = ds["LIVES"]

def cat_of(title, fallback="power"):
    v = CATMAP.get(title)
    return v[0] if v else fallback
def kind_of(title, fallback="moment"):
    v = CATMAP.get(title)
    return v[1] if v else fallback

def ev_item(e, catfb="power"):
    s,en,t,band,imp,tags = e[0],e[1],e[2],e[3],e[4],e[5]
    return {"t":t,"s":s,"e":en or 0,"c":cat_of(t,catfb),"i":imp,"k":kind_of(t,"moment"),"g":tags}

def life_item(l):
    s,en,t,band,imp,tags = l
    return {"t":t,"s":s,"e":en,"c":cat_of(t,"society"),"i":imp,"k":"life","g":tags}

def span(name,s,e,c,i,tags="",k="span"):
    return {"t":name,"s":s,"e":e,"c":c,"i":i,"k":k,"g":tags}

def band(b): return [ev_item(e) for e in EVENTS if e[3]==b]
def tagged(words, pool=None):
    pool = pool if pool is not None else EVENTS
    out=[]
    for e in pool:
        tg=(e[5] or "")+" "+e[2].lower()
        if any(w in tg.lower() for w in words): out.append(ev_item(e))
    return out

EU = [e for e in EVENTS if e[3]=="EU"]
def eu_cat(cats):
    return [ev_item(e) for e in EU if cat_of(e[2]) in cats]

# --- topic layers -----------------------------------------------------------
T = {}
T["eu-ess"]  = ("Europe · Essentials",   "power",  eu_cat({"power","society","reach","nature"})
                                                  + [life_item(l) for l in LIVES if l[3]=="EU" and cat_of(l[2],"society") in ("power","society","reach")])
T["eu-sci"]  = ("Europe · Science",      "sci",    eu_cat({"sci"}) + [ev_item(e) for e in EVENTS if e[3]=="SC"]
                                                  + [life_item(l) for l in LIVES if cat_of(l[2],"sci")=="sci"])
T["eu-war"]  = ("Europe · Wars",         "war",    eu_cat({"war"}))
T["eu-art"]  = ("Europe · Art & culture","art",    eu_cat({"art","belief"}))
T["as-ess"]  = ("Asia · Essentials",     "power",  band("AS") + [life_item(l) for l in LIVES if l[3]=="AS"])
T["as-dyn"]  = ("Asia · Dynasties",      "power",  [span(p["name"],p["start"],p["end"],"power",3,p.get("note",""))
                                                   for p in ds["POLIS"] if p["region"]=="AS"])
T["deep"]    = ("Deep time",             "nature", band("CO"))
T["arts"]    = ("Arts movements",        "art",    [span(m["name"],m["start"],m["end"],m.get("cat","art"),m.get("imp",4),m.get("note","")) for m in lanes["lanes"][0]["members"]])
T["design"]  = ("Design",                "art",    [span(m["name"],m["start"],m["end"],m.get("cat","art"),m.get("imp",4),m.get("note","")) for m in lanes["lanes"][1]["members"]])
T["mozart"]  = ("Mozart",                "art",    band("MZ"))

# --- library layers ---------------------------------------------------------
relig = [s for s in ds["BELIEF"]["systems"] if s["id"]=="religion"][0]["streams"]
ideo  = [s for s in ds["BELIEF"]["systems"] if s["id"]=="ideology"][0]["streams"]
L = {}
L["religion"]= ("Religion",     "belief", [span(s["name"],s["start"],s["end"],"belief",3,s.get("note","")) for s in relig if s["end"]-s["start"]>60][:34]
                                          + [ev_item(e) for e in EVENTS if cat_of(e[2])=="belief"])
L["ideology"]= ("Ideologies",   "society",[span(s["name"],s["start"],s["end"],"society",3,s.get("note","")) for s in ideo])
L["tech"]    = ("Technology",   "sci",    [span(s["name"],s["start"],s["end"],"sci",2,s.get("kind","")) for s in rel["spreads"] if s["kind"] in ("technology","economy")]
                                          + tagged(["printing","steam","electric","comput","internet","telegraph","railway","rocket","atomic","nuclear"]))
L["wars"]    = ("Wars (world)", "war",    [ev_item(e) for e in EVENTS if cat_of(e[2])=="war" and e[3]!="EU"]
                                          + [ev_item(e) for e in EVENTS if cat_of(e[2])=="war" and e[3]=="EU" and e[4]<=3])
L["explore"] = ("Exploration",  "reach",  [ev_item(e) for e in EVENTS if cat_of(e[2])=="reach"]
                                          + [span(s["name"],s["start"],s["end"],"reach",2,"") for s in rel["spreads"] if s["id"] in ("silk-road","columbian-exchange","atlantic-slave-trade")])
L["philos"]  = ("Philosophy",   "belief", tagged(["philosoph","enlighten","humanism"]) + [life_item(l) for l in LIVES if "philosoph" in (l[5] or "")]
                                          + [span(s["name"],s["start"],s["end"],"belief",2,"") for s in rel["spreads"] if s["id"] in ("enlightenment","renaissance","scientific-revolution")])
L["liter"]   = ("Literature",   "art",    tagged(["literature","theatre","poet","novel","writing","print"]) + [life_item(l) for l in LIVES if "literature" in (l[5] or "")])
L["music"]   = ("Music",        "art",    band("MU") + [life_item(l) for l in LIVES if l[3]=="MU"])
L["medicine"]= ("Medicine",     "sci",    tagged(["plague","pandemic","medic","vaccin","disease","penicillin","dna","genome"])
                                          + [span(s["name"],s["start"],s["end"],"sci",2,"") for s in rel["spreads"] if s["id"]=="vaccination"])
L["czech"]   = ("Czech history","power",  tagged(["czech","prague","bohemia","hus"]) + [life_item(l) for l in LIVES if "czech" in (l[5] or "")])
L["america"] = ("Americas · Essentials","power", band("AM") + [life_item(l) for l in LIVES if l[3]=="AM"])
L["mideast"] = ("Middle East · Essentials","power", band("ME") + [life_item(l) for l in LIVES if l[3]=="ME"])

KIND = {"mozart":"person","arts":"movements","design":"movements","as-dyn":"movements",
        "tech":"movements","religion":"movements","ideology":"movements","music":"movements"}

def pack(d):
    out={}
    for k,(name,cat,items) in d.items():
        seen=set(); clean=[]
        if k=="mozart":   # a person layer needs the lifespan bar itself
            clean.append({"t":"Wolfgang Amadeus Mozart","s":1756,"e":1791,"c":"art","i":1,"k":"life","g":"lifespan","life":1})
            seen.add("Wolfgang Amadeus Mozart")
        for it in items:
            if it["t"] in seen: continue
            seen.add(it["t"])
            it = dict(it); it["g"]=(it.get("g") or "")[:90]
            clean.append(it)
        clean.sort(key=lambda x:x["s"])
        out[k]={"name":name,"cat":cat,"kind":KIND.get(k,"region"),"items":clean}
    return out

DATA={"topics":pack(T),"library":pack(L)}
n=sum(len(v["items"]) for v in list(DATA["topics"].values())+list(DATA["library"].values()))
for k,v in DATA["topics"].items(): print(f"  topic {k:9s} {len(v['items']):4d}  {v['name']}")
for k,v in DATA["library"].items(): print(f"  lib   {k:9s} {len(v['items']):4d}  {v['name']}")
print("TOTAL items:", n)
open(f"{OUT}/data.js","w").write("window.TLDATA=" + json.dumps(DATA, ensure_ascii=False, separators=(",",":")) + ";\n")
print("wrote data.js", os.path.getsize(f"{OUT}/data.js"), "bytes")
