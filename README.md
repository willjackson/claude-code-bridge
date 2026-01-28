# Claude Code Bridge

**Extend Claude Code's reach to remote machines, containers, and servers.**

Control files and execute tasks on any connected environment—all from your local Claude Code session.

## The Problem

You're running Claude Code locally, but your project lives on:
- A remote development server
- A Docker container
- A cloud VM or EC2 instance
- A different machine on your network

Without Bridge, you'd need separate Claude Code sessions, copy files back and forth, or SSH in manually.

## The Solution

Claude Code Bridge connects your local Claude Code to remote environments via WebSocket. Your local Claude gains the ability to **read, write, list, and delete files** on any connected machine—as if they were local.

```
LOCAL MACHINE                      REMOTE MACHINE
┌──────────────────────┐           ┌──────────────────────┐
│                      │           │                      │
│    Claude Code       │  ws:// or │    Bridge Client     │
│         +            │  wss://   │   --with-handlers    │
│    Bridge Host  ────────────────────►                   │
│    (port 8766)       │  (TLS)    │  Executes commands   │
│                      │           │  on your files       │
└──────────────────────┘           └──────────────────────┘
```

## Use Cases

- **Remote Development** — Edit files on a dev server without leaving your local Claude Code
- **Container Workflows** — Modify code inside Docker containers from outside
- **Multi-Machine Projects** — Manage microservices across different hosts
- **Cloud Development** — Work on EC2/cloud VMs from your laptop
- **CI/CD Debugging** — Inspect and fix files on build servers

## Quick Start

### 1. Install

```bash
npm install -g @willjackson/claude-code-bridge
```

### 2. Setup MCP (one-time)

```bash
claude mcp add bridge -- npx @willjackson/claude-code-bridge mcp-server
```

### 3. Start Host + Claude Code

On your **local machine**:

```bash
claude-bridge start --launch-claude
```

Need to skip permissions? Add flags after `--`:

```bash
claude-bridge start --launch-claude -- --dangerously-skip-permissions
```

### 4. Connect Remote Machine

On the **remote machine** (server, container, VM):

```bash
claude-bridge start --with-handlers --connect ws://HOST_IP:8765
```

Replace `HOST_IP` with your local machine's IP address.

That's it! Claude Code now has access to files on the remote machine.

## Secure Connections (TLS + Auth)

For production or untrusted networks, enable TLS encryption and authentication.

### Generate Certificates

```bash
# Self-signed certificate (for testing)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```

### Start with TLS + Token Auth

**Local machine (host):**

```bash
claude-bridge start --cert cert.pem --key key.pem --auth-token mysecret123
```

**Remote machine (client):**

```bash
claude-bridge start --with-handlers --connect wss://HOST_IP:8765 --ca cert.pem --auth-token mysecret123
```

### Authentication Options

| Option | Description |
|--------|-------------|
| `--auth-token <token>` | Require a shared secret token |
| `--auth-password <pw>` | Require password authentication |
| `--auth-ip <cidr>` | Allow only specific IPs (e.g., `192.168.0.0/16`) |
| `--auth-require-all` | Require ALL auth methods to pass (default: any) |

Combine methods for defense in depth:

```bash
claude-bridge start --auth-token secret --auth-ip 10.0.0.0/8 --auth-require-all
```

## What You Can Do

Once connected, Claude Code gains these MCP tools:

| Tool | Description |
|------|-------------|
| `bridge_read_file` | Read any file on the remote |
| `bridge_write_file` | Create or modify files |
| `bridge_delete_file` | Remove files |
| `bridge_list_directory` | Browse directories |
| `bridge_status` | Check connection status |

## Client Console

The remote client shows all incoming commands in real-time:

```
┌─────────────────────────────────────────────────────
│ 📥 INCOMING TASK: Read config file
│ Action: read_file
│ Path: src/config.json
└─────────────────────────────────────────────────────
  ✅ RESULT: Read 2048 chars from src/config.json
```

## CLI Reference

```bash
# Host mode (local machine)
claude-bridge start [--port 8765] [--launch-claude] [-- claude-args]

# Client mode (remote machine)
claude-bridge start --with-handlers --connect ws://HOST:PORT

# Secure connections
claude-bridge start --cert cert.pem --key key.pem --auth-token secret
claude-bridge start --with-handlers --connect wss://HOST:PORT --ca cert.pem --auth-token secret

# Utilities
claude-bridge status    # Check if bridge is running
claude-bridge stop      # Stop the bridge daemon
claude-bridge info      # Show system info
```

### TLS Options

| Option | Description |
|--------|-------------|
| `--cert <path>` | TLS certificate file |
| `--key <path>` | TLS private key file |
| `--ca <path>` | CA certificate (for verifying self-signed certs) |

## Configuration

Create `~/.claude-bridge/config.yml` for persistent settings:

```yaml
instanceName: my-bridge
listen:
  port: 8765
  host: 0.0.0.0
  tls:
    cert: /path/to/cert.pem
    key: /path/to/key.pem
  auth:
    type: token  # none, token, password, ip, or combined
    token: ${BRIDGE_AUTH_TOKEN}  # use environment variable
interaction:
  taskTimeout: 300000
```

For client connections:

```yaml
connect:
  url: wss://remote-host:8765
  tls:
    ca: /path/to/ca.pem
  auth:
    type: token
    token: ${BRIDGE_AUTH_TOKEN}
```

## Troubleshooting

**Can't connect?**
- Verify the host is running: `claude-bridge status`
- Check firewall allows port 8765
- Confirm IP is reachable: `ping HOST_IP`

**TLS connection failing?**
- Ensure client uses `wss://` (not `ws://`) when connecting to TLS host
- For self-signed certs, client must use `--ca cert.pem`
- Check certificate hasn't expired

**Authentication failing?**
- Verify tokens match exactly on both sides
- For IP auth, ensure client IP is in allowed CIDR range
- Check with `-v` flag for detailed auth error messages

**Commands not executing?**
- Ensure client uses `--with-handlers`
- Check client console for errors

**Need more detail?**
- Run with verbose logging: `claude-bridge start -v`

## Requirements

- Node.js 20+
- Claude Code with MCP support

## License

MIT

## Links

- [npm package](https://www.npmjs.com/package/@willjackson/claude-code-bridge)
- [Report issues](https://github.com/willjackson/claude-code-bridge/issues)
