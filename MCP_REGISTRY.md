# Publishing to MCP Registry

Steps to publish this server to the official MCP Registry (feeds GitHub marketplace, Smithery, PulseMCP, etc.).

## Prerequisites

- Package published to npm first (`npm publish`)
- GitHub account (for `io.github.ashev87/*` namespace)

## Step 1: Install mcp-publisher (Windows)

```powershell
# From project root
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "mcp-publisher.tar.gz" -UseBasicParsing
tar xf mcp-publisher.tar.gz mcp-publisher.exe
Remove-Item mcp-publisher.tar.gz
```

Or with curl (Git Bash):

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -o mcp-publisher.tar.gz
tar xf mcp-publisher.tar.gz
del mcp-publisher.tar.gz
```

## Step 2: Update server.json

Before each publish, ensure `server.json` version matches `package.json`. Edit if needed:

- `version` — must match published npm version
- `packages[0].version` — same
- `description` — max 100 chars (registry validation)

## Step 3: Login (once per machine, or when token expires)

```bash
./mcp-publisher.exe login github
```

Opens browser → enter device code → authorize.

## Step 4: Publish

```bash
./mcp-publisher.exe publish
```

## Step 5: Verify

```bash
curl "https://registry.modelcontextprotocol.io/v0/servers?search=propstack"
```

## Typical Release Flow

1. `git add . && git commit -m "..."` (clean working tree)
2. `npm version patch && npm publish`
3. Update `server.json` version to match
4. `./mcp-publisher.exe publish`

## Automation

Can be automated via [GitHub Actions](https://modelcontextprotocol.io/registry/github-actions.mdx).
