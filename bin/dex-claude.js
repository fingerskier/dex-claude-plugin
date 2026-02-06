#!/usr/bin/env node

// Entry point for dex-claude-plugin MCP server
const { startServer } = await import('../dist/index.js');
await startServer();
