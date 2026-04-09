import { Copy, Database, FileText, Loader2, Play, PlugZap, RefreshCw, Search, Table, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type { DatabaseConfig, DatabaseSession, QueryResult } from "../../domain/databaseModels";
import type { DatabaseObjectSelection, DatabaseResultView } from "../../domain/databaseSchemaView";
import {
  buildDatabaseInspectorSections,
  buildQueryTemplateForSelection,
  getDefaultDatabaseSelection,
  normalizeDatabaseQueryResult,
  normalizeDatabaseSchema,
} from "../../domain/databaseSchemaView";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import DatabaseResultsTable from "./DatabaseResultsTable";
import DatabaseSchemaTree from "./DatabaseSchemaTree";
import DatabaseStatusBar from "./DatabaseStatusBar";

interface DatabaseSessionPanelProps {
  session: DatabaseSession;
  config: DatabaseConfig;
  schema?: unknown;
  onDisconnect: () => void;
  onExecuteQuery: (query: string) => Promise<QueryResult>;
  onRefreshSchema: () => Promise<unknown> | void;
}

type SessionView = "data" | "structure" | "query";

const MAX_QUERY_LENGTH = 10000;

const INSPECTOR_SECTION_TITLES: Record<string, string> = {
  connection: "database.connection",
  server: "database.server",
  summary: "database.summary",
  columns: "database.columns",
};

const INSPECTOR_LABELS: Record<string, string> = {
  Name: "database.meta.name",
  Driver: "database.meta.driver",
  Target: "database.meta.target",
  Database: "database.meta.database",
  User: "database.meta.user",
  Version: "database.meta.version",
  Tables: "database.tables",
  Views: "database.views",
  Collections: "database.collections",
  Keys: "database.meta.keys",
  Type: "database.type",
  Schema: "database.meta.schema",
  Columns: "database.meta.columns",
  Rows: "database.meta.rows",
  "Sampled Keys": "database.meta.sampledKeys",
};

const getCommandLabel = (query: string): string =>
  query.trim().split(/\s+/)[0]?.toUpperCase() || "QUERY";

const toResultInput = (rawResult: unknown, fallbackCommand: string, fallbackDurationMs: number): unknown => {
  if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
    const record = rawResult as Record<string, unknown>;
    return {
      ...record,
      command: typeof record.command === "string" ? record.command : fallbackCommand,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : fallbackDurationMs,
    };
  }
  return { command: fallbackCommand, durationMs: fallbackDurationMs, result: rawResult };
};

