<div align="center">
  <img src="https://img.icons8.com/fluency/96/fingerprint.png" alt="SBVS Logo" width="80" />
  <h1 align="center">SBVS | Secure Biometric Voting System</h1>
  <p align="center">
    <strong>A biometric voting platform with application-layer ballot encryption and WebAuthn authentication.</strong>
  </p>
  
  <p align="center">
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
    <img src="https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white" />
    <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" />
  </p>
</div>

<hr />

## 🛡️ Overview

The **Secure Biometric Voting System (SBVS)** is a next-generation voting panel designed to eliminate electoral fraud through hardware-backed biometric verification. By leveraging the **WebAuthn API**, SBVS ensures that only real, authenticated users can cast a ballot, while **public-key ballot encryption** protects vote payloads in transit and at rest.

## ✨ Key Features

-   👤 **Biometric Authentication**: Passwordless registration and login using device-native hardware (Fingerprint, FaceID, TouchID).
-   🔐 **End-to-End Encryption**: Ballots are encrypted on the client side before submission and decrypted only on the Admin Dashboard.
-   📊 **Real-time Admin Vault**: Live election results visualized with Chart.js, featuring a blockchain-style raw data log.
-   ➕ **Dynamic Candidate Management**: Admins can add new election participants on-the-fly directly from the dashboard.
-   🛡️ **Fraud Prevention**: Strict "one-user-one-vote" enforcement backed by cryptographic signatures.

## 🚀 Tech Stack

<table align="center">
  <tr>
    <td align="center" width="150">
      <img src="https://img.icons8.com/color/48/000000/nodejs.png" /><br />
      <b>Node.js</b><br />Backend Runtime
    </td>
    <td align="center" width="150">
      <img src="https://img.icons8.com/color/48/000000/mysql-logo.png" /><br />
      <b>MySQL</b><br />Database
    </td>
    <td align="center" width="150">
      <img src="https://img.icons8.com/color/48/000000/javascript--v1.png" /><br />
      <b>WebAuthn</b><br />Biometrics
    </td>
    <td align="center" width="150">
      <img src="https://img.icons8.com/color/48/000000/css3.png" /><br />
      <b>Tailwind</b><br />UI Styling
    </td>
  </tr>
</table>

## 🛠️ Installation & Setup

1.  **Clone the Repository**
    ```bash
    git clone <repository-url>
    cd VotingPanel
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Copy `.env.example` to `.env` and update the values for your machine:
    ```env
    DB_HOST=127.0.0.1
    DB_USER=root
    DB_PASSWORD=your_password
    DB_NAME=voting_system
    PORT=3000
    SESSION_SECRET=replace-with-a-long-random-secret
    ADMIN_USERNAME=admin
    ADMIN_PASSWORD=change-me
    NODE_ENV=development
    SESSION_COOKIE_SECURE=false
    SESSION_COOKIE_SAME_SITE=lax
    TRUST_PROXY=false
    BALLOT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    BALLOT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
    ```

    Notes:
    - `SESSION_SECRET` is required for production and should be long and random.
    - Set `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAME_SITE=none`, and `TRUST_PROXY=true` when deploying behind HTTPS/reverse proxies.
    - The admin dashboard now requires `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
    - Generate ballot encryption keys with `node scratch/generate_ballot_keys.js`.

4.  **Initialize Database**
    > [!IMPORTANT]
    > **Make sure XAMPP/MySQL is running first!**

    You can initialize the database and all required tables with a single command:
    ```bash
    node scratch/setup_db.js
    ```

5.  **Run Locally**
    ```bash
    node server.js
    ```

## 🌐 Mobile & External Testing (ngrok)

Since Biometric Authentication (WebAuthn) requires **HTTPS**, testing on a real mobile device or outside your local network requires a secure tunnel.

### First-Time ngrok Setup 
If you have never used ngrok before:
1.  **Sign up** for a free account at [ngrok.com](https://ngrok.com/).
2.  Copy your **Authtoken** from the ngrok dashboard.
3.  Run the following command once:
    ```bash
    npx ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
    ```

### Starting the Tunnel
1.  **Start ngrok** (in a separate terminal):
    ```bash
    npx ngrok http 3000
    ```

2.  **Get Public URL**:
    You can check the ngrok dashboard or run our helper script:
    ```bash
    node scratch/get_ngrok_url.js
    ```

3.  **Access on Phone**:
    Open the `https://...` URL provided by ngrok on your mobile browser to test Fingerprint/FaceID voting!

## 🖥️ Usage

### For Voters
1.  Navigate to `http://localhost:3000/`.
2.  Register with a unique username and your device's biometric sensor.
3.  Login and select your preferred candidate.
4.  Confirm the vote using your biometric signature.

### For Admins
1.  Navigate to `http://localhost:3000/admin.html`.
2.  Sign in with the admin credentials from `.env`.
3.  Monitor **Total Registered vs. Ballots Cast**.
4.  View the **Live Results** chart.
5.  Use the **Add New Candidate** form to expand the election participants list.

<hr />

<div align="center">
  <p>Built with ❤️ by the SBVS Development Team</p>
</div>
