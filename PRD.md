# Product Requirements Document (PRD)
## Project Name: Device-Bound Passwordless Voting System (DBPVS)
**Document Version:** 2.0 (Pro Enterprise Architecture)
**Target Environment:** Local testing (Node/MySQL) scaling to Cloud Hosting.

---

### 1. Project Overview
The Device-Bound Passwordless Voting System is a high-security, multi-election management platform. It solves standard digital voting vulnerabilities by replacing passwords with **WebAuthn Cryptographic Hardware Binding** and implementing **End-to-End Encryption (E2EE)**. This "Pro" version introduces a strict Supervised Kiosk registration model to prevent Sybil attacks and a decoupled database architecture to support concurrent, rule-based elections.

### 2. Core Objectives
* **Sybil Attack Prevention:** Enforce a strict "Supervised Kiosk" registration flow to guarantee the physical identity of the voter before cryptographic binding occurs.
* **Multi-Election Lifecycle:** Support the simultaneous running of multiple elections, dynamically serving ballots based on voter metadata (Course, Year, Section).
* **Ballot Anonymity & E2EE:** Ensure a voter's identity cannot be relationally linked to their cast ballot, encrypting the payload client-side before transmission.
* **Resilience & Recovery:** Provide a secure Admin protocol for device revocation in the event of lost or damaged voter hardware.

---

### 3. Technology Stack
* **Backend Runtime:** Node.js (v22.20.0) / Express.js
* **Database:** MySQL (Relational, ACID Compliant)
* **Database Driver:** `mysql2` (Connection Pooling & Async/Await)
* **Biometric API:** WebAuthn (`@simplewebauthn/server` & `@simplewebauthn/browser`)
* **Cryptography:** Web Crypto API (Frontend) / Node native `crypto`
* **Frontend:** HTML5, Vanilla JavaScript, Tailwind CSS

---

### 4. Core Features & System Workflows

#### A. The "Supervised Kiosk" Registration Flow
To prevent identity hijacking, voters cannot self-register from home.
1. **Pre-population:** Admin adds students via manual entry or CSV upload (Roll Number, Name, Course, Year, Section).
2. **Physical Verification:** The student presents their physical College ID to the Admin at a designated kiosk.
3. **Admin Unlock:** The Admin searches the Roll Number in the dashboard and clicks "Unlock Registration."
4. **Hardware Binding:** The student scans their device's native biometric sensor at the kiosk to generate and store the WebAuthn Public Key. `is_registered` becomes `TRUE`.

#### B. Election Management & Eligibility (Pro Architecture)
* Admins can create isolated elections with eligibility rules (Course, Year, Section).
* A `NULL` value in a rule field means "open to all."
* The backend verifies the user's metadata against the election rules *before* serving the ballot.

#### C. Device Dead / Account Recovery
* If a voter's device is destroyed, their Private Key is permanently lost.
* The voter undergoes physical verification again at the Admin kiosk.
* The Admin uses the "Revoke Device" tool to wipe the old `public_key` and reset `is_registered` to `FALSE`, allowing re-registration on a new device.

#### D. The E2EE Voting Process
* The voter selects a candidate. The frontend encrypts the choice using a Public Election Key.
* The backend verifies the WebAuthn signature and Eligibility Rules.
* The backend records the participation in a `voter_participation` table to prevent double voting.
* The backend deposits the encrypted payload into the disconnected `votes` table — **which has no roll_number column**.

---

### 5. Advanced Database Schema (Multi-Election)

**Table 1: `users` (The Voter Roll)**
* `roll_number` (VARCHAR, Primary Key)
* `name` (VARCHAR)
* `course` (VARCHAR)
* `year` (INT)
* `section` (VARCHAR)
* `public_key` (TEXT, Nullable until registered)
* `credential_id` (TEXT, Nullable)
* `is_registered` (BOOLEAN, Default: FALSE)
* `registration_unlocked` (BOOLEAN, Default: FALSE)

**Table 2: `elections` (The Rule Engine)**
* `id` (INT, Primary Key)
* `title` (VARCHAR)
* `allowed_course` (VARCHAR, NULL = open to all)
* `allowed_year` (INT, NULL = open to all)
* `allowed_section` (VARCHAR, NULL = open to all)
* `status` (ENUM: 'Upcoming', 'Active', 'Closed')

**Table 3: `candidates`**
* `id` (INT, Primary Key)
* `election_id` (INT, Foreign Key → elections.id)
* `name` (VARCHAR)
* `party_logo_url` (VARCHAR)

**Table 4: `voter_participation` (The Double-Vote Preventer)**
* `roll_number` (VARCHAR, FK → users.roll_number)
* `election_id` (INT, FK → elections.id)
* `voted_at` (TIMESTAMP)
* *(Composite Primary Key of roll_number + election_id)*

**Table 5: `votes` (The Anonymous Ballot Box)**
* `id` (INT, Primary Key)
* `election_id` (INT, FK → elections.id)
* `encrypted_ballot` (TEXT)
* `cast_at` (TIMESTAMP)
* **No roll_number exists in this table.**

---

### 6. Implementation Milestones

* **Phase 1 ✅ Pro-Schema Integration:** Rebuild database to support multi-elections and voter metadata.
* **Phase 2: Admin Kiosk Console:** UI & backend routes for student roll management, unlock, revoke, election creation.
* **Phase 3: Hardware Binding:** WebAuthn tied to Roll Number flow with Admin-unlock gate.
* **Phase 4: Eligibility & Voting:** Backend eligibility checking + E2EE vote submission with `election_id`.
* **Phase 5: Decryption & Tally:** Per-election admin decryption, results chart and ballot log.
