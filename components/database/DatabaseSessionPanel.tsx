import {
  ChevronRight,
  Copy,
  Database,
  Loader2,
  Play,
  PlugZap,
  RefreshCw,
  Search,
  Table,
  X,
} from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import {
  DatabaseConfig,
  DatabaseSchema,
  DatabaseSession,
  QueryResult,
} from "../../domain/databaseModels";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import DatabaseSchemaTree from "./DatabaseSchemaTree";
import DatabaseResultsTable from "./DatabaseResultsTable";
import DatabaseStatusBar from "./DatabaseStatusBar";

interface DatabaseSessionPanelProps {
  session: DatabaseSession;
  config: DatabaseConfig;
  schema?: DatabaseSchema;
  onDisconnect: () => void;
  onExecuteQuery: (query: string) => Promise<QueryResult>;
  onRefreshSchema: () => void;
  onSelectTable?: (tableName: string) => void;
}

interface QueryHistoryItem {
  id: string;
  query: string;
  timestamp: number;
  success: boolean;
  durationMs?: number;
  error?: string;
}

const MAX_QUERY_LENGTH = 10000;

const DatabaseSessionPanel: React.FC<DatabaseSessionPanelProps> = ({
  session,
  config,
  schema,
  onDisconnect,
  onExecuteQuery,
  onRefreshSchema,
  onSelectTable,
}) => {
  const { t } = useI18n();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [showSchema, setShowSchema] = useState(true);

  // Get current results or last successful query
  const currentResult = result || queryHistory.find((h) => h.success)?.durationMs;

  // Execute query
  const handleExecute = useCallback(async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    // Limit query length for safety
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      setResult({
        command: trimmedQuery.split("\n")[0],
        durationMs: 0,
        error: t("database.queryTooLong"),
      });
      return;
    }

    setIsExecuting(true);
    setResult(null);

    const startTime = Date.now();
    const historyItem: QueryHistoryItem = {
      id: crypto.randomUUID(),
      query: trimmedQuery,
      timestamp: startTime,
      success: false,
    };

    try {
      const queryResult = await onExecuteQuery(trimmedQuery);
      queryResult.durationMs = Date.now() - startTime;
      setResult(queryResult);
      historyItem.success = true;
      historyItem.durationMs = queryResult.durationMs;
    } catch (err) {
      historyItem.error = String(err);
      setResult({
        command: trimmedQuery.split("\n")[0],
        durationMs: Date.now() - startTime,
        error: String(err),
      });
    } finally {
      setIsExecuting(false);
      setQueryHistory((prev) => [historyItem, ...prev.slice(0, 49)]);
    }
  }, [query, onExecuteQuery, t]);

  // Execute with Ctrl+Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleExecute();
      }
    },
    [handleExecute]
  );

  // Handle schema table selection
  const handleSelectTable = useCallback(
    (tableName: string) => {
      const tableNameWithSchema =
        schema?.tables.find((t) => t.name === tableName)?.schema;
      const fullName = tableNameWithSchema
        ? `${tableNameWithSchema}.${tableName}`
        : tableName;
      setQuery((prev) => {
        if (prev.trim()) {
          return `${prev}\nSELECT * FROM ${fullName} LIMIT 100;`;
        }
        return `SELECT * FROM ${fullName} LIMIT 100;`;
      });
      onSelectTable?.(tableName);
    },
    [schema, onSelectTable]
  );

  // Copy query to clipboard
  const handleCopyQuery = useCallback(() => {
    navigator.clipboard.writeText(query);
  }, [query]);

  // Clear query
  const handleClearQuery = useCallback(() => {
    setQuery("");
    setResult(null);
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/30">
        {/* Connection info */}
        <div className="flex items-center gap-2 min-w-0">
          <Database size={14} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{config.label}</span>
          <Badge variant="outline" className="text-xs shrink-0">
            {config.driver.toUpperCase()}
          </Badge>
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onRefreshSchema}
                >
                  <RefreshCw size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("database.refreshSchema")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowSchema(!showSchema)}
                >
                  <ChevronRight
                    size={14}
                    className={cn(
                      "transition-transform",
                      showSchema && "rotate-90"
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showSchema ? t("database.hideSchema") : t("database.showSchema")}
              </TooltipContent>
            </Tooltip>

            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5 ml-2"
              onClick={onDisconnect}
            >
              <PlugZap size={14} />
              {t("database.disconnect")}
            </Button>
          </TooltipProvider>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Schema sidebar */}
          {showSchema && (
            <>
              <ResizablePanel
                defaultSize={25}
                minSize={15}
                maxSize={40}
              >
                <div className="flex flex-col h-full border-r border-border/60">
                  <div className="px-2 py-1.5 border-b border-border/60">
                    <div className="relative">
                      <Search
                        size={12}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        placeholder={t("database.searchTables")}
                        value={schemaSearch}
                        onChange={(e) => setSchemaSearch(e.target.value)}
                        className="pl-7 h-7 text-xs"
                      />
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    {schema ? (
                      <DatabaseSchemaTree
                        schema={schema}
                        searchQuery={schemaSearch}
                        onSelectTable={handleSelectTable}
                        onRefresh={onRefreshSchema}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-xs p-4">
                        <Loader2 size={16} className="animate-spin mr-2" />
                        {t("database.loadingSchema")}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          {/* Editor and results */}
          <ResizablePanel defaultSize={75}>
            <ResizablePanelGroup direction="vertical" className="h-full">
              {/* Query editor */}
              <ResizablePanel defaultSize={40} minSize={20}>
                <div className="flex flex-col h-full">
                  {/* Editor toolbar */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/20">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleCopyQuery}
                            disabled={!query}
                          >
                            <Copy size={12} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.copy")}</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleClearQuery}
                            disabled={!query && !result}
                          >
                            <X size={12} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.clear")}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <div className="flex-1" />

                    <Button
                      size="sm"
                      className="gap-1.5 h-7"
                      onClick={handleExecute}
                      disabled={isExecuting || !query.trim()}
                    >
                      {isExecuting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      {t("database.execute")}
                      <kbd className="ml-1 px-1 py-0.5 rounded bg-muted/50 text-[10px]">
                        Ctrl+Enter
                      </kbd>
                    </Button>
                  </div>

                  {/* Editor */}
                  <div className="flex-1 relative min-h-0">
                    <textarea
                      ref={editorRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t("database.queryPlaceholder")}
                      className={cn(
                        "absolute inset-0 w-full h-full resize-none p-3 font-mono text-sm",
                        "bg-transparent border-none outline-none",
                        "placeholder:text-muted-foreground/50"
                      )}
                      spellCheck={false}
                    />
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Results */}
              <ResizablePanel
                defaultSize={60}
                minSize={20}
              >
                <div className="h-full border-t border-border/60 bg-muted/10">
                  {result ? (
                    <DatabaseResultsTable
                      columns={result.columns || []}
                      rows={result.rows || []}
                      truncated={result.truncated}
                      totalRows={result.rowCount}
                      durationMs={result.durationMs}
                      error={result.error}
                      onCopy={(row, col) => {
                        const value = result.rows?.[row]?.[col];
                        navigator.clipboard.writeText(
                          value === null ? "NULL" : String(value)
                        );
                      }}
                      onExport={() => {
                        // Export to CSV
                        const headers = result.columns?.join(",") || "";
                        const rows = result.rows
                          ?.map((row) =>
                            result.columns
                              ?.map((col) => {
                                const val = row[col];
                                if (val === null) return "";
                                if (typeof val === "string" && val.includes(","))
                                  return `"${val.replace(/"/g, '""')}"`;
                                return String(val);
                              })
                              .join(",")
                          )
                          .join("\n");
                        const csv = `${headers}\n${rows}`;
                        const blob = new Blob([csv], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `query_result_${Date.now()}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <Table size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t("database.noResultsYet")}</p>
                        <p className="text-xs mt-1 opacity-70">
                          {t("database.executeQueryHint")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Status bar */}
      <DatabaseStatusBar
        driver={session.driver}
        connected={session.status.connected}
        serverVersion={session.status.serverVersion}
        activeQueries={isExecuting ? 1 : 0}
        latencyMs={currentResult as number | undefined}
      />
    </div>
  );
};

export default DatabaseSessionPanel;
