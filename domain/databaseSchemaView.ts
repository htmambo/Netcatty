import type {
  ColumnInfo,
  ColumnInputType,
  DatabaseConfig,
  DatabaseDriver,
  DatabaseSchema,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  FilterState,
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
  expandable?: boolean;
  loaded?: boolean;
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

export interface DatabaseObjectDetails {
  columns?: ColumnInfo[];
}

export interface DatabasePreviewQueryOptions {
  page?: number;
  pageSize?: number;
}

const MYSQL_PREVIEW_LIMIT = 100;
const MYSQL_PREVIEW_TEXT_LENGTH = 256;

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
    columnsLoaded:
      typeof table.columnsLoaded === "boolean"
        ? table.columnsLoaded
        : rawColumns.length > 0,
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
  const loadedDatabases = Array.isArray(raw.loadedDatabases)
    ? raw.loadedDatabases.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    driver,
    serverVersion:
      typeof raw.serverVersion === "string"
        ? raw.serverVersion
        : typeof raw.version === "string"
          ? raw.version
          : "unknown",
    databases: databases ?? keyspaces?.map((item) => item.name),
    loadedDatabases,
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
  const loadedDatabases = new Set(
    schema.loadedDatabases && schema.loadedDatabases.length > 0
      ? schema.loadedDatabases
      : [
          ...schema.tables.map((table) => table.schema).filter((item): item is string => Boolean(item)),
          ...schema.views.map((view) => view.schema).filter((item): item is string => Boolean(item)),
        ],
  );

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
            : table.columnsLoaded
              ? `${table.columns.length} cols`
              : undefined,
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
  const views = groupTables(schema.views, "view");
  const shouldGroupByDatabase =
    schema.driver === "mysql" &&
    (schema.databases?.length || 0) > 0;

  if (shouldGroupByDatabase) {
    const tableGroups = new Map(
      tables.map((item) => [item.name || item.label, item.children || []] as const),
    );
    const viewGroups = new Map(
      views.map((item) => [item.name || item.label, item.children || []] as const),
    );

    const databaseNodes = (schema.databases || [])
      .filter((databaseName) => {
        const tableChildren = tableGroups.get(databaseName) || [];
        const viewChildren = viewGroups.get(databaseName) || [];
        if (!query) return true;
        if (matchesSearch(query, [databaseName])) return true;
        return [...tableChildren, ...viewChildren].some((child) =>
          matchesSearch(query, [child.label, child.name, child.schemaName, child.secondary]),
        );
      })
      .sort((left, right) => left.localeCompare(right))
      .map<DatabaseExplorerNode>((databaseName) => {
        const tableChildren = tableGroups.get(databaseName) || [];
        const viewChildren = viewGroups.get(databaseName) || [];
        const children = [...tableChildren, ...viewChildren].sort((left, right) =>
          left.label.localeCompare(right.label),
        );

        return {
          id: `schema:database:${databaseName}`,
          label: databaseName,
          kind: "schema",
          name: databaseName,
          count: children.length || undefined,
          expandable: true,
          loaded: loadedDatabases.has(databaseName),
          children,
        };
      });

    if (databaseNodes.length > 0) {
      sections.push({
        id: "databases",
        label: "databases",
        kind: "group",
        count: databaseNodes.length,
        items: databaseNodes,
      });
    }
  } else {
    if (tables.length > 0) {
      sections.push({
        id: "tables",
        label: "tables",
        kind: "group",
        count: tables.reduce((sum, item) => sum + (item.count || item.children?.length || 0), 0),
        items: tables,
      });
    }

    if (views.length > 0) {
      sections.push({
        id: "views",
        label: "views",
        kind: "group",
        count: views.reduce((sum, item) => sum + (item.count || item.children?.length || 0), 0),
        items: views,
      });
    }
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
          { label: "Columns", value: table.columnsLoaded ? String(table.columns.length) : "-" },
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
        columns: table.columnsLoaded ? table.columns : [],
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
    const objectName = table?.schema
      ? `${quoteSqlIdentifier(driver, table.schema)}.${quoteSqlIdentifier(driver, table.name)}`
      : quoteSqlIdentifier(driver, table?.name || selection.label);
    return {
      title: selection.label,
      query: `SELECT *\nFROM ${objectName}\nLIMIT 100;`,
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

const MYSQL_GEOMETRY_TYPES = [
  "geometry",
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection",
];

const buildMysqlPreviewColumnExpression = (column: ColumnInfo): string => {
  const columnRef = quoteSqlIdentifier("mysql", column.name);
  const alias = quoteSqlIdentifier("mysql", column.name);
  const type = column.dataType.trim().toLowerCase();

  if (
    type.includes("blob") ||
    type.includes("binary") ||
    type.startsWith("bit")
  ) {
    return `CASE WHEN ${columnRef} IS NULL THEN NULL ELSE CONCAT('<binary ', OCTET_LENGTH(${columnRef}), ' bytes>') END AS ${alias}`;
  }

  if (MYSQL_GEOMETRY_TYPES.some((entry) => type.startsWith(entry))) {
    return `CASE WHEN ${columnRef} IS NULL THEN NULL ELSE ST_AsText(${columnRef}) END AS ${alias}`;
  }

  if (type.includes("text") || type.startsWith("json")) {
    return `CASE WHEN ${columnRef} IS NULL THEN NULL WHEN CHAR_LENGTH(CAST(${columnRef} AS CHAR)) > ${MYSQL_PREVIEW_TEXT_LENGTH} THEN CONCAT(LEFT(CAST(${columnRef} AS CHAR), ${MYSQL_PREVIEW_TEXT_LENGTH}), '...') ELSE CAST(${columnRef} AS CHAR) END AS ${alias}`;
  }

  return columnRef;
};

export const buildPreviewQueryTemplateForSelection = (
  selection: DatabaseObjectSelection | null,
  schemaInput: unknown,
  driver: DatabaseDriver,
  options?: DatabasePreviewQueryOptions,
): { title: string; query: string } | null => {
  if (!selection || (selection.kind !== "table" && selection.kind !== "view")) {
    return buildQueryTemplateForSelection(selection, schemaInput, driver);
  }

  const page = Math.max(1, options?.page || 1);
  const pageSize = Math.max(1, options?.pageSize || MYSQL_PREVIEW_LIMIT);
  const offset = (page - 1) * pageSize;
  const table = findDatabaseTable(schemaInput, selection);
  const objectName = table?.schema
    ? `${quoteSqlIdentifier(driver, table.schema)}.${quoteSqlIdentifier(driver, table.name)}`
      : quoteSqlIdentifier(driver, table?.name || selection.label);

  if (driver === "mysql" && table?.columnsLoaded && table.columns.length > 0) {
    const selectList = table.columns
      .map((column) => `  ${buildMysqlPreviewColumnExpression(column)}`)
      .join(",\n");

    return {
      title: selection.label,
      query: `SELECT\n${selectList}\nFROM ${objectName}\nLIMIT ${pageSize}${offset > 0 ? ` OFFSET ${offset}` : ""};`,
    };
  }

  return {
    title: selection.label,
    query: `SELECT *\nFROM ${objectName}\nLIMIT ${pageSize}${offset > 0 ? ` OFFSET ${offset}` : ""};`,
  };
};

const quoteSqlIdentifier = (driver: DatabaseDriver, identifier: string): string => {
  if (!identifier) return identifier;

  if (driver === "mysql") {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  if (driver === "postgresql") {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
  }

  return identifier;
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

export const applyDatabaseObjectDetails = (
  schemaInput: unknown,
  selection: DatabaseObjectSelection | null,
  details: DatabaseObjectDetails,
): unknown => {
  if (!selection || (selection.kind !== "table" && selection.kind !== "view")) {
    return schemaInput;
  }

  const wrapper = isRecord(schemaInput) ? { ...schemaInput } : {};
  const hasWrappedSchema = isRecord(wrapper.schema);
  const rawSchema = hasWrappedSchema ? { ...(wrapper.schema as Record<string, unknown>) } : { ...wrapper };
  const collectionKey = selection.kind === "table" ? "tables" : "views";
  const source = Array.isArray(rawSchema[collectionKey]) ? rawSchema[collectionKey] : [];

  rawSchema[collectionKey] = source.map((entry) => {
    if (!isRecord(entry)) return entry;

    const entryName = typeof entry.name === "string" ? entry.name : "";
    const entrySchema =
      typeof entry.schema === "string"
        ? entry.schema
        : typeof entry.database === "string"
          ? entry.database
          : undefined;

    if (
      entryName !== selection.name ||
      (selection.schemaName ? entrySchema !== selection.schemaName : false)
    ) {
      return entry;
    }

    return {
      ...entry,
      columns: details.columns ?? entry.columns ?? [],
      columnsLoaded: Array.isArray(details.columns),
    };
  });

  return hasWrappedSchema ? { ...wrapper, schema: rawSchema } : rawSchema;
};

export const mergeDatabaseSchema = (
  currentSchemaInput: unknown,
  nextSchemaInput: unknown,
): unknown => {
  const current = normalizeDatabaseSchema(currentSchemaInput);
  const next = normalizeDatabaseSchema(nextSchemaInput);

  const mergeTables = (left: TableInfo[], right: TableInfo[]): TableInfo[] => {
    const merged = new Map<string, TableInfo>();

    for (const table of left) {
      merged.set(`${table.schema || ""}:${table.name}`, table);
    }
    for (const table of right) {
      merged.set(`${table.schema || ""}:${table.name}`, table);
    }

    return [...merged.values()].sort((a, b) => {
      const schemaCompare = (a.schema || "").localeCompare(b.schema || "");
      if (schemaCompare !== 0) return schemaCompare;
      return a.name.localeCompare(b.name);
    });
  };

  return {
    driver: next.driver || current.driver,
    serverVersion:
      next.serverVersion && next.serverVersion !== "unknown"
        ? next.serverVersion
        : current.serverVersion,
    databases: Array.from(
      new Set([...(current.databases || []), ...(next.databases || [])]),
    ).sort((a, b) => a.localeCompare(b)),
    loadedDatabases: Array.from(
      new Set([...(current.loadedDatabases || []), ...(next.loadedDatabases || [])]),
    ).sort((a, b) => a.localeCompare(b)),
    tables: mergeTables(current.tables, next.tables),
    views: mergeTables(current.views, next.views),
    indexes: next.indexes.length > 0 ? next.indexes : current.indexes,
    collections: next.collections || current.collections,
    extensions: next.extensions || current.extensions,
    sampledKeyTypes: next.sampledKeyTypes || current.sampledKeyTypes,
    sampledKeyCount: next.sampledKeyCount ?? current.sampledKeyCount,
    totalKeyCount: next.totalKeyCount ?? current.totalKeyCount,
    keyspaces: next.keyspaces || current.keyspaces,
  };
};

// --- Column input type detection ---

export const detectColumnInputType = (column: ColumnInfo, _driver: DatabaseDriver): ColumnInputType => {
  const type = column.dataType.trim().toLowerCase();

  // Boolean
  if (type === "boolean" || type === "bool" || type === "bit(1)") {
    return "boolean";
  }

  // Date/time
  if (type === "date") return "date";
  if (type === "datetime" || type === "timestamp" || type === "datetime2" || type === "smalldatetime") {
    return "datetime";
  }

  // Numeric
  if (
    type === "int" ||
    type === "bigint" ||
    type === "tinyint" ||
    type === "smallint" ||
    type === "mediumint" ||
    type === "integer" ||
    type === "int4" ||
    type === "int8" ||
    type === "bigserial" ||
    type === "serial"
  ) {
    return "number";
  }

  if (
    type === "decimal" ||
    type === "numeric" ||
    type === "float" ||
    type === "double" ||
    type === "real" ||
    type === "float4" ||
    type === "float8" ||
    type === "money" ||
    type === "smallmoney"
  ) {
    return "decimal";
  }

  // Enum
  const enumMatch = type.match(/^enum\s*\(/i);
  if (enumMatch || type.startsWith("enum")) {
    return "enum";
  }

  // Long text (TEXT, MEDIUMTEXT, LONGTEXT) → opens textarea modal
  const baseType = type.replace(/\(.*/, "").trim();
  if (
    baseType === "text" ||
    baseType === "mediumtext" ||
    baseType === "longtext" ||
    baseType === "tinytext"
  ) {
    return "longtext";
  }

  // Short text (VARCHAR, CHAR, etc.) → inline input
  return "text";
};

// --- SQL value formatting ---

const formatSqlValue = (value: unknown, inputType: ColumnInputType, driver: DatabaseDriver): string => {
  if (value === null || value === undefined) return "NULL";

  switch (inputType) {
    case "boolean":
      if (typeof value === "boolean") return value ? "1" : "0";
      if (typeof value === "string") {
        const lower = value.toLowerCase();
        if (lower === "1" || lower === "true" || lower === "yes" || lower === "on") return "1";
        return "0";
      }
      return Number(value) ? "1" : "0";

    case "number":
      return String(Number(value));

    case "decimal":
      return String(Number(value));

    case "date":
    case "datetime":
      if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
      return `'${String(value).replace(/'/g, "''")}'`;

    default:
      if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
      if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
      return `'${String(value).replace(/'/g, "''")}'`;
  }
};

// --- WHERE clause builder ---

const quoteValueForWhere = (value: unknown, operator: FilterOperator): string => {
  if (operator === "IS NULL" || operator === "IS NOT NULL") return "";

  if (operator === "IN" || operator === "NOT IN") {
    if (Array.isArray(value)) {
      const formatted = value.map((v) => {
        if (v === null) return "NULL";
        if (typeof v === "number") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      return `(${formatted.join(", ")})`;
    }
    return "(NULL)";
  }

  if (operator === "BETWEEN") {
    if (Array.isArray(value) && value.length >= 2) {
      const left = typeof value[0] === "number" ? String(value[0]) : `'${String(value[0]).replace(/'/g, "''")}'`;
      const right = typeof value[1] === "number" ? String(value[1]) : `'${String(value[1]).replace(/'/g, "''")}'`;
      return `${left} AND ${right}`;
    }
    return "NULL AND NULL";
  }

  if (operator === "LIKE" || operator === "NOT LIKE") {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
  }

  if (typeof value === "number") return String(value);
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
};

const buildGroupClause = (group: FilterGroup): string | null => {
  const allChildren = group.children;

  const parts: string[] = [];
  for (let i = 0; i < allChildren.length; i++) {
    const child = allChildren[i];

    // Check if child is enabled
    const isCondition = "column" in child;
    if (isCondition) {
      const cond = child as FilterCondition;
      if (!cond.enabled || !cond.column) continue;
    } else {
      const sub = buildGroupClause(child as FilterGroup);
      if (!sub) continue;
      parts.push(`(${sub})`);
      continue;
    }

    // Build condition string
    const cond = child as FilterCondition;
    const colRef = cond.column;
    const op = cond.operator;
    const condStr = op === "IS NULL" || op === "IS NOT NULL"
      ? `${colRef} ${op}`
      : `${colRef} ${op} ${quoteValueForWhere(cond.value, op)}`;

    // Use child's logicOperator (AND/OR with previous), or default to group's
    const logicOp = cond.logicOperator ?? group.logicOperator;
    if (parts.length > 0) {
      parts.push(` ${logicOp} `);
    }
    parts.push(condStr);
  }

  return parts.length === 0 ? null : parts.join("");
};

export const buildWhereClause = (filter: FilterState, _driver: DatabaseDriver): string | null => {
  return buildGroupClause(filter.rootGroup);
};

// --- UPDATE statement builder ---

export const buildUpdateStatement = (
  tableName: string,
  schemaName: string | undefined,
  pkColumn: string,
  pkValue: unknown,
  updates: Record<string, unknown>,
  driver: DatabaseDriver,
): string => {
  const objectName = schemaName
    ? `${quoteSqlIdentifier(driver, schemaName)}.${quoteSqlIdentifier(driver, tableName)}`
    : quoteSqlIdentifier(driver, tableName);

  const setParts = Object.entries(updates).map(([col, val]) => {
    if (val === null) return `${quoteSqlIdentifier(driver, col)} = NULL`;
    if (typeof val === "number") return `${quoteSqlIdentifier(driver, col)} = ${String(val)}`;
    return `${quoteSqlIdentifier(driver, col)} = '${String(val).replace(/'/g, "''")}'`;
  });

  const pkValStr =
    typeof pkValue === "number" ? String(pkValue) : `'${String(pkValue).replace(/'/g, "''")}'`;

  return `UPDATE ${objectName} SET ${setParts.join(", ")} WHERE ${quoteSqlIdentifier(driver, pkColumn)} = ${pkValStr} LIMIT 1;`;
};

// --- Preview query with WHERE filter ---

export const buildFilteredPreviewQuery = (
  selection: DatabaseObjectSelection | null,
  schemaInput: unknown,
  driver: DatabaseDriver,
  filter: FilterState,
  options?: DatabasePreviewQueryOptions,
): { title: string; query: string } | null => {
  const base = buildPreviewQueryTemplateForSelection(selection, schemaInput, driver, options);
  if (!base) return null;

  const whereClause = buildWhereClause(filter, driver);
  if (!whereClause) return base;

  // Insert WHERE before LIMIT
  const limitMatch = base.query.match(/\bLIMIT\s+\d+/i);
  if (limitMatch) {
    const query = base.query.replace(
      /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?/i,
      `WHERE ${whereClause} $&`,
    );
    return { title: base.title, query };
  }

  // No LIMIT found, append WHERE before trailing semicolon
  const query = base.query.replace(/;?\s*$/, ` WHERE ${whereClause};`);
  return { title: base.title, query };
};
