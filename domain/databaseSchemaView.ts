import type {
  ColumnInfo,
  DatabaseConfig,
  DatabaseDriver,
  DatabaseSchema,
  TableInfo,
} from "./databaseModels";

export type DatabaseObjectKind =
  | "overview"
  | "schema"
  | "table"
  | "view"
  | "collection"
  | "extension"
  | "redis-type";

export interface DatabaseObjectSelection {
  id: string;
  kind: DatabaseObjectKind;
  label: string;
  name?: string;
  schemaName?: string;
}

export interface DatabaseExplorerNode {
  id: string;
  label: string;
  kind: DatabaseObjectKind;
  count?: number;
  secondary?: string;
  schemaName?: string;
  name?: string;
  children?: DatabaseExplorerNode[];
}

export interface DatabaseExplorerSection {
  id: string;
  label: string;
  kind: "group";
  count: number;
  items: DatabaseExplorerNode[];
}

export interface DatabaseInspectorSection {
  id: string;
  title: string;
  rows?: Array<{ label: string; value: string }>;
  columns?: ColumnInfo[];
  items?: string[];
}

export interface DatabaseResultView {
  kind: "table" | "message";
  command: string;
  durationMs: number;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  type?: string;
  message?: string;
  rawText?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeColumn = (value: unknown): ColumnInfo => {
  const column = isRecord(value) ? value : {};

  return {
    name: typeof column.name === "string" ? column.name : "",
    dataType:
      typeof column.dataType === "string"
        ? column.dataType
        : typeof column.fullType === "string"
          ? column.fullType
          : "unknown",
    nullable: column.nullable === true || column.nullable === "YES",
    primaryKey:
      column.primaryKey === true ||
      column.key === "PRI" ||
      column.key === "PRIMARY",
    defaultValue:
      typeof column.defaultValue === "string"
        ? column.defaultValue
        : column.defaultValue != null
          ? String(column.defaultValue)
          : undefined,
    characterMaximumLength:
      typeof column.characterMaximumLength === "number"
        ? column.characterMaximumLength
        : undefined,
    numericPrecision:
      typeof column.numericPrecision === "number"
        ? column.numericPrecision
        : undefined,
    numericScale:
      typeof column.numericScale === "number"
        ? column.numericScale
        : undefined,
  };
};

const normalizeTable = (value: unknown): TableInfo => {
  const table = isRecord(value) ? value : {};
  const rawColumns = Array.isArray(table.columns) ? table.columns : [];

  return {
    name: typeof table.name === "string" ? table.name : "",
    schema:
      typeof table.schema === "string"
        ? table.schema
        : typeof table.database === "string"
          ? table.database
          : undefined,
    columns: rawColumns.map(normalizeColumn),
    rowCountEstimate:
      typeof table.rowCountEstimate === "number"
        ? table.rowCountEstimate
        : typeof table.rowCount === "number"
          ? table.rowCount
          : undefined,
  };
};

const getTableIdentity = (table: TableInfo): string =>
  `${table.schema || ""}:${table.name}`;

const isViewLikeTable = (value: unknown): boolean => {
  if (!isRecord(value)) return false;

  const rawType =
    typeof value.type === "string"
      ? value.type
      : typeof value.tableType === "string"
        ? value.tableType
        : "";

  const normalizedType = rawType.trim().toUpperCase();
  return normalizedType === "VIEW" || normalizedType === "SYSTEM VIEW";
};

const normalizeNumericRecord = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value)
    .map(([key, entryValue]) => {
      if (typeof entryValue === "number") return [key, entryValue] as const;
      if (isRecord(entryValue) && typeof entryValue.keys === "number") {
        return [key, entryValue.keys] as const;
      }
      return null;
    })
    .filter((entry): entry is readonly [string, number] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const normalizeDatabaseSchema = (value: unknown): DatabaseSchema => {
  const wrapper = isRecord(value) ? value : {};
  const raw = isRecord(wrapper.schema) ? wrapper.schema : wrapper;

  const rawTables = Array.isArray(raw.tables) ? raw.tables : [];
  const rawViews = Array.isArray(raw.views) ? raw.views : [];
  const rawCollections = Array.isArray(raw.collections) ? raw.collections : [];
  const rawExtensions = Array.isArray(raw.extensions) ? raw.extensions : [];
  const driver =
    typeof raw.driver === "string"
      ? (raw.driver as DatabaseDriver)
      : "sampledKeyTypes" in raw || "totalKeyCount" in raw
        ? "redis"
        : "mysql";

  const databases = Array.isArray(raw.databases)
    ? raw.databases.filter((item): item is string => typeof item === "string")
    : undefined;
  const keyspaceRecord = !Array.isArray(raw.databases) ? normalizeNumericRecord(raw.databases) : undefined;
  const keyspaces = keyspaceRecord
    ? Object.entries(keyspaceRecord).map(([name, keys]) => ({ name, keys }))
    : undefined;
  const sampledKeyTypes = normalizeNumericRecord(raw.sampledKeyTypes);
  const normalizedTables = rawTables
    .map((entry) => ({ table: normalizeTable(entry), isView: isViewLikeTable(entry) }))
    .filter(({ table }) => table.name);
  const explicitViews = rawViews.map(normalizeTable).filter((table) => table.name);
  const explicitViewIds = new Set(explicitViews.map(getTableIdentity));

  return {
    driver,
    serverVersion:
      typeof raw.serverVersion === "string"
        ? raw.serverVersion
        : typeof raw.version === "string"
          ? raw.version
          : "unknown",
    databases: databases ?? keyspaces?.map((item) => item.name),
    keyspaces,
    sampledKeyTypes,
    sampledKeyCount:
      typeof raw.sampledKeyCount === "number" ? raw.sampledKeyCount : undefined,
    totalKeyCount:
      typeof raw.totalKeyCount === "number" ? raw.totalKeyCount : undefined,
    tables: normalizedTables
      .filter(({ isView }) => !isView)
      .map(({ table }) => table),
    views: [
      ...explicitViews,
      ...normalizedTables
        .filter(({ isView, table }) => isView && !explicitViewIds.has(getTableIdentity(table)))
        .map(({ table }) => table),
    ],
    indexes: Array.isArray(raw.indexes) ? raw.indexes : [],
    collections: rawCollections.filter((item): item is string => typeof item === "string"),
    extensions: rawExtensions.filter((item): item is string => typeof item === "string"),
  };
};

const matchesSearch = (query: string, values: Array<string | undefined>): boolean => {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
};

const buildObjectId = (kind: DatabaseObjectKind, name: string, schemaName?: string): string =>
  schemaName ? `${kind}:${schemaName}.${name}` : `${kind}:${name}`;

export const buildDatabaseExplorerSections = (
  schemaInput: unknown,
  searchQuery = "",
): DatabaseExplorerSection[] => {
  const schema = normalizeDatabaseSchema(schemaInput);
  const query = searchQuery.trim().toLowerCase();
  const sections: DatabaseExplorerSection[] = [];

  const groupTables = (tables: TableInfo[], kind: "table" | "view"): DatabaseExplorerNode[] => {
    const grouped = new Map<string, DatabaseExplorerNode[]>();

    tables.forEach((table) => {
      if (
        !matchesSearch(query, [
          table.name,
          table.schema,
          ...table.columns.map((column) => `${column.name} ${column.dataType}`),
        ])
      ) {
        return;
      }

      const schemaName = table.schema || "default";
      const group = grouped.get(schemaName) || [];
      group.push({
        id: buildObjectId(kind, table.name, table.schema),
        label: table.name,
        kind,
        name: table.name,
        schemaName: table.schema,
        count: table.columns.length,
        secondary:
          table.rowCountEstimate !== undefined
            ? `${table.rowCountEstimate.toLocaleString()} rows`
            : `${table.columns.length} cols`,
      });
      grouped.set(schemaName, group);
    });

    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([schemaName, items]) => ({
        id: `schema:${kind}:${schemaName}`,
        label: schemaName === "default" ? "default" : schemaName,
        kind: "schema",
        name: schemaName,
        count: items.length,
        children: items.sort((left, right) => left.label.localeCompare(right.label)),
      }));
  };

  const tables = groupTables(schema.tables, "table");
  if (tables.length > 0) {
    sections.push({
      id: "tables",
      label: "tables",
      kind: "group",
      count: tables.reduce((sum, item) => sum + (item.count || item.children?.length || 0), 0),
      items: tables,
    });
  }

  const views = groupTables(schema.views, "view");
  if (views.length > 0) {
    sections.push({
      id: "views",
      label: "views",
      kind: "group",
      count: views.reduce((sum, item) => sum + (item.count || item.children?.length || 0), 0),
      items: views,
    });
  }

  const collections = (schema.collections || [])
    .filter((item) => matchesSearch(query, [item]))
    .sort((left, right) => left.localeCompare(right))
    .map<DatabaseExplorerNode>((item) => ({
      id: buildObjectId("collection", item),
      label: item,
      kind: "collection",
      name: item,
    }));
  if (collections.length > 0) {
    sections.push({
      id: "collections",
      label: "collections",
      kind: "group",
      count: collections.length,
      items: collections,
    });
  }

  const redisTypes = Object.entries(schema.sampledKeyTypes || {})
    .filter(([type]) => matchesSearch(query, [type]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map<DatabaseExplorerNode>(([type, count]) => ({
      id: buildObjectId("redis-type", type),
      label: type,
      kind: "redis-type",
      name: type,
      count,
      secondary: `${count.toLocaleString()} sampled`,
    }));
  if (redisTypes.length > 0) {
    sections.push({
      id: "redis-types",
      label: "redisTypes",
      kind: "group",
      count: redisTypes.length,
      items: redisTypes,
    });
  }

  const extensions = (schema.extensions || [])
    .filter((item) => matchesSearch(query, [item]))
    .sort((left, right) => left.localeCompare(right))
    .map<DatabaseExplorerNode>((item) => ({
      id: buildObjectId("extension", item),
      label: item,
      kind: "extension",
      name: item,
    }));
  if (extensions.length > 0) {
    sections.push({
      id: "extensions",
      label: "extensions",
      kind: "group",
      count: extensions.length,
      items: extensions,
    });
  }

  return sections;
};

export const findDatabaseTable = (
  schemaInput: unknown,
  selection: DatabaseObjectSelection | null,
): TableInfo | null => {
  if (!selection || (selection.kind !== "table" && selection.kind !== "view")) {
    return null;
  }

  const schema = normalizeDatabaseSchema(schemaInput);
  const source = selection.kind === "table" ? schema.tables : schema.views;

  return (
    source.find(
      (table) =>
        table.name === selection.name &&
        (selection.schemaName ? table.schema === selection.schemaName : true),
    ) || null
  );
};

export const getDefaultDatabaseSelection = (
  schemaInput: unknown,
): DatabaseObjectSelection | null => {
  const schema = normalizeDatabaseSchema(schemaInput);
  const firstTable = schema.tables[0];
  if (firstTable) {
    return {
      id: buildObjectId("table", firstTable.name, firstTable.schema),
      kind: "table",
      label: firstTable.name,
      name: firstTable.name,
      schemaName: firstTable.schema,
    };
  }

  const firstView = schema.views[0];
  if (firstView) {
    return {
      id: buildObjectId("view", firstView.name, firstView.schema),
      kind: "view",
      label: firstView.name,
      name: firstView.name,
      schemaName: firstView.schema,
    };
  }

  const firstCollection = schema.collections?.[0];
  if (firstCollection) {
    return {
      id: buildObjectId("collection", firstCollection),
      kind: "collection",
      label: firstCollection,
      name: firstCollection,
    };
  }

  const firstRedisType = Object.keys(schema.sampledKeyTypes || {}).sort()[0];
  if (firstRedisType) {
    return {
      id: buildObjectId("redis-type", firstRedisType),
      kind: "redis-type",
      label: firstRedisType,
      name: firstRedisType,
    };
  }

  const firstExtension = schema.extensions?.[0];
  if (firstExtension) {
    return {
      id: buildObjectId("extension", firstExtension),
      kind: "extension",
      label: firstExtension,
      name: firstExtension,
    };
  }

  return null;
};

const formatConnectionTarget = (config: DatabaseConfig): string => {
  if (config.driver === "sqlite") {
    return config.filePath || "";
  }
  return `${config.host || "localhost"}${config.port ? `:${config.port}` : ""}`;
};

export const buildDatabaseInspectorSections = (
  schemaInput: unknown,
  config: DatabaseConfig,
  selection: DatabaseObjectSelection | null,
): DatabaseInspectorSection[] => {
  const schema = normalizeDatabaseSchema(schemaInput);
  const resolvedSelection =
    selection || ({ id: "overview", kind: "overview", label: config.label } satisfies DatabaseObjectSelection);

  if (resolvedSelection.kind === "overview") {
    return [
      {
        id: "connection",
        title: "connection",
        rows: [
          { label: "Name", value: config.label },
          { label: "Driver", value: config.driver.toUpperCase() },
          { label: "Target", value: formatConnectionTarget(config) || "-" },
          { label: "Database", value: config.database || "-" },
          { label: "User", value: config.username || "-" },
        ],
      },
      {
        id: "server",
        title: "server",
        rows: [
          { label: "Version", value: schema.serverVersion || "unknown" },
          { label: "Tables", value: String(schema.tables.length) },
          { label: "Views", value: String(schema.views.length) },
          { label: "Collections", value: String(schema.collections?.length || 0) },
          { label: "Keys", value: String(schema.totalKeyCount || 0) },
        ],
      },
    ];
  }

  if (resolvedSelection.kind === "table" || resolvedSelection.kind === "view") {
    const table = findDatabaseTable(schema, resolvedSelection);
    if (!table) return [];

    return [
      {
        id: "summary",
        title: "summary",
        rows: [
          { label: "Type", value: resolvedSelection.kind.toUpperCase() },
          { label: "Name", value: table.name },
          { label: "Schema", value: table.schema || "default" },
          { label: "Columns", value: String(table.columns.length) },
          {
            label: "Rows",
            value:
              table.rowCountEstimate !== undefined
                ? table.rowCountEstimate.toLocaleString()
                : "-",
          },
        ],
      },
      {
        id: "columns",
        title: "columns",
        columns: table.columns,
      },
    ];
  }

  if (resolvedSelection.kind === "collection") {
    return [
      {
        id: "summary",
        title: "summary",
        rows: [
          { label: "Type", value: "COLLECTION" },
          { label: "Name", value: resolvedSelection.name || resolvedSelection.label },
        ],
      },
    ];
  }

  if (resolvedSelection.kind === "redis-type") {
    return [
      {
        id: "summary",
        title: "summary",
        rows: [
          { label: "Type", value: resolvedSelection.name || resolvedSelection.label },
          {
            label: "Sampled Keys",
            value: String(schema.sampledKeyTypes?.[resolvedSelection.name || ""] || 0),
          },
          {
            label: "Total Keys",
            value: String(schema.totalKeyCount || 0),
          },
        ],
      },
    ];
  }

  if (resolvedSelection.kind === "extension") {
    return [
      {
        id: "summary",
        title: "summary",
        rows: [
          { label: "Type", value: "EXTENSION" },
          { label: "Name", value: resolvedSelection.name || resolvedSelection.label },
        ],
      },
    ];
  }

  return [];
};

export const buildQueryTemplateForSelection = (
  selection: DatabaseObjectSelection | null,
  schemaInput: unknown,
  driver: DatabaseDriver,
): { title: string; query: string } | null => {
  if (!selection) return null;

  if (selection.kind === "table" || selection.kind === "view") {
    const table = findDatabaseTable(schemaInput, selection);
    const objectName = table?.schema ? `${table.schema}.${table.name}` : table?.name || selection.label;
    return {
      title: selection.label,
      query: `SELECT *\nFROM ${objectName}\nLIMIT 200;`,
    };
  }

  if (selection.kind === "collection") {
    return {
      title: selection.label,
      query: `db.${selection.label}.find({}).limit(50)`,
    };
  }

  if (selection.kind === "redis-type") {
    return {
      title: selection.label,
      query: `SCAN 0 MATCH * COUNT 100`,
    };
  }

  if (driver === "redis") {
    return {
      title: "Redis",
      query: "INFO",
    };
  }

  return null;
};

const toText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value === null) return "null";
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const normalizeColumns = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizeRowsForGrid = (
  value: unknown,
  explicitColumns: string[],
): { columns: string[]; rows: Record<string, unknown>[] } | null => {
  if (!Array.isArray(value)) return null;

  if (value.length === 0) {
    return {
      columns: explicitColumns,
      rows: [],
    };
  }

  if (value.every((item) => isRecord(item))) {
    const discoveredColumns = new Set(explicitColumns);
    value.forEach((item) => {
      Object.keys(item).forEach((key) => discoveredColumns.add(key));
    });
    const columns = [...discoveredColumns];
    return {
      columns,
      rows: value.map((item) => ({ ...item })),
    };
  }

  if (
    value.length % 2 === 0 &&
    value.every((item) => !Array.isArray(item) && !isRecord(item))
  ) {
    return {
      columns: ["key", "value"],
      rows: value.reduce<Record<string, unknown>[]>((rows, item, index, items) => {
        if (index % 2 === 0) {
          rows.push({
            key: item,
            value: items[index + 1],
          });
        }
        return rows;
      }, []),
    };
  }

  if (value.every((item) => Array.isArray(item) && item.length === 2)) {
    return {
      columns: ["key", "value"],
      rows: value.map((item) => ({
        key: item[0],
        value: item[1],
      })),
    };
  }

  const firstColumn = explicitColumns[0] || "value";
  return {
    columns: explicitColumns.length > 0 ? explicitColumns : [firstColumn],
    rows: value.map((item) => ({
      [firstColumn]: item,
    })),
  };
};

export const normalizeDatabaseQueryResult = (
  value: unknown,
): DatabaseResultView => {
  const raw = isRecord(value) ? value : {};
  const explicitColumns = normalizeColumns(raw.columns).length > 0
    ? normalizeColumns(raw.columns)
    : normalizeColumns(raw.fields);
  const command = typeof raw.command === "string" ? raw.command : "";
  const durationMs = typeof raw.durationMs === "number" ? raw.durationMs : 0;
  const error = typeof raw.error === "string" ? raw.error : undefined;
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const message = typeof raw.message === "string" ? raw.message : undefined;
  const rowCount = typeof raw.rowCount === "number" ? raw.rowCount : undefined;
  const truncated = raw.truncated === true;

  if (error) {
    return {
      kind: "message",
      command,
      durationMs,
      columns: [],
      rows: [],
      error,
      type,
      message: error,
      rawText: error,
    };
  }

  const normalizedRows =
    normalizeRowsForGrid(raw.rows, explicitColumns) ||
    normalizeRowsForGrid(raw.result, explicitColumns);

  if (normalizedRows) {
    return {
      kind: "table",
      command,
      durationMs,
      columns: normalizedRows.columns,
      rows: normalizedRows.rows,
      rowCount: rowCount ?? normalizedRows.rows.length,
      truncated,
      type,
      message,
      rawText:
        normalizedRows.rows.length === 0 && message
          ? message
          : undefined,
    };
  }

  if (isRecord(raw.result)) {
    const rows = Object.entries(raw.result).map(([key, entryValue]) => ({
      key,
      value: entryValue,
    }));
    return {
      kind: "table",
      command,
      durationMs,
      columns: ["key", "value"],
      rows,
      rowCount: rowCount ?? rows.length,
      truncated,
      type,
      message,
    };
  }

  const scalarMessage =
    raw.result !== undefined && raw.result !== null
      ? toText(raw.result)
      : message || "";

  return {
    kind: "message",
    command,
    durationMs,
    columns: [],
    rows: [],
    rowCount,
    truncated,
    type,
    message: scalarMessage,
    rawText: scalarMessage,
  };
};

export const tokenizeDatabaseCommand = (text: string): string[] => {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`|(\S+)/g;

  for (const match of text.matchAll(pattern)) {
    const token = match[1] || match[2] || match[3] || match[4] || "";
    if (token) {
      tokens.push(token.replace(/\\(["'`\\])/g, "$1"));
    }
  }

  return tokens;
};
