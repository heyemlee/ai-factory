import rawCatalog from "@/lib/cabinet_catalog_data.json";

export interface CabinetCatalogRecord {
  category: string;
  abcItem: string;
  width: number;
  height: number;
  depth: number | null;
  listPrice: number | null;
  doorQty: number | null;
  hingeQty: number | null;
  adjustableShelfQty: number | null;
  fixedShelfQty: number | null;
  drawerQty: number | null;
  doorPlankArea: number | null;
  leftPanelArea: number | null;
  rightPanelArea: number | null;
  topPanelArea: number | null;
  basePanelArea: number | null;
  backboardArea: number | null;
  laminateArea: number | null;
  boxFaceArea: number | null;
  doorEdgeBandingLength: number | null;
  cabinetEdgeBandingLength: number | null;
  straightBlindHinge: number | null;
  lazySusan155Hinge: number | null;
  lazySusanPieCut: number | null;
  pentagonHinge: number | null;
}

export type DimensionSource = "database" | "inferred";

export interface CabinetDimensionResult {
  resolved: true;
  source: DimensionSource;
  abcItem: string;
  normalizedItem: string;
  category: string;
  width: number;
  height: number;
  depth: number | null;
  matchedPrefix?: string;
  ignoredSuffix?: string | null;
  record?: CabinetCatalogRecord;
}

export interface CabinetDimensionError {
  resolved: false;
  abcItem: string;
  normalizedItem: string;
  error: string;
}

export type CabinetDimensionResolution = CabinetDimensionResult | CabinetDimensionError;

type RuleMode =
  | "widthOnly"
  | "widthHeight"
  | "cornerSink"
  | "tallPantry"
  | "ipPanel"
  | "rollOutTray"
  | "floatingShelf"
  | "toeKick";

interface CabinetRule {
  prefix: string;
  mode: RuleMode;
  category: string;
  defaultHeight?: number;
  defaultDepth?: number | null;
}

export const cabinetCatalog = rawCatalog as CabinetCatalogRecord[];

export function normalizeCabinetItem(item: string) {
  return item.trim().replace(/\s+/g, " ").toUpperCase();
}

const databaseIndex = new Map(
  cabinetCatalog.map((record) => [normalizeCabinetItem(record.abcItem), record])
);

const nonDimensionSuffixes = ["FF", "DW", "L", "R", "T"] as const;

function makeRules(prefixes: string[], rule: Omit<CabinetRule, "prefix">): CabinetRule[] {
  return prefixes.map((prefix) => ({ prefix, ...rule }));
}

function makeRule(rule: CabinetRule): CabinetRule {
  return rule;
}

const ruleDefinitions: CabinetRule[] = [
  ...makeRules(["TCDRB", "TCFDB", "FDRSB", "1DRSB", "1DRB", "2DRB", "3DRB", "2CDB", "1CDB", "FDB", "SPB", "4DB", "MB", "OSB", "BCB", "LSCB"], {
    mode: "widthOnly" as const,
    category: "Base cabinet",
    defaultHeight: 34.5,
    defaultDepth: 24,
  }),
  makeRule({ prefix: "ESB", mode: "widthOnly", category: "End shelf base", defaultHeight: 34.5, defaultDepth: 12 }),
  makeRule({ prefix: "CSB", mode: "cornerSink", category: "Corner sink base", defaultHeight: 34.5 }),
  ...makeRules(["WBC", "WAC", "WOS", "WES", "WSL", "WBF", "WM", "W"], {
    mode: "widthHeight" as const,
    category: "Wall cabinet",
    defaultDepth: 12,
  }),
  makeRule({ prefix: "WDC", mode: "widthHeight", category: "Diagonal wall corner", defaultDepth: 24 }),
  makeRule({ prefix: "RFW", mode: "widthHeight", category: "Refrigerator wall cabinet", defaultDepth: 24 }),
  makeRule({ prefix: "SO", mode: "widthHeight", category: "Single oven tall cabinet", defaultDepth: 24 }),
  makeRule({ prefix: "DO", mode: "widthHeight", category: "Double oven tall cabinet", defaultDepth: 24 }),
  makeRule({ prefix: "TP", mode: "tallPantry", category: "Tall pantry / tall panel" }),
  ...makeRules(["VFB", "VSB", "V2D", "V3D", "V4D", "V"], {
    mode: "widthOnly" as const,
    category: "Vanity cabinet",
    defaultHeight: 34.5,
    defaultDepth: 21,
  }),
  ...makeRules(["VF2D", "VF"], {
    mode: "widthOnly" as const,
    category: "Floating vanity",
    defaultHeight: 24,
    defaultDepth: 21,
  }),
  makeRule({ prefix: "VKD", mode: "widthOnly", category: "Vanity knee drawer", defaultHeight: 6, defaultDepth: 21 }),
  ...makeRules(["DWP", "RFP", "BF", "BP", "TF", "WF", "WP", "VP"], {
    mode: "widthHeight" as const,
    category: "Panel / filler",
    defaultDepth: null,
  }),
  makeRule({ prefix: "IP", mode: "ipPanel", category: "Island panel", defaultDepth: null }),
  makeRule({ prefix: "RT", mode: "rollOutTray", category: "Roll out tray", defaultDepth: 21 }),
  makeRule({ prefix: "FLOATING-SHELF ", mode: "floatingShelf", category: "Floating shelf", defaultHeight: 2.25 }),
  makeRule({ prefix: "TK", mode: "toeKick", category: "Toe kick", defaultDepth: null }),
].sort((a, b) => b.prefix.length - a.prefix.length);

function stripKnownSuffix(body: string) {
  for (const suffix of nonDimensionSuffixes) {
    if (body.endsWith(suffix)) {
      return {
        numericText: body.slice(0, -suffix.length),
        suffix,
      };
    }
  }

  return {
    numericText: body,
    suffix: null,
  };
}

