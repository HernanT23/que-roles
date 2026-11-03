import { createClient } from '@supabase/supabase-js';

(function(){
'use strict';
var TOPS=['Glaseado de queso crema','Choconutella','Arequipe','Chocolate blanco','Oreo en trozos','Pistacho','Coco'];
var ACC=[{id:'pm',name:'Pago móvil',cur:'Bs'},{id:'usd',name:'Efectivo $',cur:'USD'},{id:'bs',name:'Efectivo Bs',cur:'Bs'}];
var CATS=['Ingredientes','Empaques','Transporte','Gas y servicios','Otros'];
var DOW=['dom','lun','mar','mié','jue','vie','sáb'], MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
var DEF={rate:0,rateDate:'',price:5.5};
var SB=null,ORG=null,TZ='America/Caracas';
var S={db:null,web:[],dl:true,state:'loading',set:Object.assign({},DEF),cust:[],sales:[],pays:[],exps:[],loaded:{},tab:'resumen',viewTab:null,fSales:'todas',qSales:'',qCust:'',per:'mes',sheet:null,dl:null};
var F=null;

/* utilidades */
function $(s,r){return (r||document).querySelector(s);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){var n=parseFloat(String(v==null?'':v).replace(/\s/g,'').replace(',','.'));return isFinite(n)?n:0;}
function r2(n){return Math.round(n*100)/100;}
function fmtN(n,d){var p=Math.abs(n).toFixed(d).split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,'.');return (n<0?'-':'')+(d?p[0]+','+p[1]:p[0]);}
function usd(n){return (n<0?'-':'')+'$'+Math.abs(r2(n)).toFixed(2);}
function bs(n){return 'Bs '+fmtN(n,2);}
function pad(n){return n<10?'0'+n:''+n;}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function dayOf(d){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function today(){return dayOf(new Date());}
function addDays(s,n){var d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return ymd(d);}
function fDay(s){if(!s)return '';var d=new Date(s+'T00:00:00');return DOW[d.getDay()]+' '+d.getDate()+' '+MES[d.getMonth()];}
function rate(){return num(S.set.rate)||DEF.rate;}
function acc(id){return ACC.filter(function(a){return a.id===id;})[0]||ACC[0];}
function phoneWa(p){var d=String(p||'').replace(/\D/g,'');if(!d)return '';if(d[0]==='0')d='58'+d.slice(1);return d;}
function toast(msg,err){var t=$('#toast');t.textContent=msg;t.className='toast'+(err?' err':'');t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(function(){t.hidden=true;},err?5000:2600);}
function guard(){if(!SB||!ORG){toast('Sin conexión con tus datos. Recarga la página.',true);return false;}return true;}
function errMsg(e){return (e&&e.message)||'error';}
function byNew(a,b){return String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''));}

/* calculos */
function calc(){
  var paid={};S.pays.forEach(function(p){paid[p.saleId]=r2((paid[p.saleId]||0)+num(p.amountUSD));});
  var act=S.sales.filter(function(s){return s.status!=='anulada';});
  return {paid:paid,act:act};
}
function bal(s,c){return Math.max(0,r2(num(s.totalUSD)-(c.paid[s.id]||0)));}
function summary(s){return (s.items||[]).map(function(i){return i.kind==='paquete'?i.qty+(i.qty===1?' paquete':' paquetes'):(i.qty>1?i.qty+' ':'')+i.name;}).join(', ');}
function accBal(id){
  var a=acc(id),k=a.cur==='Bs'?'amountBs':'amountUSD',t=0;
  S.pays.forEach(function(p){if(p.account===id)t+=num(p[k]);});
  S.exps.forEach(function(e){if(e.account===id)t-=num(e[k]);});
  return r2(t);
}
function perStart(){var t=today();if(S.per==='hoy')return t;if(S.per==='7d')return addDays(t,-6);if(S.per==='mes')return t.slice(0,8)+'01';return '0000-00-00';}
function perLabel(){return {hoy:'hoy','7d':'últimos 7 días',mes:'este mes',todo:'todo el tiempo'}[S.per];}

/* insignias */
function payBadge(s,c){
  if(s.status==='anulada')return '<span class="badge b-mute">Anulada</span>';
  var b=bal(s,c);
  if(b<=0)return '<span class="badge b-ok">Pagado</span>';
  if((c.paid[s.id]||0)>0)return '<span class="badge b-warn">Debe '+usd(b)+'</span>';
  return '<span class="badge b-bad">Sin pagar '+usd(b)+'</span>';
}
function delBadge(s){
  if(s.status==='anulada')return '';
  if(s.delivered)return '<span class="badge b-ok">Entregado</span>';
  var late=s.dueDate&&s.dueDate<today();
  return '<span class="badge '+(late?'b-bad':'b-warn')+'">'+(late?'Atrasado · ':'Por entregar ')+(s.dueDate?fDay(s.dueDate):'')+'</span>';
}
function saleRow(s,c){
  return '<button type="button" class="row" data-act="sale" data-id="'+esc(s.id)+'"><div class="r1"><b>'+esc(s.customerName||'Sin nombre')+'</b><span class="amt">'+usd(num(s.totalUSD))+'</span></div>'+
    '<div class="r2">'+esc(summary(s))+'</div><div class="r3">'+payBadge(s,c)+delBadge(s)+(s.delivery==='Domicilio'?'<span class="badge b-mute">Domicilio</span>':'')+'<span class="bsx">'+fDay(s.date)+'</span></div></button>';
}

