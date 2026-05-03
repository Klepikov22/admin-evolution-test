# -*- coding: utf-8 -*-
import orjson, re, shutil, math
from pathlib import Path
from collections import OrderedDict
SRC=Path('/mnt/data/work_proj/admin-evolution-west-siberia')
OUT=Path('/mnt/data/admin-evolution-standardized')

def loads(p): return orjson.loads(Path(p).read_bytes())
def dumps(obj, indent=False):
    opt=orjson.OPT_NON_STR_KEYS
    if indent: opt|=orjson.OPT_INDENT_2
    return orjson.dumps(obj, option=opt)
def clean(v):
    if v is None: return None
    s=str(v).strip()
    if not s or s.lower() in {'none','null','nan','—','-'}: return None
    return re.sub(r'\s+',' ',s)
def num(v):
    if v is None or v=='': return None
    if isinstance(v,(int,float)) and not isinstance(v,bool): return v if math.isfinite(float(v)) else None
    try:
        x=float(str(v).replace('\u00a0',' ').replace(' ','').replace(',','.'))
        return int(x) if x.is_integer() else x
    except Exception: return None
def year(v):
    n=num(v)
    if n is None: return None
    y=int(round(float(n)))
    return y if 1500<=y<=2100 else None
def ft(p,ks):
    for k in ks:
        v=clean(p.get(k))
        if v: return v
    return None
def fn(p,ks):
    for k in ks:
        v=num(p.get(k))
        if v is not None: return v
    return None
UNC=[('unstable_control','неустойчивый контроль',re.compile(r'неустойчив\w*\s+контрол|нестабил\w*\s+контрол',re.I)),('disputed_control','спорный контроль',re.compile(r'спорн\w*\s+контрол',re.I)),('disputed_affiliation','спорная принадлежность',re.compile(r'спорн\w*(?:\s+\w+){0,3}\s+принадлеж|спорн\w+\s+территор|спорн\w+\s+статус',re.I)),('unclear_affiliation','неясная принадлежность',re.compile(r'неясн\w*(?:\s+\w+){0,3}\s+принадлеж|не\s*уточн\w*(?:\s+\w+){0,3}\s+принадлеж|неопредел\w*(?:\s+\w+){0,3}\s+принадлеж',re.I)),('unclear_boundary','неясные границы',re.compile(r'неясн\w*\s+границ|границ\w*\s+неясн|не\s*уточн\w*\s+границ|неопредел\w*\s+границ',re.I)),('transitional_zone','переходная территория',re.compile(r'территор\w*\s+переход|переходн\w+\s+территор',re.I))]
RANK={'normal':0,'disputed_affiliation':1,'unclear_affiliation':2,'unstable_control':3,'disputed_control':4,'unclear_boundary':5,'transitional_zone':6}
def uniq(a):
    o=[]
    for x in a:
        if x not in o: o.append(x)
    return o
def detect(p):
    hits=[]
    for k,v in p.items():
        if not isinstance(v,str): continue
        text=clean(v) or ''
        if not text: continue
        h=None
        for code,label,rx in UNC:
            if rx.search(text): h=(code,label,k,text); break
        if not h:
            low=text.lower()
            if 'спор' in low:
                code='disputed_control' if 'контрол' in low else 'disputed_affiliation'; h=(code,'спорный контроль' if code=='disputed_control' else 'спорная принадлежность',k,text)
            elif 'неустойчив' in low or 'нестабил' in low: h=('unstable_control','неустойчивый контроль',k,text)
            elif 'неяс' in low or 'не уточ' in low or 'неуточ' in low or 'неопредел' in low:
                code='unclear_boundary' if 'границ' in low else 'unclear_affiliation'; h=(code,'неясные границы' if code=='unclear_boundary' else 'неясная принадлежность',k,text)
        if h: hits.append(h)
    if not hits: return 0,'normal','обычный объект','', '',0
    hits=sorted(hits,key=lambda h:RANK.get(h[0],99)); code,label=hits[0][0],hits[0][1]
    return 1,code,label,'; '.join(uniq([h[2] for h in hits])),' | '.join(uniq([h[3] for h in hits])),RANK.get(code,99)
def conf(v,flag):
    if flag: return 'условная / требует проверки'
    s=clean(v)
    if not s: return 'не указана'
    return {'high':'высокая','medium':'средняя','med':'средняя','low':'низкая'}.get(s.lower(),s)
def infer_time(meta):
    sort=meta.get('sortYear'); yl=meta.get('yearLabel') or str(sort or '')
    yrs=meta.get('years') or ([sort] if isinstance(sort,int) else [])
    st=min(yrs) if yrs else sort; en=max(yrs) if yrs and max(yrs)!=min(yrs) else st
    if yl=='XVII век': st,en,sort=1600,1699,1650
    return st,en,sort,yl
def utype(name,cat,g):
    s=(name or '').lower()
    if cat=='settlements': return 'острог / пункт'
    if cat=='buffer': return 'буфер пункта'
    if cat=='stats': return 'статистическая точка'
    for key,label in [('район','район'),('уезд','уезд'),('округ','округ'),('губерн','губерния'),('област','область'),('провинц','провинция'),('волост','волость')]:
        if key in s: return label
    if 'зона' in s or 'территор' in s: return 'статусная зона'
    if 'горн' in s and 'ведом' in s: return 'горное ведомство'
    return 'точечный объект' if g=='Point' else 'административная единица'
