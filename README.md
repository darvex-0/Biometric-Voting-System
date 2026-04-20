<div align="center">
  <img src="https://img.icons8.com/fluency/96/fingerprint.png" alt="SBVS Logo" width="80" />
  <h1 align="center">SBVS | Secure Biometric Voting System</h1>
  <p align="center">
    <strong>An End-to-End Encrypted (E2EE) voting platform secured by WebAuthn Biometrics.</strong>
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

The **Secure Biometric Voting System (SBVS)** is a next-generation voting panel designed to eliminate electoral fraud through hardware-backed biometric verification. By leveraging the **WebAuthn API**, SBVS ensures that only real, authenticated users can cast a ballot, while **End-to-End Encryption (E2EE)** protects the integrity and privacy of every single vote.

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
    Create a `.env` file in the root directory:
    ```env
    DB_HOST=localhost
    DB_USER=root
    DB_PASSWORD=your_password
    DB_NAME=voting_system
    PORT=3000
    ```

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

## 🖥️ Usage

### For Voters
1.  Navigate to `http://localhost:3000/`.
2.  Register with a unique username and your device's biometric sensor.
3.  Login and select your preferred candidate.
4.  Confirm the vote using your biometric signature.

### For Admins
1.  Navigate to `http://localhost:3000/admin.html`.
2.  Monitor **Total Registered vs. Ballots Cast**.
3.  View the **Live Results** chart.
4.  Use the **Add New Candidate** form to expand the election participants list.

<hr />

<div align="center">
  <p>Built with ❤️ by the SBVS Development Team</p>
</div>
