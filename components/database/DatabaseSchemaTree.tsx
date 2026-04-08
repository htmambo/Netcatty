import {
  ChevronRight,
  Circle,
  Database,
  FileText,
  Hash,
  Key,
  Server,
  Table,
  Type,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import {
  ColumnInfo,
  DatabaseDriver,
  DatabaseSchema,
  TableInfo,
} from "../../domain/databaseModels";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";
import { TooltipProvider } from "../ui/tooltip";

interface DatabaseSchemaTreeProps {
  schema: DatabaseSchema;
  searchQuery?: string;
  onSelectTable: (tableName: string) => void;
  onRefresh: () => void;
}

// Get column icon based on data type
const getColumnIcon = (column: ColumnInfo): React.ReactNode => {
  const type = column.dataType.toLowerCase();

  if (column.primaryKey) {
    return <Key size={12} className="text-yellow-500" />;
  }

  if (type.includes("int") || type.includes("float") || type.includes("decimal") || type.includes("numeric")) {
    return <Hash size={12} className="text-blue-400" />;
  }

  if (type.includes("text") || type.includes("char") || type.includes("varchar") || type.includes("string")) {
    return <Type size={12} className="text-green-400" />;
  }

  if (type.includes("date") || type.includes("time") || type.includes("timestamp")) {
    return <Circle size={12} className="text-purple-400" />;
  }

  if (type.includes("bool")) {
    return <Circle size={12} className="text-orange-400" />;
  }

  if (type.includes("json") || type.includes("xml") || type.includes("blob") || type.includes("binary")) {
    return <FileText size={12} className="text-gray-400" />;
  }

  return <Circle size={12} className="text-muted-foreground" />;
};

// Get driver-specific icons
const getDriverIcon = (driver: DatabaseDriver): React.ReactNode => {
  switch (driver) {
    case "mysql":
      return <Database size={14} className="text-[#44779F]" />;
    case "postgresql":
      return <Database size={14} className="text-[#336791]" />;
    case "sqlite":
      return <Database size={14} className="text-[#003B80]" />;
    case "redis":
      return <Server size={14} className="text-[#DC382D]" />;
    case "mongodb":
      return <Database size={14} className="text-[#47A248]" />;
    default:
      return <Database size={14} className="text-muted-foreground" />;
  }
};

const DatabaseSchemaTree: React.FC<DatabaseSchemaTreeProps> = ({
  schema,
  searchQuery = "",
  onSelectTable,
  onRefresh: _onRefresh,
}) => {
  const { t } = useI18n();
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(["default"]));

  // Filter by search query
  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return schema.tables;
    const query = searchQuery.toLowerCase();
    return schema.tables.filter(
      (table) =>
        table.name.toLowerCase().includes(query) ||
        table.columns.some((col) => col.name.toLowerCase().includes(query))
    );
  }, [schema.tables, searchQuery]);

  // Group tables by schema
  const tablesBySchema = useMemo(() => {
    const groups: Record<string, TableInfo[]> = {};
    for (const table of filteredTables) {
      const schemaName = table.schema || "default";
      if (!groups[schemaName]) groups[schemaName] = [];
      groups[schemaName].push(table);
    }
    // Sort schemas
    const schemaNames = Object.keys(groups).sort();
    return schemaNames.map((name) => ({
      name,
      tables: groups[name].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filteredTables]);

  // Toggle table expansion
  const toggleTable = useCallback((tableName: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
      }
      return next;
    });
  }, []);

  // Toggle schema expansion
  const toggleSchema = useCallback((schemaName: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schemaName)) {
        next.delete(schemaName);
      } else {
        next.add(schemaName);
      }
      return next;
    });
  }, []);

  // Generate SELECT query for table
  const generateSelectQuery = useCallback(
    (table: TableInfo): string => {
      const columns = table.columns.map((c) => c.name).join(", ");
      const whereClause = table.columns
        .filter((c) => c.primaryKey)
        .map((c) => `${c.name} = ?`)
        .join(" AND ");

      let query = `SELECT ${columns}\nFROM ${table.schema ? `${table.schema}.` : ""}${table.name}`;
      if (whereClause) {
        query += `\nWHERE ${whereClause}`;
      }
      query += ";";
      return query;
    },
    []
  );

  // Generate INSERT query for table
  const generateInsertQuery = useCallback((table: TableInfo): string => {
    const columns = table.columns.filter((c) => !c.primaryKey || c.defaultValue !== undefined);
    const columnNames = columns.map((c) => c.name).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    return `INSERT INTO ${table.schema ? `${table.schema}.` : ""}${table.name} (${columnNames})\nVALUES (${placeholders});`;
  }, []);

  return (
    <div className="py-1">
      <TooltipProvider>
        {/* Schema/Server info */}
        <div className="px-2 py-1.5 mb-1 border-b border-border/40">
          <div className="flex items-center gap-2 text-xs">
            {getDriverIcon(schema.driver)}
            <span className="text-muted-foreground truncate">
              {schema.serverVersion}
            </span>
          </div>
        </div>

        {/* Tables by schema */}
        {tablesBySchema.map(({ name: schemaName, tables }) => (
          <Collapsible
            key={schemaName}
            open={expandedSchemas.has(schemaName)}
            onOpenChange={() => toggleSchema(schemaName)}
          >
            <CollapsibleTrigger asChild>
              <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 cursor-pointer rounded-sm transition-colors">
                <ChevronRight
                  size={12}
                  className={cn(
                    "transition-transform",
                    expandedSchemas.has(schemaName) && "rotate-90"
                  )}
                />
                <Server size={12} />
                <span className="truncate">
                  {schemaName === "default" ? t("database.tables") : schemaName}
                </span>
                <span className="ml-auto text-muted-foreground/60">
                  {tables.length}
                </span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {tables.map((table) => (
                <TableNode
                  key={table.name}
                  table={table}
                  expanded={expandedTables.has(table.name)}
                  onToggle={() => toggleTable(table.name)}
                  onSelect={() => onSelectTable(table.name)}
                  onGenerateSelect={() => {
                    navigator.clipboard.writeText(generateSelectQuery(table));
                  }}
                  onGenerateInsert={() => {
                    navigator.clipboard.writeText(generateInsertQuery(table));
                  }}
                  onCopyName={() => {
                    navigator.clipboard.writeText(table.name);
                  }}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}

        {/* Views */}
        {schema.views && schema.views.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 cursor-pointer rounded-sm transition-colors">
                <ChevronRight size={12} />
                <FileText size={12} />
                <span className="truncate">{t("database.views")}</span>
                <span className="ml-auto text-muted-foreground/60">
                  {schema.views.length}
                </span>
              </div>
            </CollapsibleTrigger>
          </Collapsible>
        )}

        {/* Collections (MongoDB) */}
        {schema.collections && schema.collections.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 cursor-pointer rounded-sm transition-colors">
                <ChevronRight size={12} />
                <Database size={12} />
                <span className="truncate">{t("database.collections")}</span>
                <span className="ml-auto text-muted-foreground/60">
                  {schema.collections.length}
                </span>
              </div>
            </CollapsibleTrigger>
          </Collapsible>
        )}

        {/* Extensions */}
        {schema.extensions && schema.extensions.length > 0 && (
          <div className="px-2 py-1 mt-2 border-t border-border/40">
            <div className="text-xs text-muted-foreground mb-1">
              {t("database.extensions")}
            </div>
            <div className="flex flex-wrap gap-1">
              {schema.extensions.map((ext) => (
                <span
                  key={ext}
                  className="px-1.5 py-0.5 bg-muted/50 rounded text-[10px] text-muted-foreground"
                >
                  {ext}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {filteredTables.length === 0 && searchQuery && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {t("database.noTablesFound")}
          </div>
        )}
      </TooltipProvider>
    </div>
  );
};

// Table node component
interface TableNodeProps {
  table: TableInfo;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onGenerateSelect: () => void;
  onGenerateInsert: () => void;
  onCopyName: () => void;
}

const TableNode: React.FC<TableNodeProps> = ({
  table,
  expanded,
  onToggle,
  onSelect,
  onGenerateSelect,
  onGenerateInsert,
  onCopyName,
}) => {
  const { t } = useI18n();

  const primaryKeys = table.columns.filter((c) => c.primaryKey);
  const regularColumns = table.columns.filter((c) => !c.primaryKey);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Collapsible open={expanded} onOpenChange={onToggle}>
          <CollapsibleTrigger asChild>
            <div
              className="flex items-center gap-1 px-2 py-0.5 pl-6 text-xs hover:bg-muted/50 cursor-pointer rounded-sm transition-colors"
              onDoubleClick={onSelect}
            >
              <ChevronRight
                size={10}
                className={cn(
                  "transition-transform shrink-0",
                  expanded && "rotate-90"
                )}
              />
              <Table size={12} className="text-blue-400 shrink-0" />
              <span className="truncate">{table.name}</span>
              {table.rowCountEstimate !== undefined && (
                <span className="ml-auto text-muted-foreground/60 text-[10px]">
                  {table.rowCountEstimate.toLocaleString()}
                </span>
              )}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {/* Primary key columns first */}
            {primaryKeys.map((column) => (
              <ColumnNode key={column.name} column={column} />
            ))}
            {/* Regular columns */}
            {regularColumns.map((column) => (
              <ColumnNode key={column.name} column={column} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onSelect}>
          <Table size={12} className="mr-2" />
          {t("database.selectFromTable")}
        </ContextMenuItem>
        <ContextMenuItem onClick={onGenerateSelect}>
          <FileText size={12} className="mr-2" />
          {t("database.copySelect")}
        </ContextMenuItem>
        <ContextMenuItem onClick={onGenerateInsert}>
          <FileText size={12} className="mr-2" />
          {t("database.copyInsert")}
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyName}>
          <FileText size={12} className="mr-2" />
          {t("database.copyTableName")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

// Column node component
interface ColumnNodeProps {
  column: ColumnInfo;
}

const ColumnNode: React.FC<ColumnNodeProps> = ({ column }) => {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 pl-12 text-[11px] text-muted-foreground/80 hover:text-foreground">
      {getColumnIcon(column)}
      <span className="truncate">{column.name}</span>
      <span className="text-muted-foreground/50 truncate ml-1">
        {column.dataType}
        {column.nullable && "?"}
      </span>
    </div>
  );
};

export default DatabaseSchemaTree;
