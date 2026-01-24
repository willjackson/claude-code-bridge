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
│    Claude Code       │           │    Bridge Client     │
│         +            │ WebSocket │   --with-handlers    │
│    Bridge Host  ────────────────────►                   │
│    (port 8766)       │           │  Executes commands   │
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

# Utilities
claude-bridge status    # Check if bridge is running
claude-bridge stop      # Stop the bridge daemon
claude-bridge info      # Show system info
```

## Configuration

Create `~/.claude-bridge/config.yml` for persistent settings:

```yaml
instanceName: my-bridge
listen:
  port: 8765
  host: 0.0.0.0
interaction:
  taskTimeout: 300000
```

## Troubleshooting

**Can't connect?**
- Verify the host is running: `claude-bridge status`
- Check firewall allows port 8765
- Confirm IP is reachable: `ping HOST_IP`

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
