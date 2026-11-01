const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(n,c="USD")=>new Intl.NumberFormat("es-VE",{style:"currency",currency:c}).format(Number(n||0));
const when=s=>s?new Date(s).toLocaleString("es-VE"):"—";
export async function mountModules({supabase,organization,notify,refreshDashboard}){
 const org=organization.id, cache={products:[],customers:[]};
 const field=(label,html)=>`<label class="module-field"><span>${label}</span>${html}</label>`;
 const inp=(n,l,t="text",a="")=>field(l,`<input name="${n}" type="${t}" ${a} required>`);
 const sel=(n,l,opts)=>field(l,`<select name="${n}" required>${opts}</select>`);
 const form=(title,kind,body,btn)=>`<form class="panel module-form" data-module="${kind}"><h3>${title}</h3><div class="module-grid">${body}</div><button class="primary" type="submit">${btn}</button></form>`;
 const table=(heads,rows,empty)=>`<div class="panel module-panel"><div class="table-wrap"><table><thead><tr>${heads.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${rows||`<tr><td colspan="${heads.length}">${empty}</td></tr>`}</tbody></table></div></div>`;
 const page=(id,title,desc,body)=>{document.getElementById(id).innerHTML=`<div class="section-head"><div><h2>${title}</h2><p>${desc}</p></div></div>${body}`;};
 async function loadOptions(){
  const [p,c]=await Promise.all([supabase.from("products").select("id,name,sale_price,currency,track_stock").eq("organization_id",org).eq("active",true).order("name"),supabase.from("customers").select("id,name").eq("organization_id",org).order("name")]);
  if(p.error)throw p.error;if(c.error)throw c.error;cache.products=p.data||[];cache.customers=c.data||[];
 }
 async function clientes(){
  const {data,error}=await supabase.from("customers").select("name,phone,email,created_at").eq("organization_id",org).order("created_at",{ascending:false});if(error)throw error;
  const body=form("Nuevo cliente","customer",inp("name","Nombre")+inp("phone","Teléfono","tel")+inp("email","Correo","email")+inp("address","Dirección")+inp("notes","Notas"),"Guardar cliente")+table(["Nombre","Teléfono","Correo","Registro"],(data||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone||"—")}</td><td>${esc(x.email||"—")}</td><td>${when(x.created_at)}</td></tr>`).join(""),"Aún no hay clientes.");
  page("clientes","Clientes","Contactos e historial de compradores.",body);
 }
 async function inventario(){
  const [p,i]=await Promise.all([supabase.from("products").select("name,category,sale_price,currency,track_stock").eq("organization_id",org).order("created_at",{ascending:false}),supabase.from("ingredients").select("name,base_unit,current_quantity,average_unit_cost,currency,min_quantity").eq("organization_id",org).order("name")]);
  if(p.error)throw p.error;if(i.error)throw i.error;
  let body=form("Agregar producto","product",inp("name","Nombre")+inp("category","Categoría")+inp("sale_price","Precio","number",'min="0" step="0.01"')+sel("currency","Moneda",'<option>USD</option><option>VES</option>')+field("Controlar stock",'<input name="track_stock" type="checkbox">'),"Guardar producto");
  body+=form("Registrar entrada de producto","stock",sel("product_id","Producto",`<option value="">Selecciona</option>${cache.products.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}`)+inp("quantity","Cantidad","number",'min="0.001" step="0.001"'),"Registrar entrada");
  body+=table(["Producto","Categoría","Precio","Stock"],(p.data||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category||"—")}</td><td>${money(x.sale_price,x.currency)}</td><td>${x.track_stock?"Controlado":"No controlado"}</td></tr>`).join(""),"Agrega productos.");
  body+=form("Agregar materia prima","ingredient",inp("name","Ingrediente")+sel("base_unit","Unidad",'<option value="g">Gramos</option><option value="ml">Mililitros</option><option value="unit">Unidades</option>')+inp("current_quantity","Cantidad inicial","number",'min="0" step="0.001"')+inp("average_unit_cost","Costo por unidad","number",'min="0" step="0.000001"')+sel("ingredient_currency","Moneda",'<option>USD</option><option>VES</option>')+inp("min_quantity","Mínimo","number",'min="0" step="0.001"'),"Guardar ingrediente");
  body+=table(["Ingrediente","Existencia","Unidad","Costo"],(i.data||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.current_quantity}</td><td>${x.base_unit}</td><td>${money(x.average_unit_cost,x.currency)}</td></tr>`).join(""),"Agrega materias primas.");
  page("inventario","Inventario","Productos terminados y materias primas.",body);
 }
 async function ventas(){
  const {data,error}=await supabase.from("sales").select("sale_number,total,currency,status,created_at,customers(name),sale_items(description,quantity)").eq("organization_id",org).order("created_at",{ascending:false}).limit(50);if(error)throw error;
  let body=form("Nueva venta","sale",sel("product_id","Producto",`<option value="">Selecciona</option>${cache.products.map(x=>`<option value="${x.id}" data-price="${x.sale_price}">${esc(x.name)} · ${money(x.sale_price,x.currency)}</option>`).join("")}`)+sel("customer_id","Cliente",`<option value="">Venta directa</option>${cache.customers.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}`)+inp("quantity","Cantidad","number",'min="0.001" step="0.001"')+inp("unit_price","Precio unitario","number",'min="0" step="0.01"')+inp("payment_amount","Abono recibido","number",'min="0" step="0.01" value="0"')+sel("payment_method","Método de pago",'<option value="cash">Efectivo</option><option value="pago_movil">Pago móvil</option><option value="transfer">Transferencia</option><option value="card">Tarjeta</option><option value="zelle">Zelle</option><option value="other">Otro</option>')+inp("notes","Notas"),"Guardar venta");
  body+='<p class="form-hint">Abono cero = venta pendiente. El stock se descuenta si el producto lo controla.</p>';
  body+=table(["N.º","Fecha","Cliente","Detalle","Total","Estado"],(data||[]).map(x=>`<tr><td>#${x.sale_number}</td><td>${when(x.created_at)}</td><td>${esc(x.customers?.name||"Directa")}</td><td>${(x.sale_items||[]).map(i=>`${esc(i.description)} × ${i.quantity}`).join(", ")}</td><td>${money(x.total,x.currency)}</td><td>${x.status}</td></tr>`).join(""),"Aún no hay ventas.");
  page("ventas","Ventas","Registra pedidos, abonos y movimientos de stock.",body);
  document.querySelector('[data-module="sale"] [name="product_id"]')?.addEventListener("change",e=>{const o=e.target.selectedOptions[0];if(o?.dataset.price)e.target.form.elements.unit_price.value=o.dataset.price;});
 }
 async function produccion(){
  const {data,error}=await supabase.from("production_batches").select("id,status,planned_yield,actual_good_units,waste_units,dough_weight_g,started_at").eq("organization_id",org).order("started_at",{ascending:false}).limit(30);if(error)throw error;
  let body=form("Iniciar tanda","batch",inp("planned_yield","Unidades previstas","number",'min="0" step="0.001"')+inp("dough_weight_g","Peso de masa (g)","number",'min="0" step="0.001"')+inp("notes","Notas"),"Iniciar producción");
  body+=table(["Fecha","Peso masa","Previsto","Buenas","Merma","Estado"],(data||[]).map(x=>`<tr><td>${when(x.started_at)}</td><td>${x.dough_weight_g??"—"} g</td><td>${x.planned_yield??"—"}</td><td>${x.actual_good_units??"—"}</td><td>${x.waste_units??"—"}</td><td>${x.status==="open"?`<button class="primary" data-finish="${x.id}">Cerrar tanda</button>`:x.status}</td></tr>`).join(""),"Aún no hay tandas.");
  page("produccion","Producción y pesajes","Registra tandas, peso, rendimiento y merma.",body);
 }
 async function caja(){
  const [s,e]=await Promise.all([supabase.from("cash_sessions").select("status,opening_amount,currency,opened_at,closed_at").eq("organization_id",org).order("opened_at",{ascending:false}).limit(20),supabase.from("expenses").select("description,category,amount,currency,paid_at").eq("organization_id",org).order("paid_at",{ascending:false}).limit(40)]);
  if(s.error)throw s.error;if(e.error)throw e.error;
  const open=(s.data||[]).some(x=>x.status==="open");
  let body=open?'<div class="notice">Ya hay una caja abierta.</div>':form("Abrir caja","cash-open",inp("opening_amount","Monto inicial","number",'min="0" step="0.01"')+sel("currency","Moneda",'<option>USD</option><option>VES</option>'),"Abrir caja");
  body+=form("Registrar gasto","expense",inp("description","Concepto")+inp("category","Categoría")+inp("amount","Monto","number",'min="0.01" step="0.01"')+sel("currency","Moneda",'<option>USD</option><option>VES</option>'),"Guardar gasto");
  body+=table(["Fecha","Concepto","Categoría","Monto"],(e.data||[]).map(x=>`<tr><td>${when(x.paid_at)}</td><td>${esc(x.description)}</td><td>${esc(x.category||"—")}</td><td>${money(x.amount,x.currency)}</td></tr>`).join(""),"Aún no hay gastos.");
  body+=table(["Apertura","Fondo inicial","Estado"],(s.data||[]).map(x=>`<tr><td>${when(x.opened_at)}</td><td>${money(x.opening_amount,x.currency)}</td><td>${x.status}</td></tr>`).join(""),"No hay cajas.");
  page("caja","Caja y gastos","Aperturas, fondos y egresos.",body);
 }
 async function reportes(){
  const since=new Date(Date.now()-30*86400000).toISOString();
  const [s,e]=await Promise.all([supabase.from("sales").select("total,currency").eq("organization_id",org).eq("status","confirmed").gte("created_at",since),supabase.from("expenses").select("amount,currency").eq("organization_id",org).gte("paid_at",since)]);
  if(s.error)throw s.error;if(e.error)throw e.error;
  const sum=(a,k,c)=>(a||[]).filter(x=>x.currency===c).reduce((n,x)=>n+Number(x[k]||0),0);
  const su=sum(s.data,"total","USD"),ex=sum(e.data,"amount","USD");
  page("reportes","Reportes","Resumen de los últimos 30 días.",`<div class="metrics module-metrics"><article class="metric"><span>Ventas USD</span><strong>${money(su)}</strong></article><article class="metric"><span>Gastos USD</span><strong>${money(ex)}</strong></article><article class="metric"><span>Resultado preliminar</span><strong>${money(su-ex)}</strong><small>No descuenta costo de producción.</small></article><article class="metric"><span>Ventas Bs.</span><strong>${money(sum(s.data,"total","VES"),"VES")}</strong></article></div><div class="notice">No es utilidad neta: faltan costos de ingredientes y mano de obra.</div>`);
 }
 const renderers={ventas,clientes,inventario,produccion,caja,reportes};let active="ventas";
 async function render(id=active){active=id;await loadOptions();await renderers[id]();}
 async function submit(e){
  const f=e.target.closest("form[data-module]");if(!f)return;e.preventDefault();
  const d=new FormData(f),v=k=>d.get(k),n=k=>Number(v(k)||0),kind=f.dataset.module,b=f.querySelector("button[type=submit]");b.disabled=true;b.textContent="Guardando…";
  try{let r;
   if(kind==="customer")r=await supabase.from("customers").insert({organization_id:org,name:v("name").trim(),phone:v("phone")||null,email:v("email")||null,address:v("address")||null,notes:v("notes")||null});
   if(kind==="product")r=await supabase.from("products").insert({organization_id:org,name:v("name").trim(),category:v("category")||null,sale_price:n("sale_price"),currency:v("currency"),track_stock:d.has("track_stock")});
   if(kind==="stock"){const p=cache.products.find(x=>x.id===v("product_id"));if(!p)throw Error("Selecciona un producto.");r=await supabase.from("stock_movements").insert({organization_id:org,product_id:v("product_id"),movement_type:"purchase",quantity_delta:n("quantity"),unit:"unit",currency:p.currency,reference_type:"manual",note:"Entrada manual"});}
   if(kind==="ingredient")r=await supabase.from("ingredients").insert({organization_id:org,name:v("name").trim(),base_unit:v("base_unit"),current_quantity:n("current_quantity"),average_unit_cost:n("average_unit_cost"),currency:v("ingredient_currency"),min_quantity:n("min_quantity")});
   if(kind==="sale")r=await supabase.rpc("create_sale",{p_organization_id:org,p_product_id:v("product_id"),p_quantity:n("quantity"),p_unit_price:n("unit_price"),p_customer_id:v("customer_id")||null,p_payment_amount:n("payment_amount"),p_payment_method:v("payment_method"),p_notes:v("notes")||null});
   if(kind==="batch"){const u=await supabase.auth.getUser();r=await supabase.from("production_batches").insert({organization_id:org,planned_yield:n("planned_yield")||null,dough_weight_g:n("dough_weight_g")||null,notes:v("notes")||null,started_by:u.data.user.id});}
   if(kind==="expense"){const u=await supabase.auth.getUser();r=await supabase.from("expenses").insert({organization_id:org,description:v("description").trim(),category:v("category")||null,amount:n("amount"),currency:v("currency"),created_by:u.data.user.id});}
   if(kind==="cash-open"){const q=await supabase.from("cash_sessions").select("id").eq("organization_id",org).eq("status","open").limit(1);if(q.error)throw q.error;if(q.data.length)throw Error("Ya existe una caja abierta.");const u=await supabase.auth.getUser();r=await supabase.from("cash_sessions").insert({organization_id:org,opening_amount:n("opening_amount"),currency:v("currency"),opened_by:u.data.user.id});}
   if(r?.error)throw r.error;notify("Guardado correctamente.");await refreshDashboard();await render(active);
  }catch(err){notify(err.message||"No se pudo guardar.",true);b.disabled=false;b.textContent="Reintentar";}
 }
 document.addEventListener("submit",submit);
 document.addEventListener("click",async e=>{
  const nav=e.target.closest("[data-page]");if(nav&&renderers[nav.dataset.page])render(nav.dataset.page).catch(x=>notify(x.message,true));const action=e.target.closest("[data-action]");const targets={"new-sale":"ventas","add-customer":"clientes","add-stock":"inventario","new-batch":"produccion","add-expense":"caja"};if(action&&targets[action.dataset.action])render(targets[action.dataset.action]).catch(x=>notify(x.message,true));
  const finish=e.target.closest("[data-finish]");if(finish){const good=Number(prompt("Unidades buenas producidas"));if(!Number.isFinite(good)||good<0)return;const waste=Number(prompt("Unidades de merma","0"));if(!Number.isFinite(waste)||waste<0)return;const u=await supabase.auth.getUser();const r=await supabase.from("production_batches").update({status:"closed",actual_good_units:good,waste_units:waste,closed_at:new Date().toISOString(),closed_by:u.data.user.id}).eq("organization_id",org).eq("id",finish.dataset.finish).eq("status","open");if(r.error)notify(r.error.message,true);else{notify("Tanda cerrada.");await render("produccion");}}
 });
 await render("ventas");return {refresh:()=>render(active)};
}
