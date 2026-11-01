# Que Roles SaaS — Arquitectura y plan de construcción

## Decisiones de producto

- Producto: SaaS multiempresa para panaderías, pastelerías y negocios de comida.
- Primer negocio piloto: Que Roles.
- Canal prioritario: móvil; aplicación web progresiva (PWA), adaptable a tablet y escritorio.
- Monetización: suscripción mensual por negocio, con planes y límites configurables.
- La web pública actual de pedidos se conserva. El sistema administrativo se construirá como una aplicación separada bajo una ruta o subdominio propio, sin sustituir el flujo actual de pedidos.

## Estado inicial verificado

La aplicación pública actual presenta el catálogo/marketing de Que Roles y un formulario que prepara pedidos para WhatsApp. El pedido incluye paquetes de tres roles, coberturas, retiro/envío, referencia de pago y conversión USD/bolívares con tasa consultada desde un endpoint. El flujo visible no equivale todavía a un sistema administrativo: no hay evidencia en la aplicación revisada de persistencia de clientes, ventas, movimientos de inventario, recetas, producción, caja o usuarios internos.

El repositorio HernanT23/que-roles está conectado a un proyecto Vercel llamado que-roles. Esta implementación se trabajará inicialmente en la rama saas-foundation; no se modificará main ni se reemplazará el sitio público.

## Arquitectura objetivo

- Frontend: React + TypeScript + Vite.
- UI: Tailwind CSS, componentes accesibles y diseño mobile-first.
- PWA: manifest, service worker, instalación y caché controlada.
- Backend: Supabase (PostgreSQL, Auth, Storage y Edge Functions cuando se necesiten).
- Autorización: Supabase Auth + Row Level Security (RLS) obligatoria en todas las tablas de negocio.
- Hosting: Vercel para la app administrativa; dominio actual de pedidos permanece intacto.
- Suscripciones: capa de facturación desacoplada del proveedor. Seleccionar proveedor después de confirmar países de venta, moneda y disponibilidad de cobro.
- Observabilidad: registro de errores, auditoría de acciones sensibles y alertas de fallos de sincronización.

## Aislamiento multiempresa

Cada registro operativo llevará organization_id. Un usuario accederá a una organización mediante organization_memberships; la pertenencia y el rol se validarán en servidor y mediante políticas RLS. Nunca se confiará en un organization_id enviado por el navegador sin comprobar membresía.

Roles iniciales:
- owner: propietario y configuración/facturación.
- admin: administración del negocio.
- manager: reportes, inventario, compras y operaciones.
- cashier: ventas, clientes y cobros.
- production: recetas, pesajes, tandas y mermas.

La cuenta de plataforma (superadministración SaaS) se separará de los usuarios de cada negocio. Las claves service_role nunca se incluirán en el cliente.

## Dominios y entidades principales

### Identidad y SaaS
- organizations
- profiles
- organization_memberships
- subscription_plans
- organization_subscriptions
- billing_events

### Catálogo, clientes y ventas
- products
- product_variants
- customers
- sales
- sale_items
- payments
- delivery_orders

### Ingredientes, recetas y producción
- ingredients
- ingredient_lots (opcional en MVP; lote, vencimiento y costo)
- recipes
- recipe_items
- production_batches
- production_batch_inputs
- production_batch_outputs
- waste_records

### Inventario y dinero
- stock_movements
- cash_registers
- cash_sessions
- cash_movements
- expenses
- suppliers
- purchase_orders
- purchase_order_items

### Control y soporte
- audit_logs
- exchange_rates
- app_settings

## Reglas contables y operativas importantes

