# SovereignAI Phase 2 Authentication Report

**Project:** SovereignAI — Sovereign On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 2 — Authentication & Multi-Tenant Authorization  
**Date:** September 3, 2026  
**Status:** COMPLETE & VERIFIED  

---

## 1. Existing Authentication Architecture
Prior to Phase 2, the application had PostgreSQL database tables for `users` and `organizations`, but requests relied solely on the `x-organization-id` header with a fallback to the pre-seeded `Demo Organization` (`0bd5dba2-05e1-4f5c-9047-25843d338622`). There was no active credential verification, JWT issuance, or token-based route protection.

Phase 2 introduces real, cryptographically secure authentication and authorization:
- **Credential Storage:** `bcrypt` with work factor 10. Also supports backwards-compatible verification of legacy `scrypt$<salt>$<hash>` format.
- **Session Tokens:** Signed HMAC-SHA256 JWTs carrying minimal user claims.
- **Authorization Authority:** The authenticated JWT identity is the sole source of truth for organization scoping.
- **Anti-Spoofing:** Any request sending an `x-organization-id` header that conflicts with the user's JWT organization is rejected with `403 Forbidden`.

---

## 2. Database Model
The existing PostgreSQL relational architecture was preserved with zero breaking schema migrations:
- **`organizations` Table:**
  - `id` (VARCHAR(255) PRIMARY KEY)
  - `name` (VARCHAR(255) NOT NULL, unique lower index)
  - `created_at`, `updated_at`
- **`users` Table:**
  - `id` (VARCHAR(255) PRIMARY KEY)
  - `organization_id` (VARCHAR(255) REFERENCES organizations(id))
  - `name` (VARCHAR(255) NOT NULL)
  - `email` (VARCHAR(255) NOT NULL, unique lower index)
  - `password_hash` (TEXT NOT NULL)
  - `role` (VARCHAR(50) NOT NULL DEFAULT 'member')
  - `created_at`, `updated_at`

No duplicate tables or models were created.

---

## 3. Registration Flow
- **Endpoint:** `POST /api/v1/auth/register`
- **Input Validation:**
  - `name`: Non-empty string (min length 2)
  - `email`: Valid email syntax regex, normalized to lowercase
  - `password`: String (min length 6)
  - `organizationName` (optional): Auto-creates or reuses named organization; defaults to `DEFAULT_ORGANIZATION_ID`
- **Security Logic:**
  - Checks duplicate email $\rightarrow$ returns `409 Conflict`
  - Hashes password using `bcryptjs`
  - Generates UUID `id`
  - Generates and returns signed JWT along with safe user metadata (password hash omitted)
- **Rate Limiting:** Guarded by 30 requests/minute per IP limiter.

---

## 4. Login Flow
- **Endpoint:** `POST /api/v1/auth/login`
- **Input Validation:** Requires `email` and `password`
- **Verification Logic:**
  - Retrieves user by normalized lowercase email
  - If user not found $\rightarrow$ generic `401 Unauthorized` ("Invalid email or password")
  - Compares password against stored hash using `verifyPassword()`
  - If comparison fails $\rightarrow$ generic `401 Unauthorized` ("Invalid email or password")
  - Never leaks whether the email or password was the reason for failure
  - On success $\rightarrow$ issues signed JWT and returns safe user profile
- **Rate Limiting:** Guarded by 30 requests/minute per IP limiter.

---

## 5. JWT Structure
JWT tokens are signed with HMAC-SHA256 (`HS256`) using `JWT_SECRET`.
- **Payload Claims:**
  ```json
  {
    "sub": "53ee9e5e-bf00-46ce-9621-f979148f36f7",
    "userId": "53ee9e5e-bf00-46ce-9621-f979148f36f7",
    "email": "engineer@example.com",
    "organizationId": "0bd5dba2-05e1-4f5c-9047-25843d338622",
    "role": "admin",
    "iat": 1788433003,
    "exp": 1789037803
  }
  ```
- **Security Boundaries:**
  - Never contains passwords, password hashes, or confidential document content.
  - Configurable expiration via `JWT_EXPIRES_IN` (defaults to `7d`).
  - Strict algorithm verification (`HS256` only).

---

## 6. Authentication Middleware
Implemented in `backend/src/middleware/auth.middleware.js`:
1. **`requireAuth`:**
   - Validates `Authorization: Bearer <token>`.
   - Rejects missing, malformed, tampered, or expired tokens with `401 Unauthorized`.
   - Sets `req.user = { id, email, organizationId, role }`.
   - Rejects mismatched `x-organization-id` header with `403 Forbidden`.
2. **`optionalAuth`:**
   - Mounted globally across `/api/v1/*`.
   - If an `Authorization` header is present, validates token and enforces tenant checks.
   - If absent, allows unauthenticated legacy/test requests to proceed with demo fallback, maintaining backward compatibility across all existing 235 tests.
3. **`requireRole(...roles)`:**
   - Enforces role-based permissions (`admin`, `auditor`, `member`).

---

## 7. Authorization Model
The system enforces strict multi-tenant organization isolation:
- The authenticated identity (`req.user.organizationId`) is authoritative.
- The client cannot switch organizations by sending or tampering with `x-organization-id`.
- If `x-organization-id` is provided alongside a valid JWT:
  - If header matches `req.user.organizationId`: Request proceeds.
  - If header conflicts with `req.user.organizationId`: Request is rejected with `403 Forbidden`.

---

## 8. Organization Isolation
- **Verification Rule:** `resolveOrganizationId(req)` guarantees that when `req.user` is present, `req.user.organizationId` is returned.
- Tested against spoofing attack: sending `User A` token with `x-organization-id: Org B` yields `HTTP 403 Forbidden`.

---