/* cabecera */
function renderHeader(){
  var old=S.set.rateDate!==today();
  var b=$('#ratebtn');b.className='ratebtn'+(old?' old':'');
  $('#rl').textContent=!S.set.rateDate?'Falta la tasa':(old?'Tasa del '+fDay(S.set.rateDate)+', actualiza':'Tasa BCV de hoy');
  $('#rv').textContent=bs(rate());
  Array.prototype.forEach.call(document.querySelectorAll('.nav [data-t]'),function(el){if(el.dataset.t===S.tab)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
}
function banner(){
  if(S.state==='nodb')return '<div class="banner alert bad">No hay conexión con el almacenamiento. Abre la página desde tu cuenta de Claude para ver y guardar tus datos.</div>';
  if(S.state==='slow')return '<div class="banner alert">Tarda en conectar con tus datos. Lo que ves puede no estar al día.</div>';
  if(S.state==='error')return '<div class="banner alert bad">No se pudieron leer tus datos. Cierra y vuelve a abrir la página.</div>';
  return '';
}
function loading(){return S.state==='loading'&&!(S.loaded.sales);}

/* vistas */
function renderView(){
  var v=$('#view');
  if(S.tab==='ventas'||S.tab==='clientes'){
    if(S.viewTab===S.tab&&$('#lst')){fillList();return;}
  }
  S.viewTab=S.tab;
  v.innerHTML=banner()+({resumen:viewResumen,ventas:viewVentas,clientes:viewClientes,cuentas:viewCuentas}[S.tab])();
  if(S.tab==='ventas'||S.tab==='clientes')fillList();
}
function viewResumen(){
  var c=calc(),t=today(),h='';
  if(loading())return '<p class="muted">Cargando tus datos…</p>';
  if(S.set.rateDate!==t)h+='<div class="banner alert">La tasa es del '+fDay(S.set.rateDate)+'. <button class="btn sm gold" data-act="rate" type="button">Actualizar tasa</button></div>';
  var sold=0,cnt=0,col=0,gas=0,porCobrar=0;
  c.act.forEach(function(s){if(s.date===t){sold+=num(s.totalUSD);cnt++;}porCobrar+=bal(s,c);});
  S.pays.forEach(function(p){if(p.date===t)col+=num(p.amountUSD);});
  S.exps.forEach(function(e){if(e.date===t)gas+=num(e.amountUSD);});
  h+='<div class="pagehd"><h1>Hoy</h1><span class="muted">'+fDay(t)+'</span></div>';
  if(!S.sales.length){
    return h+'<div class="empty" style="margin-top:14px"><h3>Aún no hay ventas</h3><p>Registra la primera venta y aquí verás lo vendido, lo cobrado y lo que falta por entregar.</p><button class="btn gold" data-act="newsale" type="button">Registrar primera venta</button></div>';
  }
  h+='<div class="kpis" style="margin-top:12px"><div class="kpi main"><small>Vendido hoy ('+cnt+(cnt===1?' venta':' ventas')+')</small><b>'+usd(sold)+'</b><span>'+bs(sold*rate())+'</span></div>'+
     '<div class="kpi"><small>Cobrado hoy</small><b>'+usd(col)+'</b></div><div class="kpi"><small>Gastos hoy</small><b>'+usd(gas)+'</b></div>'+
     '<div class="kpi" style="grid-column:span 2"><small>Por cobrar en total</small><b>'+usd(porCobrar)+'</b><span>'+(porCobrar>0?'Pagos pendientes de clientes':'Todo cobrado')+'</span></div></div>';
  /* por entregar y produccion */
  var pend=c.act.filter(function(s){return !s.delivered;}).sort(function(a,b){return String(a.dueDate||a.date).localeCompare(String(b.dueDate||b.date));});
  h+='<div class="sec"><h2>Por entregar</h2>';
  if(!pend.length)h+='<p class="muted" style="margin:0">No hay entregas pendientes.</p>';
  else{
    var tops={},rolls=0;pend.forEach(function(s){(s.items||[]).forEach(function(i){if(i.kind==='paquete')rolls+=i.qty*3;});Object.keys(s.toppings||{}).forEach(function(k){tops[k]=(tops[k]||0)+s.toppings[k];});});
    var tl=Object.keys(tops).sort(function(a,b){return tops[b]-tops[a];}).map(function(k){return tops[k]+' '+esc(k);}).join(', ');
    if(rolls||tl)h+='<div class="card" style="margin-bottom:10px"><b>Por preparar: '+rolls+' roles</b>'+(tl?'<div class="muted" style="margin-top:4px">'+tl+'</div>':'')+'</div>';
    h+='<div class="list">'+pend.slice(0,6).map(function(s){return saleRow(s,c);}).join('')+'</div>';
    if(pend.length>6)h+='<p class="muted">y '+(pend.length-6)+' más en Ventas.</p>';
  }
  h+='</div>';
  /* grafica 7 dias */
  var days=[];for(var i=6;i>=0;i--)days.push(addDays(t,-i));
  var vals=days.map(function(d){return r2(c.act.reduce(function(a,s){return a+(s.date===d?num(s.totalUSD):0);},0));});
  h+='<div class="sec"><h2>Ventas de los últimos 7 días</h2><div class="card">'+chart(days,vals,t)+'</div></div>';
  h+='<p class="muted" style="margin-top:22px"><a href="/admin/avanzado/">Inventario y producción</a></p>';
  return h;
}
function chart(days,vals,t){
  var W=640,H=210,pl=10,pr=10,pt=26,pb=34,max=Math.max.apply(null,vals.concat([1])),bw=(W-pl-pr)/days.length,s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ventas por día en dólares">';
  s+='<line class="base" x1="0" x2="'+W+'" y1="'+(H-pb)+'" y2="'+(H-pb)+'"/>';
  vals.forEach(function(v,i){
    var h=(H-pt-pb)*v/max,x=pl+i*bw+bw*0.18,w=bw*0.64,y=H-pb-h;
    s+='<rect class="bar'+(days[i]===t?' today':'')+'" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(h,v>0?2:0).toFixed(1)+'" rx="5"/>';
    if(v>0)s+='<text class="v" x="'+(x+w/2).toFixed(1)+'" y="'+(y-6).toFixed(1)+'" text-anchor="middle">$'+(v%1?v.toFixed(1):v)+'</text>';
    var d=new Date(days[i]+'T00:00:00');
    s+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-pb+18)+'" text-anchor="middle">'+DOW[d.getDay()]+' '+d.getDate()+'</text>';
  });
  return s+'</svg>';
}
function viewVentas(){
  return '<div class="pagehd"><h1>Ventas</h1><button class="btn gold sm" data-act="newsale" type="button">Nueva venta</button></div>'+
   '<input class="search" id="qs" type="search" placeholder="Buscar por cliente" value="'+esc(S.qSales)+'" style="margin-top:12px" aria-label="Buscar venta por cliente">'+
   '<div id="webbox" style="margin-top:14px"></div><div class="chips" role="group" aria-label="Filtro de ventas">'+[['todas','Todas'],['hoy','Hoy'],['entregar','Por entregar'],['cobrar','Por cobrar']].map(function(f){return '<button class="chip" type="button" data-act="fsale" data-v="'+f[0]+'" aria-pressed="'+(S.fSales===f[0])+'">'+f[1]+'</button>';}).join('')+'</div><div class="list" id="lst"></div>';
}
function viewClientes(){
  return '<div class="pagehd"><h1>Clientes</h1><button class="btn gold sm" data-act="newcust" type="button">Nuevo cliente</button></div>'+
   '<input class="search" id="qc" type="search" placeholder="Buscar por nombre o teléfono" value="'+esc(S.qCust)+'" style="margin-top:12px" aria-label="Buscar cliente"><div class="list" id="lst" style="margin-top:12px"></div>';
}
function fillList(){
  var el=$('#lst');if(!el)return;
  if(loading()){el.innerHTML='<p class="muted">Cargando tus datos…</p>';return;}
  var c=calc(),t=today();
  if(S.tab==='ventas'){
    var wb=$('#webbox');if(wb)wb.innerHTML=webHtml();
    Array.prototype.forEach.call(document.querySelectorAll('[data-act=fsale]'),function(b){b.setAttribute('aria-pressed',String(b.dataset.v===S.fSales));});
    var q=S.qSales.trim().toLowerCase();
    var l=S.sales.slice().sort(byNew).filter(function(s){
      if(q&&String(s.customerName||'').toLowerCase().indexOf(q)<0)return false;
      if(S.fSales==='hoy')return s.date===t&&s.status!=='anulada';
      if(S.fSales==='entregar')return s.status!=='anulada'&&!s.delivered;
      if(S.fSales==='cobrar')return s.status!=='anulada'&&bal(s,c)>0;
      return true;});
    el.innerHTML=l.length?l.map(function(s){return saleRow(s,c);}).join(''):(S.sales.length?'<div class="empty"><p style="margin:0">No hay ventas con ese filtro.</p></div>':'<div class="empty"><h3>Sin ventas todavía</h3><p>Cuando registres una venta aparecerá aquí con su estado de pago y de entrega.</p><button class="btn gold" data-act="newsale" type="button">Registrar venta</button></div>');
  }else{
    var q2=S.qCust.trim().toLowerCase().replace(/\s+/g,' ');
    var rows=S.cust.map(function(cu){
      var ss=c.act.filter(function(s){return s.customerId===cu.id;}),tot=0,deb=0;
      ss.forEach(function(s){tot+=num(s.totalUSD);deb+=bal(s,c);});
      return {cu:cu,n:ss.length,tot:r2(tot),deb:r2(deb)};
    }).filter(function(r){return !q2||(r.cu.name||'').toLowerCase().indexOf(q2)>=0||String(r.cu.phone||'').replace(/\D/g,'').indexOf(q2.replace(/\D/g,'')||'§')>=0;})
      .sort(function(a,b){return b.deb-a.deb||b.tot-a.tot||(a.cu.name||'').localeCompare(b.cu.name||'');});
    el.innerHTML=rows.length?rows.map(function(r){
      return '<button type="button" class="row" data-act="cust" data-id="'+esc(r.cu.id)+'"><div class="r1"><b>'+esc(r.cu.name)+'</b><span class="amt">'+usd(r.tot)+'</span></div><div class="r2">'+esc(r.cu.phone||'Sin teléfono')+'</div><div class="r3"><span class="badge b-mute">'+r.n+(r.n===1?' compra':' compras')+'</span>'+(r.deb>0?'<span class="badge b-warn">Debe '+usd(r.deb)+'</span>':'')+'</div></button>';}).join(''):
      (S.cust.length?'<div class="empty"><p style="margin:0">Ningún cliente coincide.</p></div>':'<div class="empty"><h3>Sin clientes todavía</h3><p>Los clientes se guardan solos al registrar una venta. También puedes agregarlos a mano.</p><button class="btn gold" data-act="newcust" type="button">Agregar cliente</button></div>');
  }
}
function movs(){
  var from=perStart(),m=[];
  S.pays.forEach(function(p){if(p.date>=from)m.push({k:'in',id:p.id,date:p.date,at:p.createdAt||'',title:'Pago de '+(p.customerName||'cliente'),sub:acc(p.account).name+(p.ref?' · ref. '+p.ref:''),a:num(p.amountUSD),bs:num(p.amountBs),cur:acc(p.account).cur});});
  S.exps.forEach(function(e){if(e.date>=from)m.push({k:'out',id:e.id,date:e.date,at:e.createdAt||'',title:e.concept||'Gasto',sub:(e.category||'Otros')+' · '+acc(e.account).name,a:num(e.amountUSD),bs:num(e.amountBs),cur:acc(e.account).cur});});
  return m.sort(function(a,b){return String(b.date+b.at).localeCompare(String(a.date+a.at));});
}
function viewCuentas(){
  if(loading())return '<p class="muted">Cargando tus datos…</p>';
  var c=calc(),m=movs(),inn=0,out=0,pc=0;
  m.forEach(function(x){if(x.k==='in')inn+=x.a;else out+=x.a;});
  c.act.forEach(function(s){pc+=bal(s,c);});
  var h='<div class="pagehd"><h1>Cuentas</h1><button class="btn gold sm" data-act="newexp" type="button">Registrar gasto</button></div>';
  h+='<div class="sec" style="margin-top:14px"><h2 style="font-size:19px">Saldo en cada cuenta</h2><div class="accs">'+ACC.map(function(a){
    var b=accBal(a.id);return '<div class="acc"><small>'+esc(a.name)+'</small><b>'+(a.cur==='Bs'?bs(b):usd(b))+'</b><span>'+(a.cur==='Bs'?'≈ '+usd(b/rate()):'Dólares en efectivo')+'</span></div>';}).join('')+'</div></div>';
  h+='<div class="chips" role="group" aria-label="Periodo" style="margin-top:18px">'+[['hoy','Hoy'],['7d','7 días'],['mes','Este mes'],['todo','Todo']].map(function(f){return '<button class="chip" type="button" data-act="per" data-v="'+f[0]+'" aria-pressed="'+(S.per===f[0])+'">'+f[1]+'</button>';}).join('')+'</div>';
  h+='<div class="kpis"><div class="kpi"><small>Ingresos ('+perLabel()+')</small><b>'+usd(inn)+'</b></div><div class="kpi"><small>Gastos</small><b>'+usd(out)+'</b></div>'+
     '<div class="kpi main"><small>Ganancia ('+perLabel()+')</small><b>'+usd(inn-out)+'</b><span>'+bs((inn-out)*rate())+' a la tasa de hoy</span></div>'+
     '<div class="kpi" style="grid-column:span 2"><small>Por cobrar a clientes</small><b>'+usd(pc)+'</b></div></div>';
  h+='<div class="sec"><h2>Movimientos</h2>';
  if(!m.length)h+='<div class="empty"><p style="margin:0">No hay movimientos en este periodo. Los pagos de ventas y los gastos aparecen aquí.</p></div>';
  else h+='<div class="list">'+m.slice(0,80).map(function(x){return '<button type="button" class="mv" data-act="mov" data-k="'+x.k+'" data-id="'+esc(x.id)+'"><span class="ic '+(x.k==='in'?'in':'out')+'" aria-hidden="true">'+(x.k==='in'?'+':'−')+'</span><span><span class="t">'+esc(x.title)+'</span><br><span class="s">'+esc(x.sub)+' · '+fDay(x.date)+'</span></span><span class="a">'+(x.k==='in'?'+':'−')+usd(x.a)+(x.cur==='Bs'?'<small>'+bs(x.bs)+'</small>':'')+'</span></button>';}).join('')+'</div>'+(m.length>80?'<p class="muted">Se muestran los 80 más recientes.</p>':'');
  h+='</div>';
  if(S.dl)h+='<div class="sec"><h2>Descargar</h2><div class="acts"><button class="btn line sm" data-act="csv" data-w="ventas" type="button">Ventas (CSV)</button><button class="btn line sm" data-act="csv" data-w="mov" type="button">Movimientos (CSV)</button></div><p class="hint">Abre los archivos en Excel o Google Sheets.</p></div>';
  return h;
}

/* hojas */
function openSheet(o){
  S.sheet=o;
  $('#sheetRoot').innerHTML='<div class="bk" data-act="close"></div><section class="sh" role="dialog" aria-modal="true" aria-label="'+esc(o.title)+'" tabindex="-1"><header class="sh-h"><h2>'+esc(o.title)+'</h2><button class="x" type="button" data-act="close" aria-label="Cerrar">×</button></header><div class="sh-b"><div class="in" id="shb">'+o.html()+'</div></div></section>';
  document.body.classList.add('lock');
  if(o.init)o.init();
  var f=$('#shb input:not([type=hidden]),#shb select');if(f&&o.focus)f.focus();else $('.sh').focus();
}
function closeSheet(){S.sheet=null;F=null;$('#sheetRoot').innerHTML='';document.body.classList.remove('lock');}
function refreshSheet(){if(S.sheet&&S.sheet.live){var b=$('#shb');if(b){b.innerHTML=S.sheet.html();}}}

/* detalle de venta */
function openSaleDetail(id){
  openSheet({title:'Venta',live:true,sale:id,html:function(){return saleDetailHtml(id);}});
}
function saleDetailHtml(id){
  var s=S.sales.filter(function(x){return x.id===id;})[0];
  if(!s)return '<p class="muted">Esta venta ya no existe.</p><button class="btn line" data-act="close" type="button">Cerrar</button>';
  var c=calc(),b=bal(s,c),pays=S.pays.filter(function(p){return p.saleId===id;}).sort(byNew),h='';
  h+='<div class="r3" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'+payBadge(s,c)+delBadge(s)+'</div>';
  h+='<dl class="dl"><dt>Cliente</dt><dd>'+esc(s.customerName)+(s.customerPhone?' · '+esc(s.customerPhone):'')+'</dd><dt>Fecha</dt><dd>'+fDay(s.date)+'</dd>'+
    '<dt>Entrega</dt><dd>'+esc(s.delivery||'Retiro')+(s.address?' · '+esc(s.address):'')+'</dd>'+(s.note?'<dt>Nota</dt><dd>'+esc(s.note)+'</dd>':'')+'</dl>';
  h+='<div class="card" style="margin-bottom:12px">'+(s.items||[]).map(function(i){return '<div style="display:flex;justify-content:space-between;gap:10px"><span>'+i.qty+' × '+esc(i.name)+'</span><span class="num">'+usd(i.qty*i.price)+'</span></div>';}).join('')+
    '<div style="display:flex;justify-content:space-between;border-top:1px dashed var(--line);margin-top:8px;padding-top:8px;font-weight:700"><span>Total</span><span class="num">'+usd(num(s.totalUSD))+'</span></div><div class="muted num" style="text-align:right;font-size:13px">'+bs(num(s.totalUSD)*(num(s.rate)||rate()))+' a tasa '+fmtN(num(s.rate)||rate(),2)+'</div></div>';
  var tk=Object.keys(s.toppings||{});if(tk.length)h+='<p style="margin:0 0 12px"><b>Coberturas:</b> '+tk.map(function(k){return s.toppings[k]+' '+esc(k);}).join(', ')+'</p>';
  h+='<h3 style="font-size:20px;margin:6px 0 8px">Pagos</h3>';
  h+=pays.length?'<div class="list">'+pays.map(function(p){return '<button type="button" class="mv" data-act="mov" data-k="in" data-id="'+esc(p.id)+'"><span class="ic in" aria-hidden="true">+</span><span><span class="t">'+esc(acc(p.account).name)+'</span><br><span class="s">'+fDay(p.date)+(p.ref?' · ref. '+esc(p.ref):'')+'</span></span><span class="a">'+usd(num(p.amountUSD))+(acc(p.account).cur==='Bs'?'<small>'+bs(num(p.amountBs))+'</small>':'')+'</span></button>';}).join('')+'</div>':'<p class="muted" style="margin:0">Todavía no hay pagos registrados.</p>';
  if(s.status!=='anulada'){
    h+='<div class="acts">';
    if(b>0)h+='<button class="btn gold" data-act="addpay" data-id="'+esc(id)+'" type="button">Registrar pago ('+usd(b)+')</button>';
    h+='<button class="btn '+(s.delivered?'line':'pri')+'" data-act="deliver" data-id="'+esc(id)+'" type="button">'+(s.delivered?'Volver a por entregar':'Marcar entregado')+'</button>';
    if(phoneWa(s.customerPhone))h+='<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/'+phoneWa(s.customerPhone)+'?text='+encodeURIComponent('Hola '+(s.customerName||'')+', te escribo de Que Roles sobre tu pedido.')+'">WhatsApp</a>';
    h+='</div>';
    h+='<div class="f" style="margin-top:6px"><label for="dd">Fecha de entrega</label><input class="inp" id="dd" type="date" value="'+esc(s.dueDate||'')+'" data-act-change="due" data-id="'+esc(id)+'"></div>';
    if(S.sheet&&S.sheet.confirmVoid===id)h+='<div class="banner alert bad">Los pagos ya recibidos se quedan en Cuentas. Si devolviste dinero, regístralo como gasto. <div class="acts"><button class="btn bad sm" data-act="void-yes" data-id="'+esc(id)+'" type="button">Sí, anular</button><button class="btn line sm" data-act="void-no" type="button">No</button></div></div>';
    else h+='<button class="btn bad sm" data-act="void" data-id="'+esc(id)+'" type="button">Anular venta</button>';
  }else{
    h+='<div class="acts"><button class="btn line" data-act="restore" data-id="'+esc(id)+'" type="button">Reactivar venta</button></div>';
  }
  return h;
}

/* formulario de nueva venta */
function toppingsNeed(){return F.items.reduce(function(a,i){return a+(i.kind==='paquete'?i.qty*3:0);},0);}
function topsSum(){return TOPS.reduce(function(a,k){return a+(F.tops[k]||0);},0);}
function saleTotal(){return r2(F.items.reduce(function(a,i){return a+i.qty*num(i.price);},0));}
function openSale(cu){
  F={cust:cu||null,name:cu?cu.name:'',phone:cu?(cu.phone||''):'',items:[{kind:'paquete',name:'Paquete de 3 roles',qty:1,price:num(S.set.price)||5.5}],tops:{},delivery:'Retiro',address:'',due:today(),pay:'todo',acc:'pm',amt:0,amtBs:0,ref:'',note:'',saving:false};
  openSheet({title:'Nueva venta',focus:!cu,html:saleFormHtml,init:saleInit});
}
function saleFormHtml(){
  return '<div class="f"><label for="fn">Cliente</label><input class="inp" id="fn" autocomplete="off" placeholder="Nombre del cliente" value="'+esc(F.name)+'"><div class="sug" id="fsug"></div></div>'+
   '<div class="f"><label for="fp">Teléfono (WhatsApp)</label><input class="inp" id="fp" inputmode="tel" autocomplete="off" placeholder="0412-0000000" value="'+esc(F.phone)+'"></div>'+
   '<div class="f"><span class="lbl">Productos</span><div id="fitems"></div><div class="addrow"><button class="btn line sm" type="button" data-act="add" data-k="paquete">+ Paquete de 3</button><button class="btn line sm" type="button" data-act="add" data-k="cumple">+ Cumpleaños</button><button class="btn line sm" type="button" data-act="add" data-k="mini">+ Minis</button><button class="btn line sm" type="button" data-act="add" data-k="otro">+ Otro</button></div></div>'+
   '<div class="f" id="ftopsw"><span class="lbl">Coberturas (1 por rol)</span><div id="ftops"></div><p class="hint" id="ftst"></p></div>'+
   '<div class="f"><span class="lbl">Entrega</span><div class="seg" id="fdel"></div></div>'+
   '<div class="f" id="faddrw" hidden><label for="fa">Dirección o enlace de Google Maps</label><input class="inp" id="fa" autocomplete="off" placeholder="Calle, casa o enlace de ubicación" value="'+esc(F.address)+'"></div>'+
   '<div class="f"><label for="fd">Fecha de entrega</label><input class="inp" id="fd" type="date" value="'+esc(F.due)+'"></div>'+
   '<div class="f"><span class="lbl">Pago</span><div class="seg" id="fpay"></div><div id="fpayd"></div></div>'+
   '<div class="f"><label for="fnote">Nota (opcional)</label><textarea id="fnote" placeholder="Detalles del pedido">'+esc(F.note)+'</textarea></div>'+
   '<div class="foot"><div class="tot"><small>Total</small><b id="ftot">$0.00</b><small id="ftbs"></small></div><button class="btn gold" id="fsave" type="button" data-act="savesale">Guardar venta</button></div>';
}
function saleInit(){
  drawItems();drawTops();drawDel();drawPay();updTot();
  $('#fn').addEventListener('input',function(){F.name=this.value;if(F.cust&&F.cust.name!==F.name)F.cust=null;drawSug();});
  $('#fp').addEventListener('input',function(){F.phone=this.value;});
  $('#fa').addEventListener('input',function(){F.address=this.value;});
  $('#fd').addEventListener('input',function(){F.due=this.value;});
  $('#fnote').addEventListener('input',function(){F.note=this.value;});
}
function drawSug(){
  var q=F.name.trim().toLowerCase(),el=$('#fsug');
  if(!el)return;
  if(F.cust||q.length<1){el.innerHTML=F.cust?'<span class="hint">Cliente guardado</span>':'';return;}
  var m=S.cust.filter(function(c){return (c.name||'').toLowerCase().indexOf(q)>=0;}).slice(0,5);
  el.innerHTML=m.map(function(c){return '<button type="button" data-act="pick" data-id="'+esc(c.id)+'">'+esc(c.name)+(c.phone?' · '+esc(c.phone):'')+'</button>';}).join('');
}
function drawItems(){
  $('#fitems').innerHTML=F.items.map(function(it,i){
    return '<div class="line"><div>'+(it.kind==='otro'||it.kind==='cumple'||it.kind==='mini'?'<input class="nmi" data-i="'+i+'" aria-label="Nombre del producto" value="'+esc(it.name)+'">':'<span class="nm">'+esc(it.name)+'</span>')+'</div>'+
     '<div class="step"><button type="button" data-act="iq" data-i="'+i+'" data-d="-1" aria-label="Quitar uno">−</button><output>'+it.qty+'</output><button type="button" data-act="iq" data-i="'+i+'" data-d="1" aria-label="Agregar uno">+</button></div>'+
     '<div><label class="muted" style="font-size:13px" for="pr'+i+'">Precio c/u $</label> <input class="pr" id="pr'+i+'" data-i="'+i+'" inputmode="decimal" value="'+(it.price||'')+'"></div>'+
     '<div style="text-align:right"><button class="rm" type="button" data-act="irm" data-i="'+i+'">Quitar</button></div></div>';}).join('')||'<p class="hint">Agrega un producto.</p>';
  Array.prototype.forEach.call(document.querySelectorAll('#fitems .pr'),function(el){el.addEventListener('input',function(){F.items[+el.dataset.i].price=num(el.value);updTot();});});
  Array.prototype.forEach.call(document.querySelectorAll('#fitems .nmi'),function(el){el.addEventListener('input',function(){F.items[+el.dataset.i].name=el.value;});});
}
function drawTops(){
  var need=toppingsNeed(),w=$('#ftopsw');
  if(!w)return;
  w.hidden=need===0;
  var s=topsSum();
  $('#ftops').innerHTML=TOPS.map(function(k){var n=F.tops[k]||0;return '<div class="tp'+(n?' on':'')+'"><span>'+esc(k)+'</span><span class="step"><button type="button" data-act="tq" data-k="'+esc(k)+'" data-d="-1" aria-label="Quitar '+esc(k)+'"'+(n?'':' disabled')+'>−</button><output>'+n+'</output><button type="button" data-act="tq" data-k="'+esc(k)+'" data-d="1" aria-label="Agregar '+esc(k)+'">+</button></span></div>';}).join('');
  $('#ftst').textContent=s===need?'Listo: '+need+' coberturas.':(s<need?'Faltan '+(need-s)+' de '+need+'. Puedes guardar igual y completarlo después.':'Hay '+(s-need)+' de más: son '+need+' roles.');
}
function drawDel(){
  $('#fdel').innerHTML=['Retiro','Domicilio'].map(function(d){return '<button type="button" data-act="del" data-v="'+d+'" aria-pressed="'+(F.delivery===d)+'">'+(d==='Retiro'?'Retiro':'A domicilio')+'</button>';}).join('');
  $('#faddrw').hidden=F.delivery!=='Domicilio';
}
function drawPay(){
  $('#fpay').innerHTML=[['todo','Pagó todo'],['abono','Abono'],['nada','Aún no pagó']].map(function(p){return '<button type="button" data-act="pm" data-v="'+p[0]+'" aria-pressed="'+(F.pay===p[0])+'">'+p[1]+'</button>';}).join('');
  var el=$('#fpayd');
  if(F.pay==='nada'){el.innerHTML='<p class="hint">Queda como por cobrar. Podrás registrar el pago después desde la venta.</p>';return;}
  var a=acc(F.acc);
  el.innerHTML='<div class="seg" style="margin:8px 0" role="group" aria-label="Cuenta donde entró el pago">'+ACC.map(function(x){return '<button type="button" data-act="pa" data-v="'+x.id+'" aria-pressed="'+(F.acc===x.id)+'">'+esc(x.name)+'</button>';}).join('')+'</div>'+
   '<div class="two"><div class="f" style="margin:0"><label for="fam">Monto en $</label><input class="inp" id="fam" inputmode="decimal" value="'+(F.amt||'')+'"'+(F.pay==='todo'?' readonly':'')+'></div>'+
   (a.cur==='Bs'?'<div class="f" style="margin:0"><label for="fab">Monto en Bs</label><input class="inp" id="fab" inputmode="decimal" value="'+(F.amtBs||'')+'"></div>':'<div></div>')+'</div>'+
   (F.acc==='pm'?'<div class="f" style="margin-top:10px"><label for="fref">Referencia (opcional)</label><input class="inp" id="fref" inputmode="numeric" autocomplete="off" value="'+esc(F.ref)+'"></div>':'');
  syncAmt();
  var am=$('#fam'),ab=$('#fab'),rf=$('#fref');
  if(am)am.addEventListener('input',function(){F.amt=num(am.value);F.amtBs=r2(F.amt*rate());if(ab)ab.value=F.amtBs||'';});
  if(ab)ab.addEventListener('input',function(){F.amtBs=num(ab.value);F.amt=r2(F.amtBs/rate());if(am)am.value=F.amt||'';});
  if(rf)rf.addEventListener('input',function(){F.ref=rf.value;});
}
function syncAmt(){
  if(F.pay==='todo'){F.amt=saleTotal();F.amtBs=r2(F.amt*rate());}
  else if(!F.amt){F.amt=0;F.amtBs=0;}
  var am=$('#fam'),ab=$('#fab');if(am&&F.pay==='todo')am.value=F.amt||'';if(ab&&F.pay==='todo')ab.value=F.amtBs||'';
}
function updTot(){
  var t=saleTotal();$('#ftot').textContent=usd(t);$('#ftbs').textContent=bs(t*rate());
  if(F.pay==='todo')syncAmt();
  drawTops();
}
async function saveSale(){
  if(!guard()||F.saving)return;
  var name=F.name.trim(),t=saleTotal();
  if(!name){toast('Escribe el nombre del cliente.',true);$('#fn').focus();return;}
  if(t<=0){toast('Agrega un producto con precio.',true);return;}
  var amt=0;
  if(F.pay==='todo')amt=t;
  else if(F.pay==='abono'){amt=r2(F.amt);if(amt<=0){toast('Escribe el monto del abono.',true);return;}if(amt>t){toast('El abono no puede ser mayor al total.',true);return;}}
  var r=rate(),a=acc(F.acc);
  if(amt>0&&a.cur==='Bs'&&!r){toast('Primero escribe la tasa del día (arriba a la derecha).',true);return;}
  F.saving=true;$('#fsave').disabled=true;$('#fsave').textContent='Guardando…';
  try{
    var cu=F.cust,phone=F.phone.trim(),dig=phone.replace(/\D/g,'');
    if(!cu&&dig)cu=S.cust.filter(function(c){return String(c.phone||'').replace(/\D/g,'')===dig;})[0]||null;
    var tops={};TOPS.forEach(function(k){if(F.tops[k])tops[k]=F.tops[k];});
    var res=await SB.rpc('create_sale_v2',{p_organization_id:ORG.id,p_customer_id:cu?cu.id:null,p_customer_name:name,p_customer_phone:phone,
      p_items:F.items.map(function(i){return {name:i.name||'Producto',qty:i.qty,price:num(i.price)};}),p_toppings:tops,p_due_date:F.due||today(),
      p_delivery_mode:F.delivery,p_delivery_address:F.delivery==='Domicilio'?F.address.trim():'',p_notes:F.note.trim(),p_rate:r,
      p_pay_account:amt>0?F.acc:'usd',p_pay_amount_usd:amt,p_pay_amount_native:(amt>0&&a.cur==='Bs'&&F.amtBs)?r2(F.amtBs):0,p_pay_reference:F.acc==='pm'?F.ref.trim():''});
    if(res.error)throw res.error;
    await reload();closeSheet();toast('Venta guardada');
  }catch(e){F.saving=false;var b=$('#fsave');if(b){b.disabled=false;b.textContent='Guardar venta';}toast('No se pudo guardar: '+errMsg(e),true);}
}
/* pago, gasto, cliente, tasa */
function openPay(id){
  var s=S.sales.filter(function(x){return x.id===id;})[0];if(!s)return;
  var b=bal(s,calc());
  F={kind:'pay',saleId:id,name:s.customerName,acc:'pm',amt:b,amtBs:r2(b*rate()),ref:'',date:today(),max:b,saving:false};
  openSheet({title:'Registrar pago',html:function(){return '<p class="muted" style="margin-top:0">'+esc(s.customerName)+'. Debe '+usd(b)+'.</p>'+moneyForm('Guardar pago');},init:function(){moneyInit();}});
}
function openExp(){
  F={kind:'exp',acc:'usd',amt:0,amtBs:0,date:today(),concept:'',cat:'Ingredientes',saving:false};
  openSheet({title:'Registrar gasto',focus:true,html:function(){return '<div class="f"><label for="fc">¿En qué gastaste?</label><input class="inp" id="fc" autocomplete="off" placeholder="Ej: harina, queso crema, cajas"></div>'+
    '<div class="f"><label for="fcat">Categoría</label><select id="fcat">'+CATS.map(function(c){return '<option>'+c+'</option>';}).join('')+'</select></div>'+moneyForm('Guardar gasto',true)+'<div class="f"><label for="fdt">Fecha</label><input class="inp" id="fdt" type="date" value="'+today()+'"></div>';},
    init:function(){moneyInit();$('#fc').addEventListener('input',function(){F.concept=this.value;});$('#fcat').addEventListener('change',function(){F.cat=this.value;});$('#fdt').addEventListener('input',function(){F.date=this.value;});}});
}
function moneyForm(btn,exp){
  return '<div class="f"><span class="lbl">'+(exp?'Pagado desde':'Cuenta donde entró')+'</span><div class="seg" id="macc"></div></div><div id="mamt"></div>'+
   '<div class="foot"><span class="hint">Tasa de hoy: '+bs(rate())+'</span><button class="btn gold" id="msave" type="button" data-act="savemoney">'+btn+'</button></div>';
}
function moneyInit(){
  function draw(){
    $('#macc').innerHTML=ACC.map(function(x){return '<button type="button" data-act="ma" data-v="'+x.id+'" aria-pressed="'+(F.acc===x.id)+'">'+esc(x.name)+'</button>';}).join('');
    var a=acc(F.acc);
    $('#mamt').innerHTML='<div class="two"><div class="f"><label for="mu">Monto en $</label><input class="inp" id="mu" inputmode="decimal" value="'+(F.amt||'')+'"></div>'+(a.cur==='Bs'?'<div class="f"><label for="mb">Monto en Bs</label><input class="inp" id="mb" inputmode="decimal" value="'+(F.amtBs||'')+'"></div>':'<div></div>')+'</div>'+(F.kind==='pay'&&F.acc==='pm'?'<div class="f"><label for="mr">Referencia (opcional)</label><input class="inp" id="mr" inputmode="numeric" autocomplete="off" value="'+esc(F.ref)+'"></div>':'');
    var u=$('#mu'),b=$('#mb'),r=$('#mr');
    u.addEventListener('input',function(){F.amt=num(u.value);F.amtBs=r2(F.amt*rate());if(b)b.value=F.amtBs||'';});
    if(b)b.addEventListener('input',function(){F.amtBs=num(b.value);F.amt=r2(F.amtBs/rate());u.value=F.amt||'';});
    if(r)r.addEventListener('input',function(){F.ref=r.value;});
  }
  F.redraw=draw;draw();
}
async function saveMoney(){
  if(!guard()||F.saving)return;
  var amt=r2(F.amt);
  if(amt<=0){toast('Escribe el monto.',true);return;}
  if(F.kind==='pay'&&amt>F.max+0.005){toast('El pago es mayor a lo que debe ('+usd(F.max)+').',true);return;}
  if(F.kind==='exp'&&!F.concept.trim()){toast('Escribe en qué gastaste.',true);return;}
  var a=acc(F.acc),r=rate();
  if(a.cur==='Bs'&&!r&&!F.amtBs){toast('Primero escribe la tasa del día (arriba a la derecha).',true);return;}
  F.saving=true;$('#msave').disabled=true;
  try{
    var nat=a.cur==='Bs'&&F.amtBs?r2(F.amtBs):0,res;
    if(F.kind==='pay')res=await SB.rpc('add_payment',{p_organization_id:ORG.id,p_sale_id:F.saleId,p_account:F.acc,p_amount_usd:amt,p_amount_native:nat,p_reference:F.acc==='pm'?F.ref.trim():'',p_rate:r});
    else res=await SB.rpc('add_expense',{p_organization_id:ORG.id,p_description:F.concept.trim(),p_category:F.cat,p_account:F.acc,p_amount_usd:amt,p_amount_native:nat,p_rate:r,p_paid_at:(F.date||today())+'T12:00:00-04:00'});
    if(res.error)throw res.error;
    var back=F.kind==='pay'?F.saleId:null;
    await reload();closeSheet();toast(back?'Pago registrado':'Gasto guardado');
    if(back)openSaleDetail(back);
  }catch(e){F.saving=false;var b=$('#msave');if(b)b.disabled=false;toast('No se pudo guardar: '+errMsg(e),true);}
}
function openMov(k,id){
  var m=k==='in'?S.pays.filter(function(p){return p.id===id;})[0]:S.exps.filter(function(e){return e.id===id;})[0];
  if(!m)return;
  openSheet({title:k==='in'?'Pago recibido':'Gasto',live:true,html:function(){
    var x=(k==='in'?S.pays:S.exps).filter(function(z){return z.id===id;})[0];
    if(!x)return '<p class="muted">Ya no existe.</p>';
    var a=acc(x.account);
    return '<dl class="dl"><dt>'+(k==='in'?'Cliente':'Concepto')+'</dt><dd>'+esc(k==='in'?x.customerName:x.concept)+'</dd>'+(k==='out'?'<dt>Categoría</dt><dd>'+esc(x.category||'')+'</dd>':'')+'<dt>Cuenta</dt><dd>'+esc(a.name)+'</dd><dt>Monto</dt><dd>'+usd(num(x.amountUSD))+(a.cur==='Bs'?' · '+bs(num(x.amountBs)):'')+'</dd><dt>Fecha</dt><dd>'+fDay(x.date)+'</dd>'+(x.ref?'<dt>Referencia</dt><dd>'+esc(x.ref)+'</dd>':'')+'</dl>'+
      '<p class="hint">Los pagos y gastos no se borran para mantener la contabilidad en orden.</p>';
  }});
}
function openCust(id){
  openSheet({title:'Cliente',live:true,html:function(){
    var cu=S.cust.filter(function(c){return c.id===id;})[0];if(!cu)return '<p class="muted">Este cliente ya no existe.</p>';
    var c=calc(),ss=S.sales.filter(function(s){return s.customerId===id;}).sort(byNew),tot=0,deb=0;
    ss.forEach(function(s){if(s.status!=='anulada'){tot+=num(s.totalUSD);deb+=bal(s,c);}});
    return '<dl class="dl"><dt>Teléfono</dt><dd>'+esc(cu.phone||'—')+'</dd>'+(cu.note?'<dt>Nota</dt><dd>'+esc(cu.note)+'</dd>':'')+'<dt>Compras</dt><dd>'+ss.length+' · '+usd(tot)+'</dd><dt>Debe</dt><dd>'+(deb>0?'<b style="color:var(--bad)">'+usd(deb)+'</b>':'Nada')+'</dd></dl>'+
     '<div class="acts"><button class="btn gold" data-act="sale-for" data-id="'+esc(id)+'" type="button">Nueva venta</button>'+(phoneWa(cu.phone)?'<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/'+phoneWa(cu.phone)+'">WhatsApp</a>':'')+'<button class="btn line" data-act="edcust" data-id="'+esc(id)+'" type="button">Editar</button></div>'+
     '<h3 style="font-size:20px;margin:14px 0 8px">Historial</h3>'+(ss.length?'<div class="list">'+ss.map(function(s){return saleRow(s,c);}).join('')+'</div>':'<p class="muted" style="margin:0">Todavía no ha comprado.</p>')+
     '';
  }});
}
function openCustForm(id){
  var cu=id?S.cust.filter(function(c){return c.id===id;})[0]:null;
  F={kind:'cust',id:id||null,saving:false};
  openSheet({title:cu?'Editar cliente':'Nuevo cliente',focus:true,html:function(){return '<div class="f"><label for="cn">Nombre</label><input class="inp" id="cn" autocomplete="off" value="'+esc(cu?cu.name:'')+'"></div><div class="f"><label for="cp">Teléfono (WhatsApp)</label><input class="inp" id="cp" inputmode="tel" autocomplete="off" value="'+esc(cu?cu.phone||'':'')+'"></div><div class="f"><label for="cno">Nota (opcional)</label><textarea id="cno">'+esc(cu?cu.note||'':'')+'</textarea></div><div class="acts"><button class="btn gold" id="csave" type="button" data-act="savecust">Guardar cliente</button></div>';}});
}
async function saveCust(){
  if(!guard()||F.saving)return;
  var n=$('#cn').value.trim(),p=$('#cp').value.trim(),no=$('#cno').value.trim();
  if(!n){toast('Escribe el nombre.',true);return;}
  F.saving=true;$('#csave').disabled=true;
  try{
    var row={name:n,phone:p||null,notes:no||null},res;
    if(F.id){res=await SB.from('customers').update(row).eq('organization_id',ORG.id).eq('id',F.id);}
    else{res=await SB.from('customers').insert(Object.assign({organization_id:ORG.id},row));}
    if(res.error)throw res.error;
    var id=F.id;await reload();closeSheet();toast(id?'Cliente actualizado':'Cliente guardado');if(id)openCust(id);
  }catch(e){F.saving=false;var b=$('#csave');if(b)b.disabled=false;toast('No se pudo guardar: '+errMsg(e),true);}
}
function openRate(){
  F={kind:'rate',saving:false};
  openSheet({title:'Tasa y precio',focus:true,html:function(){return '<p class="muted" style="margin-top:0">Escribe la tasa oficial del BCV de hoy. Se usa para calcular los bolívares de cada venta y pago.</p>'+
    '<div class="f"><label for="rr">Bolívares por 1 $</label><input class="inp" id="rr" inputmode="decimal" value="'+esc(String(rate()).replace('.',','))+'"><p class="hint">Última actualización: '+fDay(S.set.rateDate)+'. <a href="https://www.bcv.org.ve/" target="_blank" rel="noopener">Ver tasa en bcv.org.ve</a></p></div>'+
    '<div class="f"><label for="rp">Precio del paquete de 3 roles ($)</label><input class="inp" id="rp" inputmode="decimal" value="'+esc(String(num(S.set.price)||5.5).replace('.',','))+'"></div><div class="acts"><button class="btn gold" id="rsave" type="button" data-act="saverate">Guardar</button></div>';}});
}
async function saveRate(){
  if(!guard()||F.saving)return;
  var r=num($('#rr').value),p=num($('#rp').value);
  if(r<=1){toast('Escribe una tasa válida.',true);return;}
  if(p<=0){toast('Escribe un precio válido.',true);return;}
  F.saving=true;$('#rsave').disabled=true;
  try{var res=await SB.from('org_settings').upsert({organization_id:ORG.id,exchange_rate:r,rate_date:today(),package_price:p,updated_at:new Date().toISOString()},{onConflict:'organization_id'});
    if(res.error)throw res.error;await reload();closeSheet();toast('Tasa guardada');}
  catch(e){F.saving=false;var b=$('#rsave');if(b)b.disabled=false;toast('No se pudo guardar: '+errMsg(e),true);}
}
function csvCell(v){v=String(v==null?'':v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function download(w){
  var c=calc(),rows=[];
  if(w==='ventas'){
    rows.push(['Fecha','Cliente','Teléfono','Productos','Total USD','Pagado USD','Debe USD','Entrega','Fecha entrega','Entregado','Estado']);
    S.sales.slice().sort(byNew).forEach(function(s){rows.push([s.date,s.customerName,s.customerPhone,summary(s),num(s.totalUSD).toFixed(2),(c.paid[s.id]||0).toFixed(2),bal(s,c).toFixed(2),s.delivery,s.dueDate,s.delivered?'Sí':'No',s.status==='anulada'?'Anulada':'Activa']);});
  }else{
    rows.push(['Fecha','Tipo','Detalle','Cuenta','Monto USD','Monto Bs']);
    movs().forEach(function(m){rows.push([m.date,m.k==='in'?'Ingreso':'Gasto',m.title,m.sub,(m.k==='in'?'':'-')+m.a.toFixed(2),m.bs.toFixed(2)]);});
  }
  var txt='﻿'+rows.map(function(r){return r.map(csvCell).join(',');}).join('\n');
  try{var bl=new Blob([txt],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(bl),an=document.createElement('a');an.href=u;an.download=(w==='ventas'?'ventas-que-roles':'movimientos-que-roles')+'-'+today()+'.csv';document.body.appendChild(an);an.click();an.remove();setTimeout(function(){URL.revokeObjectURL(u);},4000);toast('Archivo listo');}catch(e){toast('No se pudo descargar el archivo.',true);}
}

/* acciones */
var ACT={
  tab:function(t){S.tab=t.dataset.t;renderHeader();renderView();window.scrollTo(0,0);},
  newsale:function(){if(guard())openSale(null);},
  rate:function(){if(guard())openRate();},
  close:function(){closeSheet();},
  sale:function(t){openSaleDetail(t.dataset.id);},
  cust:function(t){openCust(t.dataset.id);},
  newcust:function(){if(guard())openCustForm(null);},
  edcust:function(t){var id=t.dataset.id;closeSheet();openCustForm(id);},
  'sale-for':function(t){var cu=S.cust.filter(function(c){return c.id===t.dataset.id;})[0];closeSheet();if(cu)openSale(cu);},
  savecust:saveCust,saverate:saveRate,savesale:saveSale,savemoney:saveMoney,
  fsale:function(t){S.fSales=t.dataset.v;fillList();},
  per:function(t){S.per=t.dataset.v;renderView();},
  csv:function(t){download(t.dataset.w);},
  newexp:function(){if(guard())openExp();},
  mov:function(t){openMov(t.dataset.k,t.dataset.id);},
  addpay:function(t){var id=t.dataset.id;closeSheet();openPay(id);},
  deliver:async function(t){if(!guard())return;var s=S.sales.filter(function(x){return x.id===t.dataset.id;})[0];if(!s)return;await patchSale(t.dataset.id,{delivered_at:s.delivered?null:new Date().toISOString()},s.delivered?'Vuelve a por entregar':'Marcada como entregada');},
  void:function(){S.sheet.confirmVoid=S.sheet.sale;refreshSheet();},
  'void-no':function(){S.sheet.confirmVoid=null;refreshSheet();},
  'void-yes':async function(t){if(!guard())return;S.sheet.confirmVoid=null;await patchSale(t.dataset.id,{status:'canceled'},'Venta anulada');},
  restore:async function(t){if(!guard())return;await patchSale(t.dataset.id,{status:'confirmed'},'Venta reactivada');},
  webok:function(t){confirmWeb(t.dataset.id);},
  webno:function(t){rejectWeb(t.dataset.id);},
  webref:async function(t){var v=($('#wref')||{}).value||'';if(!v.trim()){toast('Escribe la referencia.',true);return;}await confirmWeb(t.dataset.id,v.trim());},
  /* formulario de venta */
  pick:function(t){var cu=S.cust.filter(function(c){return c.id===t.dataset.id;})[0];if(!cu)return;F.cust=cu;F.name=cu.name;F.phone=cu.phone||'';$('#fn').value=F.name;$('#fp').value=F.phone;drawSug();},
  add:function(t){var k=t.dataset.k,m={paquete:['Paquete de 3 roles',num(S.set.price)||5.5],cumple:['Rol de cumpleaños',0],mini:['Minis',0],otro:['Otro producto',0]}[k];
    if(k==='paquete'){var ex=F.items.filter(function(i){return i.kind==='paquete';})[0];if(ex){ex.qty++;drawItems();updTot();return;}}
    F.items.push({kind:k,name:m[0],qty:1,price:m[1]});drawItems();updTot();},
  iq:function(t){var i=F.items[+t.dataset.i],d=+t.dataset.d;i.qty=Math.max(1,i.qty+d);drawItems();updTot();},
  irm:function(t){F.items.splice(+t.dataset.i,1);drawItems();updTot();},
  tq:function(t){var k=t.dataset.k,d=+t.dataset.d,n=(F.tops[k]||0)+d;if(n<0)return;if(d>0&&topsSum()>=toppingsNeed())return;F.tops[k]=n;drawTops();},
  del:function(t){F.delivery=t.dataset.v;drawDel();},
  pm:function(t){F.pay=t.dataset.v;if(F.pay==='abono'){F.amt=0;F.amtBs=0;}drawPay();},
  pa:function(t){F.acc=t.dataset.v;F.amtBs=r2(F.amt*rate());drawPay();},
  ma:function(t){F.acc=t.dataset.v;F.amtBs=r2(F.amt*rate());F.redraw();}
};
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-act]');if(!t)return;
  var f=ACT[t.dataset.act];if(f){e.preventDefault&&t.tagName!=='A'&&e.preventDefault();f(t,e);}
});
document.addEventListener('change',function(e){
  var t=e.target;
  if(t.dataset&&t.dataset.actChange==='due'){if(!guard())return;patchSale(t.dataset.id,{due_date:t.value||null},'Fecha guardada');}
});
document.addEventListener('input',function(e){
  var t=e.target;
  if(t.id==='qs'){S.qSales=t.value;fillList();}
  if(t.id==='qc'){S.qCust=t.value;fillList();}
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&S.sheet)closeSheet();});

