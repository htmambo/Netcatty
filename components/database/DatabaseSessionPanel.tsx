import { Copy, Database, FileText, Loader2, Play, PlugZap, RefreshCw, Search, Table, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type { DatabaseConfig, DatabaseSession, QueryResult } from "../../domain/databaseModels";
import type { DatabaseObjectSelection, DatabaseResultView } from "../../domain/databaseSchemaView";
import {
  buildDatabaseInspectorSections,
  buildPreviewQueryTemplateForSelection,
  buildQueryTemplateForSelection,
  findDatabaseTable,
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
  onLoadObjectDetails: (selection: DatabaseObjectSelection) => Promise<unknown> | void;
  onQueryTableData?: (
    selection: DatabaseObjectSelection,
    page: number,
    pageSize: number,
  ) => Promise<unknown> | void;
  onLoadSchemaDatabase?: (databaseName: string) => Promise<unknown> | void;
  onRefreshSchema: () => Promise<unknown> | void;
}

type SessionView = "data" | "structure" | "query";

const MAX_QUERY_LENGTH = 10000;
const PREVIEW_PAGE_SIZE = 100;

interface PreviewPaginationState {
  page: number;
  pageSize: number;
  totalRows?: number;
  totalRowsEstimated?: boolean;
  hasMore: boolean;
}

interface PreviewCacheEntry {
  result: DatabaseResultView;
  pagination: PreviewPaginationState;
  query: string;
}

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
  onLoadObjectDetails,
  onQueryTableData,
  onLoadSchemaDatabase,
  onRefreshSchema,
}) => {
  const { t } = useI18n();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRequestIdRef = useRef(0);
  const schemaLoadError = useMemo(() => {
    if (
      schema &&
      typeof schema === "object" &&
      "ok" in schema &&
      (schema as { ok?: boolean }).ok === false
    ) {
      return typeof (schema as { error?: string }).error === "string"
        ? (schema as { error?: string }).error
        : t("database.error");
    }
    return null;
  }, [schema, t]);
  const normalizedSchema = useMemo(
    () => normalizeDatabaseSchema(schemaLoadError ? undefined : schema),
    [schema, schemaLoadError],
  );
  const [activeView, setActiveView] = useState<SessionView>("data");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedObject, setSelectedObject] = useState<DatabaseObjectSelection | null>(null);
  const [query, setQuery] = useState("");
  const [suggestedQuery, setSuggestedQuery] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewCacheEntry>>({});
  const [previewResult, setPreviewResult] = useState<DatabaseResultView | null>(null);
  const [previewPagination, setPreviewPagination] = useState<PreviewPaginationState | null>(null);
  const [previewQueryText, setPreviewQueryText] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<DatabaseResultView | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [loadingObjectDetailsId, setLoadingObjectDetailsId] = useState<string | null>(null);
  const [objectDetailsErrors, setObjectDetailsErrors] = useState<Record<string, string>>({});
  const [loadingSchemaNames, setLoadingSchemaNames] = useState<string[]>([]);

  const inspectorSections = useMemo(
    () => buildDatabaseInspectorSections(schema, config, selectedObject),
    [config, schema, selectedObject],
  );
  const previewTemplate = useMemo(
    () =>
      buildPreviewQueryTemplateForSelection(selectedObject, schema, config.driver, {
        page: previewPage,
        pageSize: PREVIEW_PAGE_SIZE,
      }),
    [config.driver, previewPage, schema, selectedObject],
  );
  const latestLatency = queryResult?.durationMs ?? previewResult?.durationMs;
  const activeQueryCount = Number(isLoadingPreview) + Number(isExecutingQuery);
  const selectedTable = useMemo(
    () => findDatabaseTable(schema, selectedObject),
    [schema, selectedObject],
  );
  const selectedObjectCacheKey = selectedObject ? `${session.id}:${selectedObject.id}` : null;
  const selectedPreviewCacheKey = selectedObject
    ? `${session.id}:${selectedObject.id}:page:${previewPage}`
    : null;
  const isLoadingObjectDetails =
    Boolean(selectedObjectCacheKey) &&
    loadingObjectDetailsId === selectedObjectCacheKey &&
    !!selectedTable &&
    !selectedTable.columnsLoaded;
  const objectDetailsError = selectedObjectCacheKey
    ? objectDetailsErrors[selectedObjectCacheKey]
    : undefined;

  useEffect(() => {
    if (
      activeView !== "structure" ||
      !selectedObject ||
      (selectedObject.kind !== "table" && selectedObject.kind !== "view")
    ) {
      return;
    }

    const selectedTableDetails = findDatabaseTable(schema, selectedObject);
    if (selectedTableDetails?.columnsLoaded) {
      return;
    }

    const cacheKey = `${session.id}:${selectedObject.id}`;
    let cancelled = false;

    setLoadingObjectDetailsId(cacheKey);
    setObjectDetailsErrors((prev) => {
      if (!(cacheKey in prev)) return prev;
      const next = { ...prev };
      delete next[cacheKey];
      return next;
    });

    void Promise.resolve(onLoadObjectDetails(selectedObject))
      .then((result) => {
        if (cancelled) return;

        const response =
          result && typeof result === "object"
            ? (result as { ok?: boolean; error?: string })
            : null;
        if (response?.ok === false) {
          const error =
            typeof response.error === "string" ? response.error : t("database.error");
          setObjectDetailsErrors((prev) => ({
            ...prev,
            [cacheKey]: error,
          }));
          return;
        }

        setObjectDetailsErrors((prev) => {
          if (!(cacheKey in prev)) return prev;
          const next = { ...prev };
          delete next[cacheKey];
          return next;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setObjectDetailsErrors((prev) => ({
          ...prev,
          [cacheKey]: String(err),
        }));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingObjectDetailsId((current) => (current === cacheKey ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, onLoadObjectDetails, schema, selectedObject, session.id, t]);

  const normalizePreviewPagination = useCallback(
    (rawResult: unknown, page: number): PreviewPaginationState => {
      const raw =
        rawResult && typeof rawResult === "object"
          ? (rawResult as {
              page?: number;
              pageSize?: number;
              totalRows?: number;
              totalRowsEstimated?: boolean;
              hasMore?: boolean;
            })
          : {};

      const resolvedPage =
        typeof raw.page === "number" && raw.page > 0 ? raw.page : page;
      const resolvedPageSize =
        typeof raw.pageSize === "number" && raw.pageSize > 0
          ? raw.pageSize
          : PREVIEW_PAGE_SIZE;

      return {
        page: resolvedPage,
        pageSize: resolvedPageSize,
        totalRows:
          typeof raw.totalRows === "number" && raw.totalRows >= 0
            ? raw.totalRows
            : undefined,
        totalRowsEstimated: raw.totalRowsEstimated === true,
        hasMore: raw.hasMore === true,
      };
    },
    [],
  );

  const supportsPagedPreview = Boolean(
    onQueryTableData &&
    config.driver === "mysql" &&
    selectedObject &&
    (selectedObject.kind === "table" || selectedObject.kind === "view"),
  );

  const executeStatement = useCallback(
    async (
      statement: string,
      target: "preview" | "query",
      previewRequestId?: number,
    ) => {
      const trimmedQuery = statement.trim();
      const command = getCommandLabel(trimmedQuery);
      if (!trimmedQuery) return null;
      const canUpdatePreview = () =>
        previewRequestId === undefined || previewRequestIdRef.current === previewRequestId;

      if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        const tooLong = normalizeDatabaseQueryResult({
          command,
          durationMs: 0,
          error: t("database.queryTooLong"),
        });
        if (target === "preview" && canUpdatePreview()) setPreviewResult(tooLong);
        else setQueryResult(tooLong);
        return tooLong;
      }

      if (target === "preview" && canUpdatePreview()) setIsLoadingPreview(true);
      else setIsExecutingQuery(true);

      const startTime = Date.now();
      try {
        const rawResult = await onExecuteQuery(trimmedQuery);
        const normalized = normalizeDatabaseQueryResult(
          toResultInput(rawResult, command, Date.now() - startTime),
        );
        if (target === "preview" && canUpdatePreview()) setPreviewResult(normalized);
        else setQueryResult(normalized);
        return normalized;
      } catch (err) {
        const normalized = normalizeDatabaseQueryResult({
          command,
          durationMs: Date.now() - startTime,
          error: String(err),
        });
        if (target === "preview" && canUpdatePreview()) setPreviewResult(normalized);
        else setQueryResult(normalized);
        return normalized;
      } finally {
        if (target === "preview" && canUpdatePreview()) setIsLoadingPreview(false);
        else setIsExecutingQuery(false);
      }
    },
    [onExecuteQuery, t],
  );

  const loadPreviewPage = useCallback(
    (selection: DatabaseObjectSelection, page: number, forceRefresh = false) => {
      const targetPage = Math.max(1, page);
      const previewRequestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = previewRequestId;

      setPreviewPage(targetPage);

      void (async () => {
        const isPagedPreview =
          Boolean(onQueryTableData) &&
          config.driver === "mysql" &&
          (selection.kind === "table" || selection.kind === "view");

        const template = buildPreviewQueryTemplateForSelection(
          selection,
          schema,
          config.driver,
          {
            page: targetPage,
            pageSize: PREVIEW_PAGE_SIZE,
          },
        );

        if (!template) {
          setPreviewResult(null);
          setPreviewPagination(null);
          setPreviewQueryText(null);
          return;
        }

        setSuggestedQuery(template.query);
        setQuery((current) =>
          !current.trim() || current === suggestedQuery ? template.query : current,
        );

        const cacheKey = `${session.id}:${selection.id}:page:${targetPage}`;
        if (!forceRefresh) {
          const cachedPreview = previewCache[cacheKey];
          if (cachedPreview) {
            setPreviewResult(cachedPreview.result);
            setPreviewPagination(cachedPreview.pagination);
            setPreviewQueryText(cachedPreview.query);
            return;
          }
        }

        setPreviewResult(null);
        setPreviewQueryText(template.query);

        if (!isPagedPreview) {
          setPreviewPagination(null);
          const result = await executeStatement(template.query, "preview", previewRequestId);
          if (!result || previewRequestIdRef.current !== previewRequestId) {
            return;
          }

          const pagination = {
            page: targetPage,
            pageSize: PREVIEW_PAGE_SIZE,
            totalRows: result.rowCount,
            totalRowsEstimated: false,
            hasMore: false,
          } satisfies PreviewPaginationState;

          setPreviewPagination(pagination);
          setPreviewCache((prev) => ({
            ...prev,
            [cacheKey]: {
              result,
              pagination,
              query: template.query,
            },
          }));
          return;
        }

        setIsLoadingPreview(true);
        try {
          const rawResult = await onQueryTableData?.(selection, targetPage, PREVIEW_PAGE_SIZE);
          if (previewRequestIdRef.current !== previewRequestId) {
            return;
          }

          const normalized = normalizeDatabaseQueryResult(
            toResultInput(rawResult, getCommandLabel(template.query), 0),
          );
          const pagination = normalizePreviewPagination(rawResult, targetPage);
          const queryText =
            rawResult &&
            typeof rawResult === "object" &&
            "query" in rawResult &&
            typeof (rawResult as { query?: string }).query === "string"
              ? (rawResult as { query?: string }).query || template.query
              : template.query;

          setPreviewResult(normalized);
          setPreviewPagination(pagination);
          setPreviewQueryText(queryText);
          setPreviewCache((prev) => ({
            ...prev,
            [cacheKey]: {
              result: normalized,
              pagination,
              query: queryText,
            },
          }));
        } catch (err) {
          if (previewRequestIdRef.current !== previewRequestId) {
            return;
          }

          const normalized = normalizeDatabaseQueryResult({
            command: getCommandLabel(template.query),
            durationMs: 0,
            error: String(err),
          });
          setPreviewResult(normalized);
          setPreviewPagination({
            page: targetPage,
            pageSize: PREVIEW_PAGE_SIZE,
            hasMore: false,
          });
          setPreviewQueryText(template.query);
        } finally {
          if (previewRequestIdRef.current === previewRequestId) {
            setIsLoadingPreview(false);
          }
        }
      })();
    },
    [
      config.driver,
      executeStatement,
      normalizePreviewPagination,
      onQueryTableData,
      previewCache,
      schema,
      session.id,
      suggestedQuery,
    ],
  );

  const handleOpenObject = useCallback(
    (selection: DatabaseObjectSelection) => {
      setSelectedObject(selection);
      setActiveView("data");
      loadPreviewPage(selection, 1);
    },
    [loadPreviewPage],
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

  const handleExecuteQuery = useCallback(() => {
    void executeStatement(query, "query");
  }, [executeStatement, query]);

  const handleUsePreviewQuery = useCallback(() => {
    const queryText = previewQueryText || previewTemplate?.query;
    if (!queryText) return;
    setSuggestedQuery(queryText);
    setQuery(queryText);
    setActiveView("query");
    queueMicrotask(() => editorRef.current?.focus());
  }, [previewQueryText, previewTemplate]);

  const handleRefreshData = useCallback(() => {
    if (!selectedObject || !selectedPreviewCacheKey) return;
    setPreviewCache((prev) => {
      if (!(selectedPreviewCacheKey in prev)) return prev;
      const next = { ...prev };
      delete next[selectedPreviewCacheKey];
      return next;
    });
    loadPreviewPage(selectedObject, previewPage, true);
  }, [loadPreviewPage, previewPage, selectedObject, selectedPreviewCacheKey]);

  const handleChangePreviewPage = useCallback(
    (page: number) => {
      if (!selectedObject || page < 1 || isLoadingPreview) return;
      loadPreviewPage(selectedObject, page);
    },
    [isLoadingPreview, loadPreviewPage, selectedObject],
  );

  const handleLoadSchemaDatabase = useCallback(
    (databaseName: string) => {
      if (!onLoadSchemaDatabase || !databaseName) return;

      setLoadingSchemaNames((prev) =>
        prev.includes(databaseName) ? prev : [...prev, databaseName],
      );

      void Promise.resolve(onLoadSchemaDatabase(databaseName)).finally(() => {
        setLoadingSchemaNames((prev) => prev.filter((item) => item !== databaseName));
      });
    },
    [onLoadSchemaDatabase],
  );

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
    (
      result: DatabaseResultView | null,
      emptyTitle: string,
      emptyHint: string,
      options?: {
        pagination?: PreviewPaginationState | null;
        onPageChange?: (page: number) => void;
        isPageLoading?: boolean;
      },
    ) => {
      if (result?.kind === "table") {
        return (
          <DatabaseResultsTable
            columns={result.columns}
            rows={result.rows}
            truncated={result.truncated}
            totalRows={options?.pagination?.totalRows ?? result.rowCount}
            totalRowsEstimated={options?.pagination?.totalRowsEstimated}
            durationMs={result.durationMs}
            error={result.error}
            page={options?.pagination?.page}
            pageSize={options?.pagination?.pageSize}
            hasMore={options?.pagination?.hasMore}
            isPageLoading={options?.isPageLoading}
            onPageChange={options?.onPageChange}
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
  const previewDisplayQuery =
    previewQueryText?.replace(/\s+/g, " ") ||
    previewTemplate?.query.replace(/\s+/g, " ") ||
    t("database.noPreview");

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
            <div className="flex-1 h-full flex-col border-r border-border/60">
              <div className="border-b border-border/60 px-3 py-2">
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
                {schemaLoadError ? (
                  <div className="flex h-full items-center justify-center px-4">
                    <div className="max-w-xs rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
                      {schemaLoadError}
                    </div>
                  </div>
                ) : schema ? (
                  <DatabaseSchemaTree
                    schema={schema}
                    searchQuery={schemaSearch}
                    selectedObjectId={selectedObject?.id || null}
                    loadingSchemaNames={loadingSchemaNames}
                    onExpandSchema={handleLoadSchemaDatabase}
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
                      {previewDisplayQuery}
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
                  {isLoadingPreview && !previewResult ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
                      <Loader2 size={16} className="mr-2 animate-spin" />
                      {t("database.loadingPreview")}
                    </div>
                  ) : (
                    renderGridOrMessage(
                      previewResult,
                      t("database.noPreview"),
                      t("database.selectObjectHint"),
                      supportsPagedPreview
                        ? {
                            pagination: previewPagination,
                            onPageChange: handleChangePreviewPage,
                            isPageLoading: isLoadingPreview,
                          }
                        : undefined,
                    )
                  )}
                </div>
              </TabsContent>

              <TabsContent value="structure" className="mt-0 flex min-h-0 flex-1 flex-col">
                <div className="border-b border-border/60 px-3 py-2">
                  <div className="truncate text-sm font-semibold">{selectedObjectLabel}</div>
                  <div className="text-[11px] text-muted-foreground">{t("database.structure")}</div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-4 p-4">
                    {objectDetailsError && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {objectDetailsError}
                      </div>
                    )}
                    {isLoadingObjectDetails && (
                      <div className="flex items-center rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 size={14} className="mr-2 animate-spin" />
                        {t("database.loadingObjectDetails")}
                      </div>
                    )}
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
                    )) : !isLoadingObjectDetails ? (
                      <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                        {t("database.noStructure")}
                      </div>
                    ) : null}
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
