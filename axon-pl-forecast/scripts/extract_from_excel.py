import openpyxl, json, re, sys
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI
src=sys.argv[1]
wb=openpyxl.load_workbook(src); wv=openpyxl.load_workbook(src,data_only=True)
pl=wb['P&L']; plv=wv['P&L']; g=wb['Gastos']; gv=wv['Gastos']
def num(x): return float(x) if isinstance(x,(int,float)) else 0.0
Y1=list(range(3,17)); Y2=list(range(18,30))
TOK={'=Gastos!$C$62/Gastos!$C$65':'DEV_GRUPO','=Gastos!$C$63/Gastos!$C$65':'DEV_MARCA','=Gastos!$C$64/Gastos!$C$65':'DEV_EUPH','=Gastos!$C$66*Gastos!$C$67':'MANT_GRUPO'}
def spec(ws,r,c):
    v=ws.cell(r,c).value
    if v is None: return 0
    if isinstance(v,(int,float)): return v
    if v in TOK: return TOK[v]
    m=re.fullmatch(r'=([A-Z]{1,2})(\d+)',v)
    if m and int(m.group(2))==r: return 'prev'
    raise Exception((r,c,v))
clients=[]
for r in range(5,52,2):
    name=pl.cell(r,2).value or ''
    clients.append({'name':name,
      'dev1':[num(plv.cell(r,c).value) for c in Y1],'mant1':[num(plv.cell(r+1,c).value) for c in Y1],
      'dev2':[spec(pl,r,c) for c in Y2],'mant2':[spec(pl,r+1,c) for c in Y2]})
y1={}
for key,r in dict(otros=53,ia=65,repos=67,host=69,plat=71,comis=73,go=79,ga=81,mkt=83,capex=85,otrosg=87,da=89,cif=98,isr=102).items():
    y1[key]=[num(plv.cell(r,c).value) for c in Y1]
months1=[str(pl.cell(2,c).value) for c in Y1]
# Gastos
def gspec(r,c,base='C'):
    v=g.cell(r,c).value
    if v is None: return 0
    if isinstance(v,(int,float)): return v
    m=re.fullmatch(r'=([A-Z])(\d+)(\*([\d.]+))?',v)
    if m and int(m.group(2))==r:
        col=m.group(1); k=float(m.group(4)) if m.group(4) else 1
        if col=='C': return {'t':'C','k':k}
        if CI(col)==c-1: return {'t':'prev','k':k}
    m=re.fullmatch(r'=([D-H])(\d+)\*\$C\$(\d+)',v)
    if m: return {'t':'hc'}
    raise Exception((r,c,v))
opex=[{'name':g.cell(r,2).value or f'Concepto {g.cell(r,1).value}','base':num(g.cell(r,3).value),'y':[gspec(r,c) for c in range(9,14)]} for r in range(7,14)]
admin=[{'name':g.cell(r,2).value,'sal':num(g.cell(r,3).value),'hc':[num(g.cell(r,c).value) for c in range(4,9)],'y':[gspec(r,c) for c in range(9,14)]} for r in range(20,31)]
mkt=[{'name':g.cell(r,2).value or f'Concepto {g.cell(r,1).value}','base':num(g.cell(r,3).value),'y':[gspec(r,c) for c in range(9,14)]} for r in range(37,44)]
P=lambda a: num(g[a].value)
params=dict(comision=P('C48'),isr=P('C50'),ptu=P('C51'),inflacion=P('C53'),iaPersona=P('C57'),repoEmpresa=P('C58'),hostEmpresa=P('C59'),platBase=P('C60'),platPersona=P('C61'),devGrupo=P('C62'),devMarca=P('C63'),devEuph=P('C64'),exhibiciones=P('C65'),mantAgencia=P('C66'),agenciasGrupo=P('C67'),otrosGastosY2=num(pl['R87'].value),empresasY1=num(pl['Q58'].value))
cb=wb['Crédito Bancario']
credito=dict(monto=num(cb['D3'].value),tasa=num(cb['D4'].value),plazo=num(cb['D7'].value))
va=wb['VALUACIÓN']
V=lambda a: num(va[a].value)
val=dict(bono=V('C6'),spread=V('C7'),betaU=V('C9'),dPeso=V('C10'),prima=V('C14'),pais=V('C15'),tamano=V('C18'),startup=V('C19'),da=V('C29'),capex=V('C30'),ct=V('C31'),g=V('C32'),caja=V('C33'),
  escenario=int(V('K5')),volBase=[V('K8'),V('L8'),V('M8')],volMeta=[V('K9'),V('L9'),V('M9')],precioBase=[V('K13'),V('L13'),V('M13')],precioMeta=[V('K14'),V('L14'),V('M14')],meta=V('K20'))
out=dict(months1=months1,months2=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'],clients=clients,y1=y1,opex=opex,admin=admin,mkt=mkt,params=params,credito=credito,val=val)
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False)
# expected values for test
exp={}
for r in [55,57,58,60,63,65,67,69,71,73,75,77,79,81,83,87,91,94,98,100,102,104,106]:
    exp[r]={L(c):plv.cell(r,c).value for c in range(3,34) if isinstance(plv.cell(r,c).value,(int,float))}
vv={a:wv['VALUACIÓN'][a].value for a in ['C25','C20','C13','C17','D50','E50','F50','G50','C61','C63','C65','C68','C70','C71','C72']}
vv['sensA']=[[wv['VALUACIÓN'].cell(r,c).value for c in range(4,9)] for r in range(77,82)]
vv['sensB']=[[wv['VALUACIÓN'].cell(r,c).value for c in range(4,9)] for r in range(85,90)]
gx={a:gv[a].value for a in ['I15','J15','K15','L15','M15','I32','J32','K32','L32','M32','I45','J45','K45','L45','M45','D32','E32','F32','G32','H32']}
json.dump(dict(pl=exp,val=vv,g=gx),open(sys.argv[3],'w'),default=str)
print('ok', len(clients))
