# Aster Cloud Billing v0.1 implementation contract

Working product name: Aster Cloud (星屿云), placeholder and changeable. Chinese-first UI with Apple-inspired restraint, original branding. Scope: a custom production-oriented financial system with separate frontend/backend. VM controller implementation is outside this release. No live payments, external deployment, or real provisioning authorized/configured. Clearly mark demonstration data and simulated operations. Do not claim production certification.

Architecture: Vue 3 + TypeScript + Vite frontend; Go HTTP API; MySQL InnoDB production store. Optional explicitly non-production in-memory store for local demo only. Session cookies HttpOnly, CSRF protection for browser mutations, RBAC/customer ownership, exact minor-unit monetary values, audit events, durable transactional outbox for future controller integration. Payment integration fail closed when no real provider is configured. Modular monolith. The durable outbox is present; its execution worker is not implemented in this release. USD as clearly provisional demo currency, monthly fixed-plan demos. No stored-card collection. No wallet funding feature.

API prefix /api/v1. JSON responses {data: ...}; errors {error:{code:string,message:string,request_id?:string}}. Dates RFC3339 UTC. Money integer cents in amount_minor/price_minor, currency USD.

Endpoints for the first integrated UI:
- GET /healthz and /readyz outside prefix.
- GET /api/v1/session -> data {user: User|null,csrf_token:string,demo_mode:boolean}; same-origin cookie authentication. User {id,email,name,role:"customer"|"admin"}.
- POST /api/v1/auth/login {email,password}, POST /auth/logout. CSRF header X-CSRF-Token from session response. POST /auth/register {email,password,name} if implemented, otherwise UI must not pretend functional.
- GET /plans -> Plan[] {id,name,description,cpu,memory_gb,disk_gb,transfer_tb,region,price_minor,currency,available:boolean}.
- GET /overview -> {active_services:number,pending_invoices:number,monthly_total_minor:number,currency:string,recent_orders:Order[],usage?:...}.
- GET /services -> Service[] {id,name,plan_name,region,ipv4,status,next_due_at,price_minor,currency,cpu,memory_gb,disk_gb}.
- GET /orders -> Order[] {id,number,plan_name,status,total_minor,currency,created_at,service_id?:string}.
- POST /orders {plan_id,hostname} with Idempotency-Key -> Order. Server sets price and owner. No real provisioning on creation.
- GET /invoices -> Invoice[] {id,number,order_id,status,amount_minor,currency,issued_at,due_at,paid_at?:string}.
- GET /invoices/{id} -> Invoice plus optional line_items.
- POST /invoices/{id}/checkout -> when no provider configured, 503 PAYMENT_NOT_CONFIGURED. UI must say not connected, never imply paid.
- GET /audit -> Audit[] {id,action,target,created_at,actor_email,detail}; customers limited to own safe events, admin can see administrative events.
- GET /admin/overview -> {customers,total_services,unpaid_invoices,revenue_minor,currency}; admin only.
- GET /admin/customers -> User[] admin only.
- GET /admin/orders, GET /admin/invoices -> arrays admin only.

Frontend should always consume HTTP API for actual mutations; graceful backend unavailable state, no silent fake success. A visible dedicated demo mode may use fixtures for read-only visual preview if API unavailable, but clearly label it, and do not treat it as production. Prefer runnable API demo integration over fixtures. Obtain credentials from backend README demo mode; never hard-code production credentials or secrets. Demo selection can be prominent login helper.

Directory layout: backend/ contains API and database code; frontend/ contains the web interface; deploy/ contains deployment templates; docs/ contains specifications and release gates. See implementation and validation records for implemented features and limitations.

## Provider adapter extension (v0.2)

GET /api/v1/admin/integrations is admin-only and returns data {items:[{id,kind,name,description,enabled,configured,status,capabilities,configuration_fields,configuration_mode,limitations}]}. This is a read-only manifest/configuration-status endpoint, not an upload or secret-management API. Payment and email are typed, statically registered adapters. Additional code adapters require rebuild/redeploy. Registry entries do not imply a live provider is connected. Core retains invoice ownership, amount/currency and state control. Secret values and secret references must never be returned.
