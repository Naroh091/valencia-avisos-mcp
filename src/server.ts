#!/usr/bin/env node
/**
 * Entrada STDIO del servidor MCP (para Claude Desktop / Claude Code en local).
 * Para exponerlo por red (Tailscale), usa http.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ValenciaClient } from "./client.js";
import { buildServer } from "./mcp.js";

async function main() {
  const client = new ValenciaClient();
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[valencia-avisos] MCP servidor listo (stdio).");
}

main().catch((e) => {
  console.error("[valencia-avisos] Error fatal:", e);
  process.exit(1);
});
