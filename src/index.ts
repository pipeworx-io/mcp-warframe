interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Warframe MCP (WarframeStat API).
 *
 * Live worldstate + item data for Digital Extremes' game Warframe, via the
 * community-run WarframeStat API (warframestat.us). Keyless. Exposes the live
 * open-world day/night cycles (Cetus / Cambion Drift / Orb Vallis), the daily
 * Sortie, Baro Ki'Teer's void-trader rotation, active Void Fissures and
 * Invasions, plus a fuzzy item search over warframes, weapons and mods.
 */


const BASE = 'https://api.warframestat.us';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const PLATFORMS = ['pc', 'ps4', 'xb1', 'swi'] as const;
const TIER_ORDER: Record<string, number> = { Lith: 0, Meso: 1, Neo: 2, Axi: 3 };

const tools: McpToolExport['tools'] = [
  {
    name: 'world_state',
    description:
      "One-call summary of Warframe's live worldstate: the Plains of Eidolon (Cetus) day/night cycle, Cambion Drift (fass/vome), Orb Vallis (warm/cold), the current daily Sortie, Baro Ki'Teer's void-trader status, and the active Void Fissure count. Keyless, live.",
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: one of pc, ps4, xb1, swi. Default "pc".',
        },
      },
    },
  },
  {
    name: 'get_fissures',
    description:
      'List the active Void Fissures (Lith / Meso / Neo / Axi relic missions, including Steel Path and Void Storm variants) with node, mission type, enemy and time remaining. Keyless, live.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: one of pc, ps4, xb1, swi. Default "pc".',
        },
      },
    },
  },
  {
    name: 'get_invasions',
    description:
      'List the active (non-completed) faction Invasions — node, description, attacking/defending factions and completion percentage. Keyless, live.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: 'Platform: one of pc, ps4, xb1, swi. Default "pc".',
        },
      },
    },
  },
  {
    name: 'search_items',
    description:
      'Fuzzy-search Warframe item data — warframes, weapons, mods, and more — by name. Returns name, type, category and description. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Item name to search for, e.g. "Excalibur", "Soma Prime", "Serration".',
        },
      },
      required: ['query'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'world_state':
        return worldState(args);
      case 'get_fissures':
        return getFissures(args);
      case 'get_invasions':
        return getInvasions(args);
      case 'search_items':
        return searchItems(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function resolvePlatform(args: Record<string, unknown>): (typeof PLATFORMS)[number] {
  const raw = typeof args.platform === 'string' ? args.platform.trim().toLowerCase() : '';
  return (PLATFORMS as readonly string[]).includes(raw)
    ? (raw as (typeof PLATFORMS)[number])
    : 'pc';
}

async function wfFetch(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) {
    throw new Error(`warframestat: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Compact summary of a day/night-style cycle ({ state, timeLeft }). */
function cycleSummary(raw: unknown): { state: unknown; time_left: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // cetus/vallis use `state`; cambion uses `active` (fass/vome) but also exposes `state`.
  return { state: r.state ?? r.active ?? null, time_left: r.timeLeft ?? null };
}

/** Human-ish ETA from an ISO expiry string. */
function etaFrom(expiry: unknown): string | null {
  if (typeof expiry !== 'string') return null;
  const ms = new Date(expiry).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'expired';
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h) parts.push(`${s}s`);
  return parts.join(' ');
}

async function worldState(args: Record<string, unknown>): Promise<unknown> {
  const platform = resolvePlatform(args);

  // Wrap each sub-fetch so one failure → null field rather than failing the tool.
  const safe = async (path: string): Promise<unknown> => {
    try {
      return await wfFetch(`/${platform}${path}`);
    } catch {
      return null;
    }
  };

  const [cetus, cambion, vallis, sortie, voidTrader, fissures] = await Promise.all([
    safe('/cetusCycle'),
    safe('/cambionCycle'),
    safe('/vallisCycle'),
    safe('/sortie'),
    safe('/voidTrader'),
    safe('/fissures'),
  ]);

  const s = sortie && typeof sortie === 'object' ? (sortie as Record<string, unknown>) : null;
  const variants = s && Array.isArray(s.variants) ? (s.variants as Array<Record<string, unknown>>) : [];

  const vt =
    voidTrader && typeof voidTrader === 'object' ? (voidTrader as Record<string, unknown>) : null;
  let vtActive: boolean | null = null;
  if (vt) {
    if (typeof vt.active === 'boolean') {
      vtActive = vt.active;
    } else {
      const now = Date.now();
      const start = typeof vt.activation === 'string' ? new Date(vt.activation).getTime() : NaN;
      const end = typeof vt.expiry === 'string' ? new Date(vt.expiry).getTime() : NaN;
      vtActive = Number.isFinite(start) && Number.isFinite(end) ? now >= start && now < end : null;
    }
  }

  return {
    platform,
    cetus_cycle: cycleSummary(cetus),
    cambion_cycle: cambion && typeof cambion === 'object'
      ? {
          active: (cambion as Record<string, unknown>).active ?? null,
          time_left: (cambion as Record<string, unknown>).timeLeft ?? null,
        }
      : null,
    vallis_cycle: cycleSummary(vallis),
    sortie: s
      ? {
          boss: s.boss ?? null,
          faction: s.faction ?? null,
          missions: variants.map((v) => ({
            node: v.node ?? null,
            mission_type: v.missionType ?? null,
            modifier: v.modifier ?? null,
          })),
        }
      : null,
    void_trader: vt
      ? {
          active: vtActive,
          location: vt.location ?? null,
          ends: vt.endString ?? vt.expiry ?? null,
          item_count: Array.isArray(vt.inventory) ? vt.inventory.length : 0,
        }
      : null,
    fissure_count: Array.isArray(fissures) ? fissures.length : null,
  };
}

async function getFissures(args: Record<string, unknown>): Promise<unknown> {
  const platform = resolvePlatform(args);
  const raw = await wfFetch(`/${platform}/fissures`);
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];

  const fissures = list
    .map((f) => ({
      node: f.node ?? null,
      mission_type: f.missionType ?? null,
      tier: f.tier ?? null,
      enemy: f.enemy ?? null,
      is_steel_path: Boolean(f.isHard),
      is_storm: Boolean(f.isStorm),
      eta: f.eta ?? etaFrom(f.expiry),
    }))
    .sort((a, b) => {
      const ta = TIER_ORDER[String(a.tier)] ?? 99;
      const tb = TIER_ORDER[String(b.tier)] ?? 99;
      return ta - tb;
    });

  return { platform, count: fissures.length, fissures };
}

async function getInvasions(args: Record<string, unknown>): Promise<unknown> {
  const platform = resolvePlatform(args);
  const raw = await wfFetch(`/${platform}/invasions`);
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];

  const invasions = list
    .filter((i) => !i.completed)
    .map((i) => {
      const attacker = i.attacker as Record<string, unknown> | undefined;
      const defender = i.defender as Record<string, unknown> | undefined;
      const completion = typeof i.completion === 'number' ? Number(i.completion.toFixed(1)) : null;
      return {
        node: i.node ?? null,
        description: i.desc ?? null,
        attacking_faction: i.attackingFaction ?? attacker?.faction ?? null,
        defending_faction: i.defendingFaction ?? defender?.faction ?? null,
        completion_pct: completion,
        eta: i.eta ?? etaFrom(i.expiry),
      };
    });

  return { platform, count: invasions.length, invasions };
}

async function searchItems(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { error: 'provide a query', query: args.query ?? null };

  const raw = await wfFetch(`/items/search/${encodeURIComponent(query)}`);
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];

  return {
    count: Math.min(list.length, 20),
    items: list.slice(0, 20).map((it) => {
      const desc = typeof it.description === 'string' ? it.description : null;
      return {
        name: it.name ?? null,
        type: it.type ?? null,
        category: it.category ?? null,
        description: desc && desc.length > 300 ? `${desc.slice(0, 300)}…` : desc,
      };
    }),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
