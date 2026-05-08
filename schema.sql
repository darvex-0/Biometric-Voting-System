-- ============================================================
-- DBPVS V2.0 Pro Schema
-- Device-Bound Passwordless Voting System
-- ============================================================

CREATE DATABASE IF NOT EXISTS voting_system;
USE voting_system;

-- Drop all tables in reverse FK dependency order
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS voter_participation;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS elections;
DROP TABLE IF EXISTS users;

-- ============================================================
-- Table 1: users (The Voter Roll)
-- Pre-populated by Admin via CSV or manual entry.
-- public_key is NULL until the student completes kiosk binding.
-- ============================================================
CREATE TABLE users (
    roll_number     VARCHAR(50)  PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    course          VARCHAR(100) NOT NULL,
    year            INT          NOT NULL,
    section         VARCHAR(10)  NOT NULL,
    public_key      TEXT         NULL,
    credential_id   TEXT         NULL,
    is_registered   BOOLEAN      DEFAULT FALSE,
    registration_unlocked BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- Table 2: elections (The Rule Engine)
-- NULL in allowed_* fields means "open to all".
-- ============================================================
CREATE TABLE elections (
    id              INT          AUTO_INCREMENT PRIMARY KEY,
    title           VARCHAR(200) NOT NULL,
    allowed_course  VARCHAR(100) NULL,
    allowed_year    INT          NULL,
    allowed_section VARCHAR(10)  NULL,
    start_at        DATETIME     NOT NULL,
    end_at          DATETIME     NOT NULL,
    result_at       DATETIME     NOT NULL,
    status          ENUM('Upcoming', 'Active', 'Closed') DEFAULT 'Upcoming',
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Table 3: candidates
-- Each candidate belongs to a specific election.
-- ============================================================
CREATE TABLE candidates (
    id              INT          AUTO_INCREMENT PRIMARY KEY,
    election_id     INT          NOT NULL,
    name            VARCHAR(150) NOT NULL,
    party_logo_url  VARCHAR(500) NULL,
    FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
);

-- ============================================================
-- Table 4: voter_participation (The Double-Vote Preventer)
-- Composite PK ensures one row per (voter, election) pair.
-- This table IS linked to identity — by design.
-- ============================================================
CREATE TABLE voter_participation (
    roll_number     VARCHAR(50)  NOT NULL,
    election_id     INT          NOT NULL,
    voted_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (roll_number, election_id),
    FOREIGN KEY (roll_number) REFERENCES users(roll_number) ON DELETE CASCADE,
    FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
);

-- ============================================================
-- Table 5: votes (The Anonymous Ballot Box)
-- CRITICAL: No roll_number column exists here.
-- A ballot cannot be linked back to any voter.
-- ============================================================
CREATE TABLE votes (
    id              INT          AUTO_INCREMENT PRIMARY KEY,
    election_id     INT          NOT NULL,
    encrypted_ballot TEXT        NOT NULL,
    cast_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
);
