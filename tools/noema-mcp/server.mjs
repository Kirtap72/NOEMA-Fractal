#!/usr/bin/env node
// NOEMA Fractal MCP server (stdio). Started by an MCP host (Claude Desktop, ...). It advertises the operations of
// src/capabilities/manifest.json that are marked "implemented" and forwards each call to the running NOEMA app over its
// local, token-protected pipe. All decisions, validation and limits are in the app; this process has no business logic.
// Safety: nothing is written to stdout except MCP messages.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { callApp, implementedTools, loadManifest, toToolResult } from './lib.mjs';

const manifest = loadManifest();

function buildServer() {
  const server = new McpServer({ name: 'noema-fractal', version: '0.1.0' }, { instructions: 'NOEMA Fractal. Start with noema_get_capabilities. You edit separate drafts, never the live scene; the artist decides what is applied.' });
  for (const op of implementedTools(manifest)) {
    server.registerTool(
      op.mcpTool,
      { title: op.name.en, description: op.purpose, inputSchema: z.fromJSONSchema(op.params), annotations: { title: op.name.en, ...op.annotations } },
      async (args, ctx) => toToolResult(await callApp(op.id, args, { signal: ctx?.mcpReq?.signal })),
    );
  }
  return server;
}

serveStdio(buildServer, { onerror: (e) => console.error('[noema-mcp]', e?.message ?? e) });
console.error('[noema-mcp] ready: ' + implementedTools(manifest).map((o) => o.mcpTool).join(', '));
