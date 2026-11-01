import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authScreen = document.getElementById("authScreen");
const appShell = document.querySelector(".app-shell");
const authForm = document.getElementById("authForm");
const orgForm = document.getElementById("orgForm");
const authMessage = document.getElementById("authMessage");
const authSwitch = document.getElementById("authSwitch");
const authTitle = document.getElementById("authTitle");
const authDescription = document.getElementById("authDescription");
const authSubmit = document.getElementById("authSubmit");
const nameField = document.getElementById("nameField");
const signOutAuth = document.getElementById("signOutAuth");
let supabase = null;
let authMode = "login";
let currentOrg = null;

function message(text, success = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle("success", success);
}
function setMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  authTitle.textContent = signup ? "Crea tu cuenta" : "Bienvenido";
  authDescription.textContent = signup ? "Regístrate para crear el espacio de trabajo de tu negocio." : "Inicia sesión para entrar a tu espacio de trabajo.";
  nameField.classList.toggle("hidden", !signup);
  document.getElementById("fullName").required = signup;
  authSubmit.textContent = signup ? "Crear cuenta" : "Iniciar sesión";
  authSwitch.textContent = signup ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta";
  document.getElementById("password").autocomplete = signup ? "new-password" : "current-password";
  message("");
}
function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63);
}
function showOnboarding() {
  authForm.classList.add("hidden");
  authSwitch.classList.add("hidden");
  orgForm.classList.remove("hidden");
  signOutAuth.classList.remove("hidden");
  authTitle.textContent = "Un último paso";
  authDescription.textContent = "Tu cuenta está lista. Ahora crea tu negocio.";
  message("");
}
async function loadWorkspace(session) {
  const { data, error } = await supabase.from("organization_memberships")
    .select("organization_id, role, organizations(id,name,slug,timezone)")
    .eq("user_id", session.user.id).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.organizations) {
    showOnboarding();
    return;
  }
  currentOrg = data.organizations;
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  document.getElementById("workspaceName").textContent = currentOrg.name;
  document.getElementById("userEmail").textContent = session.user.email || "";
  document.getElementById("userLabel").textContent = session.user.user_metadata?.full_name || "Mi cuenta";
  document.getElementById("welcomeTitle").textContent = "¡Hola, " + (session.user.user_metadata?.full_name?.split(" ")[0] || "bienvenido") + "! 👋";
  await loadDashboard();
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
      cells.forEach((value, i) => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
      tbody.append(tr);
    }
  }
}
async function handleSession(session) {
  if (!session) {
    currentOrg = null;
    appShell.classList.add("hidden");
    authScreen.classList.remove("hidden");
    authForm.classList.remove("hidden");
    orgForm.classList.add("hidden");
    authSwitch.classList.remove("hidden");
    signOutAuth.classList.add("hidden");
    return;
  }
  try { await loadWorkspace(session); }
  catch (error) { authScreen.classList.remove("hidden"); appShell.classList.add("hidden"); message("No se pudo cargar tu negocio: " + (error.message || "Error de conexión")); }
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  authTitle.textContent = "Configuración pendiente";
  authDescription.textContent = "La interfaz ya está preparada. Falta configurar las variables públicas de conexión de Supabase en el entorno Preview de Vercel.";
  authForm.classList.add("hidden"); authSwitch.classList.add("hidden");
  message("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. No introduzcas aquí claves secretas.");
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supabase.auth.getSession().then(({ data, error }) => error ? message(error.message) : handleSession(data.session));
  supabase.auth.onAuthStateChange((_event, session) => { if (session) setTimeout(() => handleSession(session), 0); });
}
authSwitch.addEventListener("click", () => setMode(authMode === "login" ? "signup" : "login"));
authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;
  authSubmit.disabled = true; message("Procesando...");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    if (authMode === "signup") {
      const fullName = document.getElementById("fullName").value.trim();
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw error;
      if (data.session) {
        await supabase.from("profiles").upsert({ user_id: data.user.id, full_name: fullName });
        await handleSession(data.session);
      } else {
        message("Cuenta creada. Revisa tu correo y confirma la dirección antes de iniciar sesión.", true);
        setMode("login");
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await handleSession(data.session);
    }
  } catch (error) { message(error.message || "No se pudo completar la operación."); }
  finally { authSubmit.disabled = false; }
});
orgForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;
  const name = document.getElementById("orgName").value.trim();
  const slug = slugify(name);
  const button = orgForm.querySelector("button");
  button.disabled = true; message("Creando tu negocio...");
  try {
    if (slug.length < 2) throw new Error("El nombre debe contener al menos dos letras o números.");
    const { data, error } = await supabase.rpc("create_organization", { p_name: name, p_slug: slug });
    if (error) throw error;
    const { data: sessionData } = await supabase.auth.getSession();
    await handleSession(sessionData.session);
  } catch (error) { message(error.message || "No se pudo crear el negocio."); }
  finally { button.disabled = false; }
});
async function logout() { if (supabase) await supabase.auth.signOut(); }
document.getElementById("signOut").addEventListener("click", logout);
signOutAuth.addEventListener("click", logout);
const titleMap={inicio:"Resumen del negocio",ventas:"Ventas",clientes:"Clientes",inventario:"Inventario",produccion:"Producción y pesajes",caja:"Caja y gastos",reportes:"Reportes"};
const pages=[...document.querySelectorAll(".page")], nav=[...document.querySelectorAll("[data-page]")], title=document.getElementById("pageTitle"), sidebar=document.querySelector(".sidebar"), toast=document.getElementById("toast");
function showPage(id){if(!titleMap[id])return;pages.forEach(p=>p.classList.toggle("hidden",p.id!==id));nav.forEach(n=>n.classList.toggle("active",n.dataset.page===id));title.textContent=titleMap[id];sidebar.classList.remove("open");history.replaceState(null,"","#"+id);window.scrollTo({top:0,behavior:"smooth"});}
document.addEventListener("click",e=>{const p=e.target.closest("[data-page]");if(p){e.preventDefault();showPage(p.dataset.page);return;}const a=e.target.closest("[data-action]");if(a){const labels={"new-sale":"El módulo de ventas se activará en la siguiente etapa.","add-customer":"El módulo de clientes se activará en la siguiente etapa.","add-stock":"El inventario se activará en la siguiente etapa.","new-batch":"Producción y pesajes se activarán en la siguiente etapa.","add-expense":"Caja y gastos se activarán en la siguiente etapa."};toast.textContent=labels[a.dataset.action]||"Disponible próximamente.";toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),2600);}});
document.getElementById("menuBtn").addEventListener("click",()=>sidebar.classList.toggle("open"));
showPage(location.hash.slice(1)||"inicio");
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/admin/sw.js").catch(()=>{});
