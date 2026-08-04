# mcp-warframe

Warframe MCP (WarframeStat API).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `world_state` | One-call summary of Warframe's live worldstate: the Plains of Eidolon (Cetus) day/night cycle, Cambion Drift (fass/vome), Orb Vallis (warm/cold), the current daily Sortie, Baro Ki'Teer's void-trader status, and the active Void Fissure count. Keyless, live. |
| `get_fissures` | List the active Void Fissures (Lith / Meso / Neo / Axi relic missions, including Steel Path and Void Storm variants) with node, mission type, enemy and time remaining. Keyless, live. |
| `get_invasions` | List the active (non-completed) faction Invasions — node, description, attacking/defending factions and completion percentage. Keyless, live. |
| `search_items` | Fuzzy-search Warframe item data — warframes, weapons, mods, and more — by name. Returns name, type, category and description. Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "warframe": {
      "url": "https://gateway.pipeworx.io/warframe/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Warframe data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
