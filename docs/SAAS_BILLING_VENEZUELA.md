# Que Roles SaaS — estrategia de cobro (Venezuela, USD)

## Decisión provisional

Proveedor prioritario para evaluación técnica: Pagolink, sujeto a alta comercial, revisión contractual, documentación API y prueba real en sandbox antes de activarlo. Su información pública describe domiciliación recurrente, cobros con precio definido en USD y débito en bolívares a la tasa del día, métodos locales venezolanos y API/webhooks. Esto se aproxima al modelo requerido, pero no constituye aprobación ni garantía de disponibilidad para Que Roles SaaS.

Referencias públicas consultadas:
- https://pagolink.co/
- https://www.unopago.com/comercios
- https://www.venflow.app/
- https://developer.paypal.com/payouts/supported-features/

## Evaluación de alternativas

### Pagolink — candidato principal
Ventajas declaradas públicamente: domiciliación mensual, precio en USD convertido a VES al tipo de cambio del día, API y webhook, Pago Móvil, C2P, débito inmediato y transferencia. Publica que requiere cuenta bancaria venezolana y que los fondos se liquidan directamente en la cuenta del comercio. Confirmar onboarding de SaaS, requisitos de empresa, tarifas, API docs, sandbox, webhooks firmados, reintentos, cancelaciones y exportación/conciliación.

### UnoPago — alternativa si se dispone de cuenta bancaria/empresa en EE. UU.
Su información pública indica suscripciones automáticas ACH mediante Stripe con cuenta bancaria estadounidense. En Venezuela ofrece Pago Móvil, C2P, débito inmediato, transferencia y Zelle. No asumir que la vía ACH está disponible sin una cuenta estadounidense elegible y aprobación del proveedor.

### Venflow — alternativa local a evaluar
Publica domiciliación y API para recurrencia en Venezuela, pero indica que actualmente opera cobros en bolívares. Por ello no es la primera elección para el modelo de precios USD sin confirmar cómo se podría representar y fijar el precio en USD.

### PayPal
La documentación oficial de PayPal incluye Venezuela en la tabla de países con capacidades de envío, recepción y retiro, con restricciones de moneda. No asumir que todas las funciones de suscripciones de PayPal están disponibles para una cuenta venezolana. Verificar el producto exacto y la elegibilidad de la cuenta antes de integrar.

## Diseño técnico independiente del proveedor

La base de datos tendrá tablas de planes, suscripciones por organización, eventos de facturación, intentos de cobro y registros de webhook.

Reglas:
1. Los precios SaaS se expresan en USD como moneda de referencia.
2. El proveedor puede liquidar en VES; guardar monto/moneda solicitados, monto/moneda liquidados y tipo de cambio reportado.
3. Activar/renovar solo después de confirmación verificable del proveedor; nunca por captura de pantalla del cliente ni por redirect del navegador.
4. Validar firma del webhook, fecha, identificador del evento y evitar procesar dos veces el mismo evento.
5. Permitir período de gracia configurable y estados trialing, active, past_due, paused, canceled e incomplete.
6. Permitir cancelación y consulta de facturación desde el panel.
7. Nunca almacenar números de tarjeta, CVV, claves bancarias ni credenciales de domiciliación.

## Condición de salida a producción

No activar cobros reales hasta recibir confirmación escrita del proveedor sobre la elegibilidad de Que Roles SaaS, revisar contrato/tarifas, completar pruebas de sandbox y probar el ciclo de alta, primer pago, renovación, fallo, reintento, cancelación, reembolso y webhook duplicado.
