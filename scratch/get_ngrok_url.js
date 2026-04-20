const http = require('http');

http.get('http://localhost:4040/api/tunnels', (resp) => {
    let data = '';
    resp.on('data', (chunk) => { data += chunk; });
    resp.on('end', () => {
        try {
            const tunnels = JSON.parse(data).tunnels;
            const httpsTunnel = tunnels.find(t => t.proto === 'https');
            if (httpsTunnel) {
                console.log('PUBLIC_URL:' + httpsTunnel.public_url);
            } else {
                console.log('No HTTPS tunnel found.');
            }
        } catch (e) {
            console.log('Error parsing ngrok API response');
        }
    });
}).on("error", (err) => {
    console.log("Error contacting ngrok API: " + err.message);
});