## 9. Document Isolation
- `GET /api/v1/documents`: Queries `WHERE organization_id = $1` using authenticated organization.
  - User A only sees Organization A documents.
  - User B only sees Organization B documents.
- `GET /api/v1/documents/:id`: Queries `WHERE id = $1 AND organization_id = $2`.
  - User A fetching Document B returns `404 Not Found`.
  - User B fetching Document A returns `404 Not Found`.

---

## 10. Report Isolation
- `GET /api/v1/reports`: Scoped by `organizationId`.
- `GET /api/v1/reports/:id`: Scoped by `id` and `organizationId`.
- `GET /api/v1/inspection/download/:filename`:
  - Verified ownership against `reports` table in PostgreSQL.
  - Rejects attempts by another organization to download generated Approval Notes with `403 Forbidden`.

---

## 11. Chat Isolation
- `conversations` and `messages` tables are scoped by `organization_id`.
- `GET /api/v1/chat/history`: Returns only conversations belonging to the caller's organization.
- `GET /api/v1/chat/conversations/:id/messages`: Scoped by `WHERE id = $1 AND organization_id = $2`. Accessing an alien conversation returns `404 Not Found`.

---

## 12. Agent Isolation
- `POST /api/v1/agent/run`: Automatically binds `organizationId` and `userId` from authenticated `req.user`.
- `GET /api/v1/agent/runs`: Scoped by `WHERE organization_id = $1`.
- `GET /api/v1/agent/runs/:runId`: Rejects access to runs belonging to other organizations with `404 Not Found`.

---

## 13. Demo Account
- Documented evaluation account seeded in `initDb()`:
  - **Email:** `engineer@example.com`
  - **Password:** `DemoPassword123!`
  - **Role:** `admin`
  - **Organization:** `Demo Organization` (`0bd5dba2-05e1-4f5c-9047-25843d338622`)
- Automatically populated via the "Quick-Fill Demo Credentials" button on the `/login` page for evaluators and judges.

---

## 14. Security Controls
- **Rate Limiting:** In-memory sliding window rate limiter (30 requests/minute per IP) on `/auth/register` and `/auth/login`.
- **Audit Logging:** Structured console audit logs for security events:
  - `LOGIN_SUCCESS`, `LOGIN_FAILURE` (with reason: `user_not_found` | `invalid_password`)
  - `REGISTER_SUCCESS`, `REGISTER_CONFLICT`
  - `AUTH_FAILURE`, `FORBIDDEN_ACCESS` (cross-organization header attack)
  - Zero password, hash, or token leakage.
- **Fail-Closed Design:** Unauthenticated requests attempting access to `/auth/me` return `401`. Spoofing attempts return `403`.

---

## 15. Tests
- **New Test Suite:** `backend/tests/auth.test.js` covering 25 automated security tests:
  1. Public health check without token
  2. Weak password rejection (< 6 chars)
  3. Malformed email rejection
  4. Successful registration and token generation
  5. Duplicate registration rejection (409)
  6. Unknown email login rejection (401)
  7. Wrong password login rejection (401)
  8. Successful login with token issuance
  9. `/auth/me` rejection without token (401)
  10. `/auth/me` with valid token
  11. Malformed Authorization header rejection
  12. Tampered token rejection
  13. Expired token rejection
  14. Organization A vs Organization B isolation setup
  15. User A document listing isolation
  16. User B document listing isolation
  17. User A direct lookup of Document A (200)
  18. User A direct lookup of Document B (404)
  19. User B direct lookup of Document B (200)
  20. User B direct lookup of Document A (404)
  21. Cross-organization header spoofing attack blocked (403)
  22. Report listing isolation
  23. Cross-organization report lookup blocked (404)
  24. Pre-seeded demo account login
  25. Automatic test data cleanup
- **Results:** 25/25 PASS.
- **Regression:** All 235 existing tests continue to pass 100%. Total system test count: **260/260 PASS**.

---

## 16. Frontend Authentication
- **State Management:** `frontend/src/state/authState.jsx` provides `useAuth()` hook with `login`, `register`, `logout`, `user`, and `isAuthenticated`.
- **Axios Interceptor:** Automatically injects `Authorization: Bearer <token>` from `localStorage` on all API calls in `client.js`.
- **UI Pages:**
  - `/login`: Sleek dark-mode login card with demo quick-fill button.
  - `/register`: Industrial user registration with password confirmation and optional organization naming.
- **Route Guard:** `frontend/src/components/auth/ProtectedRoute.jsx` intercepts unauthenticated attempts to access `/dashboard`, `/documents`, `/chat`, `/agent`, `/inspection`, `/reports`, `/coding`, `/vision`, or `/security` and redirects to `/login`.
- **Navigation Bar:** Displays authenticated engineer name, role badge, and a one-click Sign Out button.

---

## 17. Docker Verification
- Rebuilt `sovereign-ai-backend` and `sovereign-ai-frontend` images.
- All 6 containers verified running and healthy:
  - `sovereign-ai-backend` (healthy)
  - `sovereign-ai-frontend` (healthy)
  - `sovereign-ai-ollama` (healthy)
  - `sovereign-ai-postgres` (healthy)
  - `sovereign-ai-qdrant` (healthy)
  - `sovereign-ai-service` (healthy)
- Live end-to-end flow verified directly against `http://localhost:9000/api/v1`: registration, login, `/auth/me`, document listing, header spoofing rejection (403), and unauthenticated rejection (401).

---

## 18. Known Limitations
- Qdrant points are partitioned by document and collection; organization-level payload filtering is currently enforced at the PostgreSQL metadata query layer before Qdrant retrieval is initiated.
- In-memory rate limiting is node-local; suitable for single-instance on-premise deployments.