const buildCsv = (result: DatabaseResultView): string => {
  const headers = result.columns.join(",");
  const rows = result.rows
    .map((row) =>
      result.columns
        .map((column) => {
          const value = row[column];
          if (value === null || value === undefined) return "";
          const stringValue = typeof value === "string" ? value : JSON.stringify(value);
          if (/[,"\n]/.test(stringValue)) {
            return `"${stringValue.replace(/"/g, "\"\"")}"`;
          }
          return stringValue;
        })
        .join(","),
    )
    .join("\n");
  return `${headers}\n${rows}`;
};

const DatabaseSessionPanel: React.FC<DatabaseSessionPanelProps> = ({
  session,
  config,
  schema,
  onDisconnect,
  onExecuteQuery,
  onRefreshSchema,
}) => {
  const { t } = useI18n();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const normalizedSchema = useMemo(() => normalizeDatabaseSchema(schema), [schema]);
  const [activeView, setActiveView] = useState<SessionView>("data");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedObject, setSelectedObject] = useState<DatabaseObjectSelection | null>(null);
  const [query, setQuery] = useState("");
  const [suggestedQuery, setSuggestedQuery] = useState("");
  const [previewResult, setPreviewResult] = useState<DatabaseResultView | null>(null);
  const [queryResult, setQueryResult] = useState<DatabaseResultView | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);

  const inspectorSections = useMemo(
    () => buildDatabaseInspectorSections(schema, config, selectedObject),
    [config, schema, selectedObject],
  );
  const previewTemplate = useMemo(
    () => buildQueryTemplateForSelection(selectedObject, schema, config.driver),
    [config.driver, schema, selectedObject],
  );
  const latestLatency = queryResult?.durationMs ?? previewResult?.durationMs;
  const activeQueryCount = Number(isLoadingPreview) + Number(isExecutingQuery);

  const executeStatement = useCallback(
    async (statement: string, target: "preview" | "query") => {
      const trimmedQuery = statement.trim();
      const command = getCommandLabel(trimmedQuery);
      if (!trimmedQuery) return null;

      if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        const tooLong = normalizeDatabaseQueryResult({
          command,
          durationMs: 0,
          error: t("database.queryTooLong"),
        });
        if (target === "preview") setPreviewResult(tooLong);
        else setQueryResult(tooLong);
        return tooLong;
      }

      if (target === "preview") setIsLoadingPreview(true);
      else setIsExecutingQuery(true);

      const startTime = Date.now();
      try {
        const rawResult = await onExecuteQuery(trimmedQuery);
        const normalized = normalizeDatabaseQueryResult(
          toResultInput(rawResult, command, Date.now() - startTime),
        );
        if (target === "preview") setPreviewResult(normalized);
        else setQueryResult(normalized);
        return normalized;
      } catch (err) {
        const normalized = normalizeDatabaseQueryResult({
          command,
          durationMs: Date.now() - startTime,
          error: String(err),
        });
        if (target === "preview") setPreviewResult(normalized);
        else setQueryResult(normalized);
        return normalized;
      } finally {
        if (target === "preview") setIsLoadingPreview(false);
        else setIsExecutingQuery(false);
      }
    },
    [onExecuteQuery, t],
  );

  const handleOpenObject = useCallback(
    (selection: DatabaseObjectSelection) => {
      setSelectedObject(selection);
      setActiveView("data");
      const template = buildQueryTemplateForSelection(selection, schema, config.driver);
      if (!template) {
        setPreviewResult(null);
        return;
      }
      setSuggestedQuery(template.query);
      setQuery((current) =>
        !current.trim() || current === suggestedQuery ? template.query : current,
      );
      void executeStatement(template.query, "preview");
    },
    [config.driver, executeStatement, schema, suggestedQuery],
  );

  const handleOpenQuery = useCallback(
    (selection: DatabaseObjectSelection) => {
      setSelectedObject(selection);
      setActiveView("query");
      const template = buildQueryTemplateForSelection(selection, schema, config.driver);
      if (!template) return;
      setSuggestedQuery(template.query);
      setQuery(template.query);
      queueMicrotask(() => editorRef.current?.focus());
    },
    [config.driver, schema],
  );

  useEffect(() => {
    if (!schema || selectedObject) return;
    const defaultSelection = getDefaultDatabaseSelection(schema);
    if (defaultSelection) handleOpenObject(defaultSelection);
  }, [handleOpenObject, schema, selectedObject]);

  const handleExecuteQuery = useCallback(() => {
    void executeStatement(query, "query");
  }, [executeStatement, query]);

  const handleUsePreviewQuery = useCallback(() => {
    if (!previewTemplate) return;
    setSuggestedQuery(previewTemplate.query);
    setQuery(previewTemplate.query);
    setActiveView("query");
    queueMicrotask(() => editorRef.current?.focus());
  }, [previewTemplate]);

  const handleRefreshData = useCallback(() => {
    if (!previewTemplate) return;
    void executeStatement(previewTemplate.query, "preview");
  }, [executeStatement, previewTemplate]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleExecuteQuery();
      }
    },
    [handleExecuteQuery],
  );

  const handleExportResult = useCallback((result: DatabaseResultView | null) => {
    if (!result || result.kind !== "table" || result.columns.length === 0) return;
    const blob = new Blob([buildCsv(result)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `query_result_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const createCopyHandler = useCallback(
    (result: DatabaseResultView | null) => (rowIndex: number, column: string) => {
      const value = result?.rows[rowIndex]?.[column];
      navigator.clipboard.writeText(value === null ? "NULL" : String(value ?? ""));
    },
    [],
  );

  const renderMessagePane = useCallback(
    (result: DatabaseResultView | null, emptyTitle: string, emptyHint: string) => {
      if (!result) {
        return (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Table size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">{emptyTitle}</p>
              <p className="mt-1 text-xs opacity-70">{emptyHint}</p>
            </div>
          </div>
        );
      }

      return (
        <ScrollArea className="h-full">
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Badge variant={result.error ? "destructive" : "outline"}>
                {result.error ? t("database.error") : t("database.message")}
              </Badge>
              {result.type && <Badge variant="secondary">{result.type}</Badge>}
              <span className="text-xs text-muted-foreground">{result.durationMs}ms</span>
            </div>
            {result.message && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  result.error
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-border/60 bg-muted/20",
                )}
              >
                {result.message}
              </div>
            )}
            {result.rawText && result.rawText !== result.message && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {t("database.rawResult")}
                </div>
                <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background p-3 text-xs leading-5">
                  {result.rawText}
                </pre>
              </div>
            )}
          </div>
        </ScrollArea>
      );
    },
    [t],
  );

  const renderGridOrMessage = useCallback(
    (result: DatabaseResultView | null, emptyTitle: string, emptyHint: string) => {
      if (result?.kind === "table") {
        return (
          <DatabaseResultsTable
            columns={result.columns}
            rows={result.rows}
            truncated={result.truncated}
            totalRows={result.rowCount}
            durationMs={result.durationMs}
            error={result.error}
            onCopy={createCopyHandler(result)}
            onExport={() => handleExportResult(result)}
          />
        );
      }
      return renderMessagePane(result, emptyTitle, emptyHint);
    },
    [createCopyHandler, handleExportResult, renderMessagePane],
  );

  const selectedObjectLabel = selectedObject?.schemaName
    ? `${selectedObject.schemaName}.${selectedObject.name || selectedObject.label}`
    : selectedObject?.label || config.label;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-muted-foreground" />
            <span className="truncate text-sm font-semibold">{config.label}</span>
            <Badge variant="outline" className="text-[10px]">{config.driver.toUpperCase()}</Badge>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {selectedObjectLabel}
          </div>
        </div>

        <div className="flex-1" />

        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as SessionView)}>
          <TabsList className="h-8">
            <TabsTrigger value="data" className="px-3 py-1 text-xs">{t("database.data")}</TabsTrigger>
            <TabsTrigger value="structure" className="px-3 py-1 text-xs">{t("database.structure")}</TabsTrigger>
            <TabsTrigger value="query" className="px-3 py-1 text-xs">{t("database.query")}</TabsTrigger>
          </TabsList>
        </Tabs>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void onRefreshSchema()}>
                <RefreshCw size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("database.refreshSchema")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="destructive" size="sm" className="ml-2 gap-1.5" onClick={onDisconnect}>
                <PlugZap size={14} />
                {t("database.disconnect")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("database.disconnect")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={22} minSize={16} maxSize={34}>
            <div className="flex h-full flex-col border-r border-border/60">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Search size={12} />
                  <span>{t("database.objectExplorer")}</span>
                </div>
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={schemaSearch}
                    onChange={(event) => setSchemaSearch(event.target.value)}
                    placeholder={t("database.filterObjects")}
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              </div>

              <ScrollArea className="flex-1">
                {schema ? (
                  <DatabaseSchemaTree
                    schema={schema}
                    searchQuery={schemaSearch}
                    selectedObjectId={selectedObject?.id || null}
                    onOpenObject={handleOpenObject}
                    onOpenQuery={handleOpenQuery}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    {t("database.loadingSchema")}
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={78}>
            <Tabs value={activeView} onValueChange={(value) => setActiveView(value as SessionView)} className="flex h-full flex-col">
              <TabsContent value="data" className="mt-0 flex min-h-0 flex-1 flex-col">
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{selectedObjectLabel}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {previewTemplate?.query.replace(/\s+/g, " ") || t("database.noPreview")}
                    </div>
                  </div>
                  <div className="flex-1" />
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={handleUsePreviewQuery} disabled={!previewTemplate}>
                    <FileText size={14} />
                    {t("database.openInQuery")}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefreshData} disabled={!previewTemplate || isLoadingPreview}>
                    {isLoadingPreview ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {t("database.refreshData")}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 bg-muted/10">
                  {renderGridOrMessage(previewResult, t("database.noPreview"), t("database.selectObjectHint"))}
                </div>
              </TabsContent>

              <TabsContent value="structure" className="mt-0 flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border/60 px-3 py-2">
                  <div className="truncate text-sm font-semibold">{selectedObjectLabel}</div>
                  <div className="text-[11px] text-muted-foreground">{t("database.structure")}</div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-4 p-4">
                    {inspectorSections.length > 0 ? inspectorSections.map((section) => (
                      <div key={section.id} className="rounded-lg border border-border/60 bg-muted/10">
                        <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {t(INSPECTOR_SECTION_TITLES[section.title] || section.title)}
                        </div>
                        {section.rows && section.rows.length > 0 && (
                          <div className="divide-y divide-border/40">
                            {section.rows.map((row) => (
                              <div key={`${section.id}-${row.label}`} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
                                <span className="text-muted-foreground">{t(INSPECTOR_LABELS[row.label] || row.label)}</span>
                                <span className="truncate">{row.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {section.columns && section.columns.length > 0 && (
                          <div className="divide-y divide-border/40">
                            {section.columns.map((column) => (
                              <div key={`${section.id}-${column.name}`} className="grid grid-cols-[minmax(0,1fr)_140px_90px_120px] gap-3 px-3 py-2 text-sm">
                                <span className="truncate font-medium">{column.name}</span>
                                <span className="truncate text-muted-foreground">{column.dataType}</span>
                                <span className="text-muted-foreground">{column.primaryKey ? "PK" : column.nullable ? "NULL" : "NOT NULL"}</span>
                                <span className="truncate text-muted-foreground">{column.defaultValue ?? "-"}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )) : (
                      <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                        {t("database.noStructure")}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="query" className="mt-0 flex min-h-0 flex-1 flex-col">
                <ResizablePanelGroup direction="vertical" className="h-full">
                  <ResizablePanel defaultSize={42} minSize={20}>
                    <div className="flex h-full flex-col">
                      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigator.clipboard.writeText(query)} disabled={!query}>
                          <Copy size={12} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setQuery(""); setQueryResult(null); }} disabled={!query && !queryResult}>
                          <X size={12} />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={handleUsePreviewQuery} disabled={!previewTemplate}>
                          <FileText size={12} />
                          {t("database.usePreviewQuery")}
                        </Button>
                        <div className="flex-1" />
                        <Button size="sm" className="h-7 gap-1.5" onClick={handleExecuteQuery} disabled={isExecutingQuery || !query.trim()}>
                          {isExecutingQuery ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                          {t("database.execute")}
                        </Button>
                      </div>
                      <div className="relative min-h-0 flex-1">
                        <textarea
                          ref={editorRef}
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder={t("database.queryPlaceholder")}
                          className={cn(
                            "absolute inset-0 h-full w-full resize-none bg-transparent p-3 font-mono text-sm outline-none",
                            "placeholder:text-muted-foreground/60",
                          )}
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel defaultSize={58} minSize={18}>
                    <div className="h-full border-t border-border/60 bg-muted/10">
                      {renderGridOrMessage(queryResult, t("database.noResultsYet"), t("database.executeQueryHint"))}
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <DatabaseStatusBar
        driver={session.driver}
        connected={session.status.connected}
        serverVersion={normalizedSchema.serverVersion || session.status.serverVersion}
        activeQueries={activeQueryCount}
        latencyMs={latestLatency}
      />
    </div>
  );
};

export default DatabaseSessionPanel;