STD=['feature_id','layer_id','source_layer','source_file','category','time_label','year','start_year','end_year','original_year','name','name_raw','admin_parent','admin_parent_raw','unit_type','capital','population','urban_population','rural_population','source','confidence','control_status','uncertainty_flag','uncertainty_code','uncertainty_label','uncertainty_rank','uncertainty_source_field','uncertainty_source_text','render_hatch','render_outline','geometry_type']
if OUT.exists(): shutil.rmtree(OUT)
(OUT/'data'/'layers').mkdir(parents=True); (OUT/'js').mkdir(); (OUT/'css').mkdir(); (OUT/'scripts').mkdir()
manifest=loads(SRC/'data'/'manifest.json')
new_layers=[]; uncs=[]
for meta in manifest['layers']:
    data=loads(SRC/meta['file'])
    lid=meta['id']; cat=meta['category']; title=meta['title']; st,en,sort,tl=infer_time(meta); uc=0
    for i,f in enumerate(data.get('features') or []):
        p=f.get('properties') or {}; g=(f.get('geometry') or {}).get('type') or 'null'
        rn=ft(p,['Name','Rayon','ADM2','Uezd','Vedomstvo','Other']); rp=ft(p,['Gov','Governorate','ADM1','Oblast','Okrug','Prov'])
        name=rn or rp or title or f'объект {i+1}'
        osy=year(p.get('Year')); sy=None; ey=None
        for k in ['Year_Start','Year_start','start_year','Start_Year']:
            sy=year(p.get(k))
            if sy: break
        for k in ['Year_end','Year_End','year_end','end_year','End_Year']:
            ey=year(p.get(k))
            if ey: break
        sy=sy or (osy if meta.get('timeKind')=='multi' and osy else st); ey=ey or (sy if en in (None,st) else en); yr=sy or sort
        flag,code,label,fields,text,rank=detect(p); uc+=flag
        fid=f'{lid}_{i+1:04d}'
        std={'feature_id':fid,'layer_id':lid,'source_layer':title,'source_file':meta.get('originalFile') or meta.get('sourceFile') or '', 'category':cat,'time_label':tl,'year':yr,'start_year':sy,'end_year':ey,'original_year':osy,'name':name,'name_raw':rn,'admin_parent':rp,'admin_parent_raw':rp,'unit_type':utype(name,cat,g),'capital':ft(p,['Cap','Capital']),'population':fn(p,['Pop','population','Population']),'urban_population':fn(p,['Pop_Urban','Pop_urban','urban_population','urban_pop']),'rural_population':fn(p,['Pop_non_urban','rural_population','rural_pop']),'source':ft(p,['Source','source','Notes']),'confidence':conf(ft(p,['Confidence']),flag),'control_status':'обычный объект' if not flag else label,'uncertainty_flag':flag,'uncertainty_code':code,'uncertainty_label':label,'uncertainty_rank':rank,'uncertainty_source_field':fields,'uncertainty_source_text':text,'render_hatch':1 if flag and g in ('Polygon','MultiPolygon') else 0,'render_outline':'none' if flag and g in ('Polygon','MultiPolygon') else 'normal','geometry_type':g}
        for k,v in p.items(): std['orig_'+k]=v
        f['properties']=std
        if flag: uncs.append({'layer_id':lid,'feature_id':fid,'sort_year':sort,'time_label':tl,'name':name,'status_code':code,'status_label':label,'source_field':fields,'source_text':text,'source_layer':title})
    data['metadata']={'layer_id':lid,'title':title,'category':cat,'timeLabel':tl,'sortYear':sort,'featureCount':len(data.get('features') or []),'uncertaintyCount':uc,'standardizedFields':STD}
    out=OUT/meta['file']; out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(dumps(data))
    nm=dict(meta); nm.update({'timeLabel':tl,'startYear':st,'endYear':en,'sortYear':sort,'uncertaintyCount':uc,'standardizedFields':STD})
    # Cheap field list: standard fields first + originals from old metadata
    orig_names=[f['name'] for f in meta.get('fields',[]) if f.get('name')]
    nm['fields']=[{'name':k,'type':'standardized','filled':None,'fillRate':None,'samples':[]} for k in STD] + [{'name':'orig_'+k,'type':'original','filled':None,'fillRate':None,'samples':[]} for k in orig_names]
    new_layers.append(nm)
uncs=sorted(uncs,key=lambda x:(x['sort_year'],RANK.get(x['status_code'],99),x['name']))
(OUT/'data'/'uncertainty_index.json').write_bytes(dumps(uncs, True))
manifest.update({'title':'Эволюция административной сетки Западной Сибири — стандартизированный тестовый просмотрщик','version':'2.0-standardized','generatedFrom':'GeoJSON_Ocean_5M.zip + normalized attributes','generatedAt':'2026-05-03','featureCount':sum(m['featureCount'] for m in new_layers),'uncertaintyFeatureCount':len(uncs),'standardizedFields':STD,'uncertaintyLabels':{k:v for k,v,_ in UNC}|{'normal':'обычный объект'},'categoryLabels':{'admin':'Административные границы','stats':'Статистика / население','settlements':'Остроги / пункты','points':'Точечные слои','buffer':'Буферы','special':'Спец. ведомства'},'layers':new_layers})
(OUT/'data'/'manifest.json').write_bytes(dumps(manifest, True))
print('done',len(new_layers),len(uncs))
