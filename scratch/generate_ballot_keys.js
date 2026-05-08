const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
    },
});

console.log(`BALLOT_PUBLIC_KEY="${publicKey.trim().replace(/\n/g, '\\n')}"`);
console.log(`BALLOT_PRIVATE_KEY="${privateKey.trim().replace(/\n/g, '\\n')}"`);