/* datos reales (Supabase) */
function nObj(o){return o&&typeof o==='object'?o:{};}
function normData(q){
  var cust=(q[0].data||[]).map(function(c){return {id:c.id,name:c.name,phone:c.phone||'',note:c.notes||'',createdAt:c.created_at};});
  var names={};
  var sales=(q[1].data||[]).map(function(s){
    var cu=nObj(s.customers),usdT=s.currency==='VES'?(num(s.exchange_rate)?num(s.total)/num(s.exchange_rate):0):num(s.total);
    names[s.id]=cu.name||'';
    return {id:s.id,date:dayOf(new Date(s.created_at)),createdAt:s.created_at,customerId:s.customer_id,customerName:cu.name||'Sin nombre',customerPhone:cu.phone||'',
      items:(s.sale_items||[]).map(function(i){var nm=i.description||'Producto';return {kind:nm.indexOf('Paquete de 3')===0?'paquete':'otro',name:nm,qty:num(i.quantity),price:num(i.unit_price)};}),
      toppings:nObj(s.toppings),totalUSD:r2(usdT),rate:num(s.exchange_rate),delivery:s.delivery_mode||'Retiro',address:s.delivery_address||'',dueDate:s.due_date||'',
      delivered:!!s.delivered_at,note:s.notes||'',status:s.status==='confirmed'?'activa':'anulada'};});
  var pays=(q[2].data||[]).map(function(p){
    var acct=p.account||(p.method==='pago_movil'?'pm':(p.currency==='USD'?'usd':'bs')),r=num(p.exchange_rate);
    var u=p.amount_usd!=null?num(p.amount_usd):(p.currency==='USD'?num(p.amount):(r?num(p.amount)/r:0));
    var b=p.currency==='VES'?num(p.amount):num(p.amount)*r;
    return {id:p.id,saleId:p.sale_id,customerName:names[p.sale_id]||'cliente',date:dayOf(new Date(p.received_at)),createdAt:p.received_at,account:acct,amountUSD:r2(u),amountBs:r2(b),rate:r,ref:p.reference||''};});
  var exps=(q[3].data||[]).map(function(e){
    var acct=e.account||(e.currency==='USD'?'usd':'bs'),r=num(e.exchange_rate);
    var u=e.amount_usd!=null?num(e.amount_usd):(e.currency==='USD'?num(e.amount):(r?num(e.amount)/r:0));
    var b=e.currency==='VES'?num(e.amount):num(e.amount)*r;
    return {id:e.id,date:dayOf(new Date(e.paid_at)),createdAt:e.paid_at,concept:e.description,category:e.category||'Otros',account:acct,amountUSD:r2(u),amountBs:r2(b),rate:r};});
  return {cust:cust,sales:sales,pays:pays,exps:exps};
}
var reloading=false;
async function reload(){
  if(!SB||!ORG||reloading)return;reloading=true;
  try{
    var oid=ORG.id,L=3000;
    var q=await Promise.all([
      SB.from('customers').select('id,name,phone,notes,created_at').eq('organization_id',oid).order('created_at',{ascending:false}).limit(L),
      SB.from('sales').select('id,created_at,customer_id,total,currency,exchange_rate,notes,status,due_date,delivered_at,delivery_mode,delivery_address,toppings,customers(name,phone),sale_items(description,quantity,unit_price)').eq('organization_id',oid).order('created_at',{ascending:false}).limit(L),
      SB.from('payments').select('id,sale_id,received_at,amount,currency,reference,status,account,amount_usd,exchange_rate,method').eq('organization_id',oid).eq('status','confirmed').order('received_at',{ascending:false}).limit(L),
      SB.from('expenses').select('id,description,category,amount,currency,paid_at,account,amount_usd,exchange_rate').eq('organization_id',oid).order('paid_at',{ascending:false}).limit(L),
      SB.from('org_settings').select('exchange_rate,rate_date,package_price').eq('organization_id',oid).maybeSingle(),
      SB.from('web_orders').select('*').eq('organization_id',oid).eq('status','pending').order('requested_for',{ascending:true}).limit(100)
    ]);
    for(var i=0;i<4;i++)if(q[i].error)throw q[i].error;
    var d=normData(q);S.cust=d.cust;S.sales=d.sales;S.pays=d.pays;S.exps=d.exps;S.web=q[5].error?[]:(q[5].data||[]);
    var st=q[4].error?null:q[4].data;if(st&&num(st.exchange_rate)){S.set={rate:num(st.exchange_rate),rateDate:st.rate_date||'',price:num(st.package_price)||5.5};}else if(!S.set.rate){S.set={rate:0,rateDate:'',price:(st&&num(st.package_price))||5.5};}
    S.loaded={sales:true};S.state='ready';
  }catch(e){if(!S.loaded.sales){S.state='error';}toast('No se pudieron leer los datos: '+errMsg(e),true);}
  reloading=false;renderAll();
}
async function patchSale(id,fields,msg){
  try{var r=await SB.from('sales').update(fields).eq('organization_id',ORG.id).eq('id',id);if(r.error)throw r.error;await reload();toast(msg);}
  catch(e){toast('No se pudo guardar: '+errMsg(e),true);}
}
/* pedidos que llegan desde la página web */
function topsText(o){var t=nObj(o);return Object.keys(t).filter(function(k){return t[k]>0;}).map(function(k){return t[k]+' '+k;}).join(', ');}
function webHtml(){
  if(!S.web.length)return '';
  return '<div class="web"><h2 style="font-size:20px;color:var(--brand);margin-bottom:8px">Pedidos de la página ('+S.web.length+')</h2><div class="list">'+S.web.map(function(o){
    var adv=o.payment_timing==='advance';
    return '<div class="row webcard"><div class="r1"><b>'+esc(o.customer_name)+'</b><span class="amt">'+usd(num(o.total))+'</span></div>'+
     '<div class="r2">'+o.quantity_packages+(o.quantity_packages===1?' paquete':' paquetes')+(topsText(o.toppings)?' · '+esc(topsText(o.toppings)):'')+'</div>'+
     '<div class="r2">Para '+fDay(o.requested_for)+' · '+esc(o.fulfillment)+(o.delivery_address?' · '+esc(o.delivery_address):'')+(o.maps_url?' · '+esc(o.maps_url):'')+'</div>'+
     (o.customer_note?'<div class="r2">Nota: '+esc(o.customer_note)+'</div>':'')+
     '<div class="r3"><span class="badge '+(adv?'b-warn':'b-mute')+'">'+(adv?'Paga antes':'Paga al recibir')+'</span>'+(o.payment_reference?'<span class="badge b-ok">Ref. '+esc(o.payment_reference)+'</span>':(adv?'<span class="badge b-bad">Sin referencia</span>':''))+(o.customer_phone?'<span class="bsx">'+esc(o.customer_phone)+'</span>':'')+'</div>'+
     (adv?'<p class="hint" style="margin-top:6px">Verifica el pago móvil en tu banco antes de confirmar.</p>':'')+
     '<div class="acts"><button class="btn gold sm" type="button" data-act="webok" data-id="'+esc(o.id)+'">Confirmar</button><button class="btn line sm" type="button" data-act="webno" data-id="'+esc(o.id)+'">Rechazar</button>'+(phoneWa(o.customer_phone)?'<a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/'+phoneWa(o.customer_phone)+'?text='+encodeURIComponent('Hola '+o.customer_name+', te escribo de Que Roles sobre tu pedido.')+'">WhatsApp</a>':'')+'</div></div>';}).join('')+'</div></div>';
}
async function confirmWeb(id,ref){
  if(!guard())return;
  var o=S.web.filter(function(x){return x.id===id;})[0];if(!o)return;
  if(o.payment_timing==='advance'&&!o.payment_reference&&!ref){
    F={kind:'webref'};
    openSheet({title:'Verificar pago',focus:true,html:function(){return '<p class="muted" style="margin-top:0">'+esc(o.customer_name)+' pagó antes. Escribe la referencia del pago móvil que viste en tu banco.</p><div class="f"><label for="wref">Referencia</label><input class="inp" id="wref" inputmode="numeric" autocomplete="off"></div><div class="acts"><button class="btn gold" type="button" data-act="webref" data-id="'+esc(id)+'">Confirmar pedido</button></div>';}});
    return;
  }
  try{
    if(ref){var u=await SB.from('web_orders').update({payment_reference:ref}).eq('organization_id',ORG.id).eq('id',id).eq('status','pending');if(u.error)throw u.error;}
    var r=await SB.rpc('confirm_web_order',{p_order_id:id});if(r.error)throw r.error;
    await reload();if(S.sheet)closeSheet();toast('Pedido convertido en venta');
  }catch(e){toast('No se pudo confirmar: '+errMsg(e),true);}
}
function rejectWeb(id){
  var o=S.web.filter(function(x){return x.id===id;})[0];if(!o)return;
  openSheet({title:'Rechazar pedido',html:function(){return '<p style="margin-top:0">¿Rechazar el pedido de <b>'+esc(o.customer_name)+'</b>?</p><div class="acts"><button class="btn bad" type="button" id="webnoyes">Sí, rechazar</button><button class="btn line" type="button" data-act="close">No</button></div>';},
    init:function(){$('#webnoyes').addEventListener('click',async function(){try{var r=await SB.from('web_orders').update({status:'rejected'}).eq('organization_id',ORG.id).eq('id',id).eq('status','pending');if(r.error)throw r.error;await reload();closeSheet();toast('Pedido rechazado');}catch(e){toast('No se pudo rechazar: '+errMsg(e),true);}});}});
}
/* tasa del día automática (la misma que usa la página de pedidos) */
async function autoRate(){
  if(S.set.rateDate===today()&&S.set.rate)return;
  try{
    var r=await fetch('/api/tasa',{cache:'no-store'}),d=await r.json();
    if(d&&d.rate>1&&d.rate<100000){
      S.set.rate=d.rate;S.set.rateDate=today();renderAll();
      var u=await SB.from('org_settings').upsert({organization_id:ORG.id,exchange_rate:d.rate,rate_date:today(),package_price:num(S.set.price)||5.5,updated_at:new Date().toISOString()},{onConflict:'organization_id'});
      if(u.error)console.warn('No se pudo guardar la tasa:',u.error.message);
    }
  }catch(e){}
}
/* acceso y arranque */
function renderAll(){renderHeader();renderView();refreshSheet();}
function authShow(title,desc,msg){$('#authTitle').textContent=title;$('#authDesc').textContent=desc;$('#authMsg').textContent=msg||'';}
async function getMembership(uid){
  var r=await SB.from('organization_memberships').select('organization_id, role, organizations(id,name,slug,timezone)').eq('user_id',uid).limit(1).maybeSingle();
  if(r.error)throw r.error;return r.data;
}
function askClaim(){
  return new Promise(function(resolve){
    authShow('Primera conexión','Introduce el código de activación de propietario para vincular este dispositivo.');
    var f=$('#authForm');
    f.innerHTML='<form><input class="inp" id="claim" type="password" autocomplete="off" placeholder="Código de activación" aria-label="Código de activación"><button class="btn gold" type="submit">Vincular</button></form>';
    f.querySelector('form').addEventListener('submit',function(e){e.preventDefault();var v=$('#claim').value.trim();if(v){f.innerHTML='';resolve(v);}});
  });
}
async function enter(m){
  ORG=m.organizations;S.db=true;
  $('#auth').hidden=true;
  await reload();autoRate();
  setInterval(function(){if(document.hidden||S.sheet)return;var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;reload().then(autoRate);},60000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&!S.sheet)reload().then(autoRate);});
}
async function startApp(){
  var url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_ANON_KEY;
  if(!url||!key){authShow('Configuración pendiente','Falta configurar la conexión con Supabase en Vercel.');return;}
  SB=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  try{
    var ex=await SB.auth.getSession();if(ex.error)throw ex.error;
    var ses=ex.data.session;
    if(!ses){
      var an=await SB.auth.signInAnonymously();
      if(an.error){if(/anonymous|disabled|not enabled/i.test(an.error.message||''))throw new Error('Falta activar el acceso anónimo en Supabase (Authentication → Sign In / Providers → Anonymous Sign-Ins).');throw an.error;}
      ses=an.data.session;
    }
    if(!ses)throw new Error('Supabase no devolvió una sesión válida.');
    var m=await getMembership(ses.user.id);
    if(!m||!m.organizations){
      var code=await askClaim();
      authShow('Vinculando…','Un momento.');
      var c=await SB.rpc('claim_owner_access',{p_token:code});
      if(c.error)throw new Error('No se pudo vincular este dispositivo: '+c.error.message);
      m=await getMembership(ses.user.id);
      if(!m||!m.organizations)throw new Error('La vinculación no se pudo verificar. Recarga e inténtalo de nuevo.');
    }
    await enter(m);
  }catch(e){
    authShow('No se pudo abrir Que Roles','Revisa la conexión e inténtalo nuevamente.',errMsg(e));
    $('#authForm').innerHTML='<form><button class="btn pri" type="submit">Reintentar</button></form>';
    $('#authForm form').addEventListener('submit',function(ev){ev.preventDefault();location.reload();});
  }
}
renderAll();
if('serviceWorker' in navigator&&location.protocol.indexOf('http')===0)navigator.serviceWorker.register('/admin/sw.js').catch(function(){});
startApp();
})();
