# Product Requirements Document (PRD)
## Project Name: Secure Biometric Voting System (SBVS)
**Document Version:** 1.0
**Target Environment:** Local testing (XAMPP/Node) scaling to Zero-Cost Cloud Hosting.

---

### 1. Project Overview
The Secure Biometric Voting System is a modern, web-based polling application designed to guarantee voter authenticity and ballot anonymity. It leverages device-native biometric sensors (fingerprint/FaceID) for login and End-to-End Encryption (E2EE) for ballot casting, ensuring a high-security standard without requiring proprietary hardware.

### 2. Objectives
* **High-Assurance Authentication:** Eliminate password-based vulnerabilities using passwordless WebAuthn.
* **Absolute Anonymity:** Ensure a voter's identity cannot be cryptographically or relationally linked to their cast ballot.
* **High Efficiency:** Handle concurrent voting connections reliably.
* **Cost Efficiency:** Utilize 100% free, open-source tools and generous free-tier hosting.

---

### 3. Technology Stack ("The Efficiency Stack")
* **Backend Runtime:** Node.js (v22.20.0)
* **Web Framework:** Express.js
* **Database:** MySQL (via XAMPP for local development)
* **Database Driver:** `mysql2` (utilized with Connection Pooling and async/await)
* **Biometric API:** WebAuthn (`@simplewebauthn/server` & `@simplewebauthn/browser`)
* **Cryptography (E2EE):** Web Crypto API (Frontend) / Node native `crypto` (Backend)
* **Frontend UI:** HTML5, Vanilla JavaScript, and Tailwind CSS (via CDN)

---

### 4. Core Features & Requirements

#### A. Voter Registration & Authentication
* The system must prompt users to register their device's native fingerprint/biometric sensor.
* Passwords will not be stored; the database will only store the WebAuthn Public Key.
* The system must prevent duplicate voting (one vote per registered biometric key).

#### B. The Voting Process (Anonymity & E2EE)
* The user selects a candidate on the frontend.
* The frontend uses a public election key to encrypt the vote *before* it leaves the browser (E2EE).
* The backend verifies the user's biometric signature, marks them as `has_voted = TRUE`, and deposits the encrypted vote payload into a disconnected database table.

#### C. Real-Time Security
* Prepared SQL statements must be used exclusively to prevent SQL Injection.
* The system must mandate HTTPS/SSL for the WebAuthn API to function.

---

### 5. System Architecture & Database Schema
The database architecture is intentionally decoupled to prevent mapping a user to a specific ballot.

**Table 1: `users` (Identity Provider)**
Handles authentication and prevents double-voting.
* `id` (INT, Primary Key)
* `username` (VARCHAR, Unique identifier/Roll Number)
* `public_key` (TEXT, WebAuthn biometric key)
* `has_voted` (BOOLEAN, Default: FALSE)

**Table 2: `candidates` (Election Data)**
* `id` (INT, Primary Key)
* `name` (VARCHAR)
* `party_logo_url` (VARCHAR)

**Table 3: `votes` (The Ballot Box)**
Stores the encrypted payload. No foreign keys to the `users` table exist here.
* `id` (INT, Primary Key)
* `encrypted_ballot` (TEXT, The E2EE payload)
* `created_at` (TIMESTAMP)

---

### 6. Implementation Plan (Milestones)

#### Phase 1: Local Environment Setup (Days 1-2)
1. Initialize Node.js project (`npm init -y`).
2. Install dependencies: `express`, `mysql2`, `dotenv`, `@simplewebauthn/server`.
3. Set up XAMPP, start Apache/MySQL, and create the `voting_system` database using the schema above.
4. Create `db.js` to establish the `mysql2` connection pool.

#### Phase 2: Biometric Authentication Flow (Days 3-7)
1. Build frontend UI with Tailwind for login/registration.
2. Create API endpoint `/generate-registration-options` to send a WebAuthn challenge to the browser.
3. Create API endpoint `/verify-registration` to validate the fingerprint and store the `public_key` in MySQL.
4. Repeat the process for the login flow (Authentication challenge).

#### Phase 3: The Voting Logic & E2EE (Days 8-12)
1. Create the Candidate Selection UI.
2. Implement `window.crypto` on the frontend to encrypt the selected candidate ID.
3. Create API endpoint `/cast-vote`.
4. Logic check in `/cast-vote`:
    * Is user authenticated? (Check session/token).
    * Is `has_voted == FALSE`?
    * If yes: Update `users` table to `has_voted = TRUE`.
    * Insert `encrypted_ballot` into `votes` table.

#### Phase 4: Finalization & Deployment (Days 13-15)
1. Build a simple admin dashboard (protected route) to count decrypted votes.
2. Test concurrency by simulating multiple local votes.
3. Migrate the XAMPP database to a free cloud MySQL provider (e.g., Aiven or Railway).
4. Deploy the Node.js backend to a free tier host (e.g., Render) ensuring HTTPS is active for WebAuthn.

---

### 7. Future Enhancements (Post-Submission)
* **Live Results Dashboard:** Implement Server-Sent Events (SSE) to show vote counts updating in real-time.
* **Audit Trail:** Generate a unique receipt hash for users to verify their vote was counted without revealing who they voted for.

---