function parseDigits(text: string, context: string) {
  if (!/^\d+$/.test(text)) {
    throw new Error(`${context} contains non-numeric dimension text`);
  }

  return text;
}

function parseWidthHeightAfterTwoDigits(text: string, context: string) {
  const digits = parseDigits(text, context);
  if (digits.length < 4) {
    throw new Error(`${context} needs at least 4 dimension digits`);
  }

  return {
    width: Number(digits.slice(0, 2)),
    height: Number(digits.slice(2)),
  };
}

function parseOptionalExplicitDimensions(
  text: string,
  context: string,
  defaults: { height?: number; depth?: number | null } = {}
) {
  const digits = parseDigits(text, context);

  if (digits.length <= 2) {
    return {
      width: Number(digits),
      height: defaults.height,
      depth: defaults.depth ?? null,
    };
  }

  if (digits.length === 4) {
    return {
      width: Number(digits.slice(0, 2)),
      height: Number(digits.slice(2, 4)),
      depth: defaults.depth ?? null,
    };
  }

  if (digits.length === 6) {
    return {
      width: Number(digits.slice(0, 2)),
      height: Number(digits.slice(2, 4)),
      depth: Number(digits.slice(4, 6)),
    };
  }

  throw new Error(`${context} dimension digits must be 2, 4, or 6 digits`);
}

function inferCabinetDimensions(normalizedItem: string): CabinetDimensionResult {
  const rule = ruleDefinitions.find((candidate) => normalizedItem.startsWith(candidate.prefix));

  if (!rule) {
    throw new Error("Unknown item prefix");
  }

  const body = normalizedItem.slice(rule.prefix.length);
  const { numericText, suffix } = stripKnownSuffix(body);

  let width: number;
  let height: number;
  let depth: number | null = rule.defaultDepth ?? null;

  switch (rule.mode) {
    case "widthOnly": {
      const parsed = parseOptionalExplicitDimensions(numericText, normalizedItem, {
        height: rule.defaultHeight,
        depth: rule.defaultDepth,
      });
      width = parsed.width;
      height = parsed.height ?? 0;
      depth = parsed.depth;
      break;
    }
    case "widthHeight": {
      const parsed =
        numericText.length === 6
          ? parseOptionalExplicitDimensions(numericText, normalizedItem, { depth: rule.defaultDepth })
          : parseWidthHeightAfterTwoDigits(numericText, normalizedItem);
      width = parsed.width;
      height = parsed.height ?? 0;
      if ("depth" in parsed) {
        depth = parsed.depth;
      }
      break;
    }
    case "cornerSink": {
      const parsed = parseOptionalExplicitDimensions(numericText, normalizedItem, {
        height: rule.defaultHeight ?? 34.5,
      });
      width = parsed.width;
      height = parsed.height ?? 34.5;
      depth = parsed.depth ?? width;
      break;
    }
    case "tallPantry": {
      const parsed =
        numericText.length === 6
          ? parseOptionalExplicitDimensions(numericText, normalizedItem)
          : parseWidthHeightAfterTwoDigits(numericText, normalizedItem);
      width = parsed.width;
      height = parsed.height ?? 0;
      depth = "depth" in parsed && parsed.depth !== null ? parsed.depth : suffix ? 24 : null;
      break;
    }
    case "ipPanel": {
      const digits = parseDigits(numericText, normalizedItem);
      if (digits.length < 4) {
        throw new Error(`${normalizedItem} needs at least 4 dimension digits`);
      }
      width = Number(digits.slice(0, -2));
      height = Number(digits.slice(-2));
      break;
    }
    case "rollOutTray": {
      const parsed = parseWidthHeightAfterTwoDigits(numericText, normalizedItem);
      width = Number((parsed.width - 3.875).toFixed(3));
      height = parsed.height;
      break;
    }
    case "floatingShelf": {
      const digits = parseDigits(numericText, normalizedItem);
      if (digits.length < 4) {
        throw new Error(`${normalizedItem} needs at least 4 dimension digits`);
      }
      width = Number(digits.slice(0, -2));
      height = rule.defaultHeight ?? 2.25;
      depth = Number(digits.slice(-2));
      break;
    }
    case "toeKick": {
      if (normalizedItem !== "TK9") {
        throw new Error("Unknown toe kick size");
      }
      width = 4.5;
      height = 96;
      break;
    }
  }

  if (!height) {
    throw new Error("Unable to infer height");
  }

  return {
    resolved: true,
    source: "inferred",
    abcItem: normalizedItem,
    normalizedItem,
    category: rule.category,
    width,
    height,
    depth,
    matchedPrefix: rule.prefix,
    ignoredSuffix: suffix,
  };
}

export function resolveCabinetDimensions(item: string): CabinetDimensionResolution {
  const normalizedItem = normalizeCabinetItem(item);

  if (!normalizedItem) {
    return {
      resolved: false,
      abcItem: item,
      normalizedItem,
      error: "ABC item is required",
    };
  }

  const record = databaseIndex.get(normalizedItem);
  if (record) {
    return {
      resolved: true,
      source: "database",
      abcItem: record.abcItem,
      normalizedItem,
      category: record.category,
      width: record.width,
      height: record.height,
      depth: record.depth,
      record,
    };
  }

  try {
    return inferCabinetDimensions(normalizedItem);
  } catch (error) {
    return {
      resolved: false,
      abcItem: item,
      normalizedItem,
      error: error instanceof Error ? error.message : "Unable to resolve item",
    };
  }
}

export const cabinetCategories = Array.from(
  new Set(cabinetCatalog.map((record) => record.category))
).sort((a, b) => a.localeCompare(b));
