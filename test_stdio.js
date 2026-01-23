const { spawn } = require('child_process');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['open-websearch@latest'];

console.log('Spawning...');
const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32' // Important for npx on windows
});

proc.stderr.on('data', d => console.error('ERR:', d.toString()));
proc.stdout.on('data', d => {
    console.log('OUT:', d.toString());
    // If we get a response, exit success
    if (d.toString().includes('jsonrpc')) {
        console.log('SUCCESS: JSON-RPC detected');
        process.exit(0);
    }
});

// Give it a moment to start
setTimeout(() => {
    const listTools = {
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1
    };
    console.log('Sending:', JSON.stringify(listTools));
    proc.stdin.write(JSON.stringify(listTools) + '\n');
}, 3000);

setTimeout(() => {
    console.log('Timeout');
    process.exit(1);
}, 10000);
