import { createClient } from "@supabase/supabase-js";
import { mountModules } from "./modules.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authScreen = document.getElementById("authScreen");
const authTitle = document.getElementById("authTitle");
const authDescription = document.getElementById("authDescription");
const authMessage = document.getElementById("authMessage");
const appShell = document.querySelector(".app-shell");
const toast = document.getElementById("toast");
let supabase = null;
let currentOrg = null;
let modules = null;

function message(text, success = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle("success", success);
}

function notify(text, isError = false) {
  toast.textContent = text;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3200);
}

async function getMembership(userId) {
  const { data, error } = await supabase.from("organization_memberships")
    .select("organization_id, role, organizations(id,name,slug,timezone)")
    .eq("user_id", userId).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadWorkspace(session) {
  const membership = await getMembership(session.user.id);
  if (!membership?.organizations) {
    throw new Error("No se encontró el espacio de trabajo de esta sesión. Por seguridad, la aplicación no crea organizaciones nuevas desde el navegador. Conserva la sesión original del dispositivo.");
  }
  currentOrg = membership.organizations;
  document.getElementById("workspaceName").textContent = currentOrg.name;
  document.getElementById("userLabel").textContent = "Propietario";
  document.getElementById("userEmail").textContent = "Acceso automático";
  document.getElementById("welcomeTitle").textContent = "¡Hola! 👋";
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  await loadDashboard();
  modules = await mountModules({ supabase, organization: currentOrg, notify, refreshDashboard: loadDashboard });
}

async function loadDashboard() {
  const orgId = currentOrg.id;
  const [sales, customers, products, recent] = await Promise.all([
    supabase.from("sales").select("total,currency").eq("organization_id", orgId).eq("status", "confirmed"),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("active", true),
    supabase.from("sales").select("sale_number,total,currency,status,created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(5)
  ]);
  if (sales.error) throw sales.error;
  if (customers.error) throw customers.error;
  if (products.error) throw products.error;
  if (recent.error) throw recent.error;
  const totals = sales.data || [];
  const totalUsd = totals.filter(x => x.currency === "USD").reduce((sum, x) => sum + Number(x.total || 0), 0);
  const totalVes = totals.filter(x => x.currency === "VES").reduce((sum, x) => sum + Number(x.total || 0), 0);
  document.getElementById("metricRevenue").textContent = "$" + totalUsd.toFixed(2) + (totalVes ? " + Bs. " + totalVes.toFixed(2) : "");
  document.getElementById("metricSales").textContent = String(totals.length);
  document.getElementById("metricCustomers").textContent = String(customers.count || 0);
  document.getElementById("metricProducts").textContent = String(products.count || 0);
  const tbody = document.getElementById("recentSales");
  tbody.replaceChildren();
  if (!recent.data?.length) {
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 4; td.textContent = "Todavía no hay ventas registradas."; tr.append(td); tbody.append(tr);
  } else {
    for (const sale of recent.data) {
      const tr = document.createElement("tr");
      const cells = ["#" + sale.sale_number, new Date(sale.created_at).toLocaleDateString("es-VE"), (sale.currency === "VES" ? "Bs. " : "$") + Number(sale.total).toFixed(2), sale.status === "confirmed" ? "Confirmada" : sale.status];
      cells.forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
      tbody.append(tr);
    }
  }
}

async function startApp() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    authTitle.textContent = "Configuración pendiente";
    authDescription.textContent = "Falta configurar la conexión con Supabase en Vercel Preview.";
    message("No están configuradas las variables públicas de Supabase. No introduzcas claves secretas aquí.");
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  try {
    authTitle.textContent = "Preparando Que Roles";
    authDescription.textContent = "Estamos abriendo tu espacio de trabajo…";
    const { data: existing, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    let session = existing.session;
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        if (/anonymous|disabled|not enabled/i.test(error.message || "")) {
          throw new Error("Falta activar el acceso anónimo en Supabase: Authentication → Sign In / Providers → Anonymous Sign-Ins.");
        }
        throw error;
      }
      session = data.session;
    }
    if (!session) throw new Error("Supabase no devolvió una sesión válida.");
    await loadWorkspace(session);
  } catch (error) {
    authTitle.textContent = "No se pudo abrir Que Roles";
    authDescription.textContent = "Revisa la conexión e inténtalo nuevamente.";
    message(error.message || "Error de conexión con Supabase.");
  }
}

const titleMap={inicio:"Resumen del negocio",ventas:"Ventas",clientes:"Clientes",inventario:"Inventario",produccion:"Producción y pesajes",caja:"Caja y gastos",reportes:"Reportes"};
const pages=[...document.querySelectorAll(".page")], nav=[...document.querySelectorAll("[data-page]")], title=document.getElementById("pageTitle"), sidebar=document.querySelector(".sidebar");
function showPage(id){if(!titleMap[id])return;pages.forEach(p=>p.classList.toggle("hidden",p.id!==id));nav.forEach(n=>n.classList.toggle("active",n.dataset.page===id));title.textContent=titleMap[id];sidebar.classList.remove("open");history.replaceState(null,"","#"+id);window.scrollTo({top:0,behavior:"smooth"});}
document.addEventListener("click",e=>{
  const p=e.target.closest("[data-page]");
  if(p){e.preventDefault();showPage(p.dataset.page);return;}
  const a=e.target.closest("[data-action]");
  if(a){const targets={"new-sale":"ventas","add-customer":"clientes","add-stock":"inventario","new-batch":"produccion","add-expense":"caja"};if(targets[a.dataset.action])showPage(targets[a.dataset.action]);}
});
document.getElementById("menuBtn").addEventListener("click",()=>sidebar.classList.toggle("open"));
showPage(location.hash.slice(1)||"inicio");
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/admin/sw.js").catch(()=>{});
startApp();