1. Los importes se almacenan como numeric/decimal, nunca como float.
2. Cada venta conserva el precio, descuento, moneda y tasa de cambio aplicados en el momento de la operación; cambios posteriores no reescriben el historial.
3. Un pago no es lo mismo que una venta: se permiten abonos, pagos pendientes y reembolsos registrados.
4. La ganancia no se calcula como saldo de caja. Se calcula a partir de ventas netas menos costo de ventas y gastos, con reportes claramente separados de flujo de caja.
5. Cada movimiento de inventario es un registro inmutable de entrada/salida/ajuste. Las correcciones se realizan con movimientos compensatorios, no borrando el historial.
6. Las unidades base serán gramos, mililitros y unidades; cada ingrediente define su unidad y conversión permitida.
7. Al cerrar una tanda se consumen los ingredientes realmente pesados y se registran las unidades/productos realmente obtenidos. El rendimiento y la merma se calculan con datos reales.
8. La venta de productos fabricados descuenta producto terminado. La producción consume ingredientes. No se debe descontar dos veces la misma receta en la venta.
9. Las operaciones sensibles (anular venta, ajustar stock, cerrar caja, reembolsar, cambiar receta) requieren permiso y dejan auditoría.
10. Los pedidos provenientes del sitio público/WhatsApp se podrán importar o registrar; no se asumirá que un clic en WhatsApp constituye una venta pagada.

## Flujo de pesaje y producción

1. Elegir receta y tamaño de tanda.
2. Mostrar cantidades teóricas por ingrediente.
3. Registrar peso real de cada ingrediente, tara y unidad.
4. Registrar peso total de masa y número/peso de piezas formadas.
5. Registrar coberturas y consumos adicionales.
6. Registrar piezas buenas, dañadas, sobrantes y merma.
7. Cerrar la tanda: crear movimientos de consumo de ingredientes y entradas de producto terminado.
8. Calcular costo real por tanda y por unidad usando costos de inventario vigentes.

La receta es una guía versionada; una tanda cerrada conserva una fotografía de la receta y de los costos utilizados.

## MVP por fases

### Fase 0 — Fundaciones y seguridad
- Crear app administrativa separada del sitio público.
- Preparar entornos local/preview/producción.
- Configurar Supabase y migraciones versionadas.
- Definir RLS, roles, auditoría y pruebas de aislamiento entre organizaciones.
- No cargar datos reales hasta superar pruebas de seguridad.

### Fase 1 — Operación diaria
- Inicio de sesión, alta de negocio y miembros.
- Panel móvil con ventas, pedidos, caja y alertas.
- Productos, clientes, ventas y pagos parciales.
- Apertura/cierre de caja y gastos.
- Historial y reportes básicos.

### Fase 2 — Inventario y producción
- Ingredientes, proveedores y compras.
- Recetas con cantidades y costos.
- Registro de pesajes y tandas.
- Mermas, producto terminado y movimientos automáticos.
- Costo real por unidad y rentabilidad.

### Fase 3 — SaaS comercial
- Planes, prueba gratuita, límites y estado de suscripción.
- Portal de facturación y cancelación.
- Onboarding multiempresa.
- Panel de administración de plataforma.
- Métricas de uso y soporte.

## Criterios de aceptación antes de producción

- Las políticas RLS se prueban con dos organizaciones distintas.
- Ningún usuario puede leer o modificar registros de otra organización, incluso manipulando peticiones.
- Las operaciones de venta, pago, inventario y caja son transaccionales e idempotentes.
- Hay respaldo y procedimiento de restauración probado.
- Las migraciones se prueban en preview antes de producción.
- No hay secretos en Git ni en el bundle del navegador.
- Los cálculos de costos, inventario y saldos se validan con casos de prueba.
- Se conserva el sitio público actual y su flujo de pedidos.

## Pendientes para conectar servicios

- Crear/seleccionar proyecto Supabase exclusivo para Que Roles SaaS (no reutilizar bases de datos de otros proyectos).
- Definir dominio de la app administrativa.
- Confirmar país(es) donde se venderán las suscripciones y moneda/proveedor de cobro.
- Configurar variables de entorno solo en Vercel/Supabase; nunca subirlas al repositorio.
