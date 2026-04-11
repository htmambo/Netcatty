import { Copy, Database, FileText, Loader2, Play, PlugZap, RefreshCw, Search, Table, X } from "lucide-react";
import { toast } from "../ui/toast";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type {
  DatabaseConfig,
  DatabaseDriver,
  DatabaseSession,
  EditCellRequest,
  FilterState,
  QueryResult,
  TableInfo,
} from "../../domain/databaseModels";
import type { DatabaseObjectSelection, DatabaseResultView } from "../../domain/databaseSchemaView";
import {
  buildDatabaseInspectorSections,
  buildPreviewQueryTemplateForSelection,
  buildQueryTemplateForSelection,
  buildWhereClause,
  findDatabaseTable,
  normalizeDatabaseQueryResult,
  normalizeDatabaseSchema,
} from "../../domain/databaseSchemaView";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import DatabaseEditDialog from "./DatabaseEditDialog";
import DatabaseFilterBuilder from "./DatabaseFilterBuilder";
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
    sort?: { column: string; direction: "asc" | "desc" } | null,
    whereClause?: string | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<unknown> | void;
  onLoadSchemaDatabase?: (databaseName: string) => Promise<unknown> | void;
  onRefreshSchema: () => Promise<unknown> | void;
}

type SessionView = "data" | "structure" | "query";

const MAX_QUERY_LENGTH = 10000;
const PREVIEW_PAGE_SIZE = 500;

interface PreviewPaginationState {
  page: number;
  pageSize: number;
  totalRows?: number;
  totalRowsEstimated?: boolean;
  hasMore: boolean;
}

// --- Tab state ---

interface PreviewTabState {
  id: string;
  selection: DatabaseObjectSelection;
  page: number;
  pageSize: number;
  sort: { column: string; direction: "asc" | "desc" } | null;
  filter: FilterState;
  result: DatabaseResultView | null;
  pagination: PreviewPaginationState | null;
  query: string | null;
  isLoading: boolean;
  error?: string;
}

// --- Helper functions ---

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

// --- Default filter state ---
const newGroupId = () => `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const emptyFilterState = (): FilterState => ({
  rootGroup: { id: newGroupId(), logicOperator: "AND", children: [] },
});

// --- Create a new tab ---
const createTab = (selection: DatabaseObjectSelection): PreviewTabState => ({
  id: selection.id,
  selection,
  page: 1,
  pageSize: PREVIEW_PAGE_SIZE,
  sort: null,
  filter: emptyFilterState(),
  result: null,
  pagination: null,
  query: null,
  isLoading: false,
});

// --- Main component ---
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

  // Tab state (declared early so openTabsRef can reference openTabs)
  const [openTabs, setOpenTabs] = useState<PreviewTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Ref to avoid stale closure in async loadTabPreview
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  // Derived: active tab (must be before structureObject)
  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.id === activeTabId) ?? null,
    [openTabs, activeTabId],
  );

  // Structure tab: which object to show
  const [explicitStructureObject, setExplicitStructureObject] = useState<DatabaseObjectSelection | null>(null);

  // Derived structure object: prefer explicit selection, fall back to active tab
  const structureObject = explicitStructureObject ?? activeTab?.selection ?? null;

  // Query tab
  const [query, setQuery] = useState("");
  const [suggestedQuery, setSuggestedQuery] = useState("");
  const [queryResult, setQueryResult] = useState<DatabaseResultView | null>(null);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);

  // Object details loading
  const [loadingObjectDetailsId, setLoadingObjectDetailsId] = useState<string | null>(null);
  const [objectDetailsErrors, setObjectDetailsErrors] = useState<Record<string, string>>({});
  const [loadingSchemaNames, setLoadingSchemaNames] = useState<string[]>([]);

  // Edit dialog
  const [editDialogRequest, setEditDialogRequest] = useState<EditCellRequest | null>(null);

  const inspectorSections = useMemo(
    () => buildDatabaseInspectorSections(schema, config, structureObject),
    [config, schema, structureObject],
  );

  // --- Object details loading effect ---
  useEffect(() => {
    if (
      activeView !== "structure" ||
      !structureObject ||
      (structureObject.kind !== "table" && structureObject.kind !== "view")
    ) {
      return;
    }

    const table = findDatabaseTable(schema, structureObject);
    if (table?.columnsLoaded) {
      return;
    }

    const cacheKey = `${session.id}:${structureObject.id}`;
    let cancelled = false;

    setLoadingObjectDetailsId(cacheKey);
    setObjectDetailsErrors((prev) => {
      if (!(cacheKey in prev)) return prev;
      const next = { ...prev };
      delete next[cacheKey];
      return next;
    });

    void Promise.resolve(onLoadObjectDetails(structureObject))
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
  }, [activeView, onLoadObjectDetails, schema, structureObject, session.id, t]);

  // --- Object details loading for data tab (columns, primary key, etc.) ---
  useEffect(() => {
    if (activeView !== "data" || !activeTab) return;
    if (activeTab.selection.kind !== "table" && activeTab.selection.kind !== "view") return;

    const table = findDatabaseTable(schema, activeTab.selection);
    if (table?.columnsLoaded) return;

    const cacheKey = `${session.id}:${activeTab.selection.id}`;
    let cancelled = false;

    void Promise.resolve(onLoadObjectDetails(activeTab.selection))
      .then((result) => {
        if (cancelled) return;
        // Result is used internally by VaultView's loadDatabaseObjectDetails to update schema
      })
      .catch(() => {
        // Errors handled by VaultView
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, activeTab, onLoadObjectDetails, schema, session.id]);

  // --- Pagination normalization ---
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

  // --- Load preview for a tab (tabId used only for state updates, filter passed directly to avoid stale closure) ---
  const loadTabPreview = useCallback(
    (tabId: string, page: number, _forceRefresh: boolean, selection: DatabaseObjectSelection, filter?: FilterState) => {
      const targetPage = Math.max(1, page);
      const previewRequestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = previewRequestId;

      // Update loading state on the tab (keep old result to avoid blank flash)
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, page: targetPage, isLoading: true }
            : t,
        ),
      );

      const doLoad = async () => {
        // Use ref to avoid stale closure in async function (except filter, passed directly)
        const currentTab = openTabsRef.current.find((t) => t.id === tabId);
        if (!currentTab) return;
        const effectiveFilter = filter ?? currentTab.filter;

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
            pageSize: currentTab.pageSize,
          },
        );

        if (!template) {
          setOpenTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? { ...t, isLoading: false, pagination: null, query: null }
                : t,
            ),
          );
          return;
        }

        const whereClause = buildWhereClause(effectiveFilter, config.driver);
        let queryText = template.query;

        // Inject WHERE clause before LIMIT
        if (whereClause) {
          queryText = template.query.replace(
            /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?/i,
            `WHERE ${whereClause} $&`,
          );
          // If no LIMIT, append before semicolon
          if (!queryText.includes("WHERE")) {
            queryText = queryText.replace(/;?\s*$/, ` WHERE ${whereClause};`);
          }
        }

        setOpenTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, query: queryText } : t)),
        );
        setSuggestedQuery((current) =>
          !current.trim() ? queryText : current,
        );

        if (!isPagedPreview) {
          setOpenTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, pagination: null } : t)),
          );
          const rawResult = await onExecuteQuery(queryText);
          if (previewRequestIdRef.current !== previewRequestId) return;

          const normalized = normalizeDatabaseQueryResult(
            toResultInput(rawResult, getCommandLabel(queryText), rawResult.durationMs ?? 0),
          );

          const pagination: PreviewPaginationState = {
            page: targetPage,
            pageSize: currentTab.pageSize,
            totalRows: normalized.rowCount,
            totalRowsEstimated: false,
            hasMore: false,
          };

          setOpenTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? { ...t, isLoading: false, result: normalized, pagination }
                : t,
            ),
          );
          return;
        }

        try {
          const sortPayload = currentTab.sort
            ? { column: currentTab.sort.column, direction: currentTab.sort.direction }
            : null;
          const rawResult = await onQueryTableData?.(
            selection,
            targetPage,
            currentTab.pageSize,
            sortPayload,
            whereClause,
          );
          if (previewRequestIdRef.current !== previewRequestId) return;

          const normalized = normalizeDatabaseQueryResult(
            toResultInput(rawResult, getCommandLabel(queryText), 0),
          );
          const pagination = normalizePreviewPagination(rawResult, targetPage);
          const resultQuery =
            rawResult &&
            typeof rawResult === "object" &&
            "query" in rawResult &&
            typeof (rawResult as { query?: string }).query === "string"
              ? (rawResult as { query?: string }).query || queryText
              : queryText;

          setOpenTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    isLoading: false,
                    result: normalized,
                    pagination,
                    query: resultQuery,
                  }
                : t,
            ),
          );
        } catch (err) {
          if (previewRequestIdRef.current !== previewRequestId) return;

          const normalized = normalizeDatabaseQueryResult({
            command: getCommandLabel(queryText),
            durationMs: 0,
            error: String(err),
          });
          setOpenTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    isLoading: false,
                    result: normalized,
                    pagination: {
                      page: targetPage,
                      pageSize: currentTab.pageSize,
                      hasMore: false,
                    },
                  }
                : t,
            ),
          );
        }
      };

      void setTimeout(() => void doLoad(), 0);
    },
    [config.driver, normalizePreviewPagination, onExecuteQuery, onQueryTableData, openTabs, schema],
  );

  // --- Execute statement (for query tab) ---
  const executeStatement = useCallback(
    async (statement: string) => {
      const trimmedQuery = statement.trim();
      const command = getCommandLabel(trimmedQuery);
      if (!trimmedQuery) return null;

      if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        setQueryResult(
          normalizeDatabaseQueryResult({
            command,
            durationMs: 0,
            error: t("database.queryTooLong"),
          }),
        );
        return null;
      }

      setIsExecutingQuery(true);
      const startTime = Date.now();
      try {
        const rawResult = await onExecuteQuery(trimmedQuery);
        const normalized = normalizeDatabaseQueryResult(
          toResultInput(rawResult, command, Date.now() - startTime),
        );
        setQueryResult(normalized);
        return normalized;
      } catch (err) {
        const normalized = normalizeDatabaseQueryResult({
          command,
          durationMs: Date.now() - startTime,
          error: String(err),
        });
        setQueryResult(normalized);
        return normalized;
      } finally {
        setIsExecutingQuery(false);
      }
    },
    [onExecuteQuery, t],
  );

  // --- Open object (creates or switches tab) ---
  const handleOpenObject = useCallback(
    (selection: DatabaseObjectSelection) => {
      setActiveView("data");

      // Check if tab already open
      const existingTab = openTabs.find((tab) => tab.id === selection.id);
      if (existingTab) {
        setActiveTabId(selection.id);
        return;
      }

      // Create new tab
      const newTab = createTab(selection);
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      loadTabPreview(newTab.id, 1, false, selection);
    },
    [openTabs, loadTabPreview],
  );

  // --- Close tab ---
  const handleCloseTab = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);

        // If closing active tab, switch to adjacent
        if (activeTabId === tabId) {
          if (next.length === 0) {
            setActiveTabId(null);
          } else if (idx > 0) {
            setActiveTabId(next[idx - 1].id);
          } else {
            setActiveTabId(next[0].id);
          }
        }
        return next;
      });
    },
    [activeTabId],
  );

  const handleCloseOtherTabs = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => prev.filter((t) => t.id === tabId));
      setActiveTabId(tabId);
    },
    [],
  );

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTabId(null);
  }, []);

  // --- Filter change on a tab (draft only, no data reload) ---
  const handleFilterChange = useCallback(
    (tabId: string, filter: FilterState) => {
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, filter, page: 1 } : t,
        ),
      );
    },
    [],
  );

  // --- Apply filter and reload data ---
  const applyFilter = useCallback(
    (tabId: string, filter: FilterState) => {
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, filter } : t,
        ),
      );
      loadTabPreview(tabId, 1, true, openTabsRef.current.find((t) => t.id === tabId)?.selection, filter);
    },
    [loadTabPreview],
  );

  // --- Page change ---
  const handlePageChange = useCallback(
    (tabId: string, page: number) => {
      if (page < 1) return;
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, page } : t)),
      );
      loadTabPreview(tabId, page, false, openTabsRef.current.find((t) => t.id === tabId)?.selection);
    },
    [loadTabPreview],
  );

  // --- Page size change ---
  const handlePageSizeChange = useCallback(
    (tabId: string, pageSize: number) => {
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, pageSize, page: 1 } : t)),
      );
      loadTabPreview(tabId, 1, true, openTabsRef.current.find((t) => t.id === tabId)?.selection);
    },
    [loadTabPreview],
  );

  // --- Sort change ---
  const handleSortChange = useCallback(
    (tabId: string, column: string) => {
      setOpenTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          let nextSort: { column: string; direction: "asc" | "desc" } | null;
          if (t.sort?.column !== column) {
            nextSort = { column, direction: "asc" };
          } else if (t.sort.direction === "asc") {
            nextSort = { column, direction: "desc" };
          } else {
            nextSort = null;
          }
          return { ...t, sort: nextSort };
        }),
      );
      loadTabPreview(tabId, 1, true, openTabsRef.current.find((t) => t.id === tabId)?.selection);
    },
    [loadTabPreview],
  );

  // --- Refresh tab ---
  const handleRefreshTab = useCallback(
    (tabId: string) => {
      const tab = openTabs.find((t) => t.id === tabId);
      if (!tab) return;
      loadTabPreview(tabId, tab.page, true, tab.selection);
    },
    [loadTabPreview],
  );

  // --- Structure view: show selected object's details ---
  // (The structure tab auto-shows the active tab's selection.
  // For future: add right-click "Open in Structure" in SchemaTree.)

  // --- Load schema database ---
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

  // --- Open query for selection ---
  const handleOpenQuery = useCallback(
    (selection: DatabaseObjectSelection) => {
      setActiveView("query");
      const template = buildQueryTemplateForSelection(selection, schema, config.driver);
      if (!template) return;
      setSuggestedQuery(template.query);
      setQuery(template.query);
      queueMicrotask(() => editorRef.current?.focus());
    },
    [config.driver, schema],
  );

  // --- Execute query ---
  const handleExecuteQuery = useCallback(() => {
    void executeStatement(query);
  }, [executeStatement, query]);

  // --- Use preview query ---
  const handleUsePreviewQuery = useCallback(() => {
    const queryText = activeTab?.query;
    if (!queryText) return;
    setSuggestedQuery(queryText);
    setQuery(queryText);
    setActiveView("query");
    queueMicrotask(() => editorRef.current?.focus());
  }, [activeTab]);

  // --- Export ---
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

  // --- Copy cell ---
  const createCopyHandler = useCallback(
    (result: DatabaseResultView | null) => (rowIndex: number, column: string) => {
      if (!result || result.kind !== "table") return;
      const value = result.rows[rowIndex]?.[column];
      const text = value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);
      void navigator.clipboard.writeText(text);
    },
    [],
  );

  // --- Cell edit ---
  const handleCellEdit = useCallback(
    (request: EditCellRequest) => {
      setEditDialogRequest(request);
    },
    [],
  );

  // --- Execute UPDATE ---
  const handleExecuteUpdate = useCallback(
    async (sql: string, tabId: string) => {
      const result = await executeStatement(sql);
      setEditDialogRequest(null);
      if (result && !result.error) {
        toast.success(t("database.edit.updateSuccess", "Cell updated successfully"));
        // Refresh the tab
        loadTabPreview(tabId, 1, true, openTabsRef.current.find((t) => t.id === tabId)?.selection);
      } else {
        toast.error(result?.error ?? t("database.edit.updateFailed", "Update failed"));
      }
    },
    [executeStatement, loadTabPreview, t],
  );

  // --- Keyboard shortcut ---
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleExecuteQuery();
      }
    },
    [handleExecuteQuery],
  );

  // --- Render message pane ---
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
          </div>
        </ScrollArea>
      );
    },
    [t],
  );

  // --- Render grid or message for a tab ---
  const renderTabContent = useCallback(
    (tab: PreviewTabState, tableInfo: TableInfo | null) => {
      if (tab.isLoading && !tab.result) {
        return (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={16} className="mr-2 animate-spin" />
            {t("database.loadingPreview")}
          </div>
        );
      }

      if (tab.result?.kind === "table") {
        return (
          <DatabaseResultsTable
            columns={tab.result.columns}
            rows={tab.result.rows}
            truncated={tab.result.truncated}
            totalRows={tab.pagination?.totalRows ?? tab.result.rowCount}
            totalRowsEstimated={tab.pagination?.totalRowsEstimated}
            durationMs={tab.result.durationMs}
            error={tab.result.error}
            page={tab.pagination?.page}
            pageSize={tab.pagination?.pageSize}
            hasMore={tab.pagination?.hasMore}
            isPageLoading={tab.isLoading}
            onPageChange={(page) => handlePageChange(tab.id, page)}
            onPageSizeChange={(pageSize) => handlePageSizeChange(tab.id, pageSize)}
            sortColumn={tab.sort?.column ?? null}
            sortDirection={tab.sort?.direction ?? null}
            onSortChange={(column) => handleSortChange(tab.id, column)}
            onCopy={createCopyHandler(tab.result)}
            onExport={() => handleExportResult(tab.result)}
            tableInfo={tableInfo ?? undefined}
            onCellEdit={tableInfo ? handleCellEdit : undefined}
          />
        );
      }

      return renderMessagePane(
        tab.result,
        t("database.noPreview"),
        t("database.selectObjectHint"),
      );
    },
    [t, handlePageChange, handleSortChange, createCopyHandler, handleExportResult, handleCellEdit, renderMessagePane],
  );

  // --- Selected table info for active tab ---
  const activeTableInfo = useMemo(
    () => (activeTab ? findDatabaseTable(schema, activeTab.selection) : null),
    [schema, activeTab],
  );

  // --- Columns for filter builder (fall back to result columns when schema columns not loaded) ---
  const filterColumns = useMemo<import("../../domain/databaseModels").ColumnInfo[]>(() => {
    if (!activeTab) return [];

    // Use schema columns if loaded, otherwise build from result columns
    if (activeTableInfo?.columnsLoaded && activeTableInfo.columns.length > 0) {
      return activeTableInfo.columns;
    }

    // Fall back: build minimal ColumnInfo from result columns
    if (activeTab.result?.kind === "table" && activeTab.result.columns.length > 0) {
      return activeTab.result.columns.map((name) => ({
        name,
        dataType: "varchar",
        nullable: true,
        primaryKey: false,
      }));
    }

    return [];
  }, [activeTab, activeTableInfo]);

  // Latest latency
  const latestLatency = queryResult?.durationMs ?? activeTab?.result?.durationMs;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-muted-foreground" />
            <span className="truncate text-sm font-semibold">{config.label}</span>
            <Badge variant="outline" className="text-[10px]">{config.driver.toUpperCase()}</Badge>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {activeTab?.selection.schemaName
              ? `${activeTab.selection.schemaName}.${activeTab.selection.name || activeTab.selection.label}`
              : activeTab?.selection.label || config.label}
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
        <div className="flex h-full">
          {/* Left sidebar */}
          <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-border/60">
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
              <div className="min-w-[220px]">
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
                    selectedObjectId={activeTab?.selection.id ?? null}
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
              </div>
              <ScrollBar orientation="vertical" />
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>

          {/* Right content area */}
          <div className="min-w-0 flex-1">
            <Tabs value={activeView} onValueChange={(value) => setActiveView(value as SessionView)} className="flex h-full w-full flex-col">
              {/* --- DATA TAB --- */}
              <TabsContent value="data" className="mt-0 flex min-h-0 w-full flex-1 flex-col">
                {/* Tab bar */}
                {openTabs.length > 0 && (
                  <div className="flex items-center gap-1 border-b border-border/60 bg-muted/10 px-3 py-1.5 overflow-x-auto">
                    {openTabs.map((tab) => {
                      const isActive = tab.id === activeTabId;
                      const label = tab.selection.schemaName
                        ? `${tab.selection.schemaName}.${tab.selection.name || tab.selection.label}`
                        : tab.selection.label;
                      return (
                        <ContextMenu key={tab.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              className={cn(
                                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer transition-colors shrink-0",
                                isActive
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50",
                              )}
                              onClick={() => setActiveTabId(tab.id)}
                            >
                              <Table size={10} />
                              <span className="max-w-[120px] truncate">{label}</span>
                              <button
                                className="ml-0.5 rounded hover:bg-muted/80 p-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCloseTab(tab.id);
                                }}
                              >
                                <X size={10} />
                              </button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onSelect={() => handleCloseTab(tab.id)}>
                              {t("database.tabs.closeCurrent", "Close")}
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => handleCloseOtherTabs(tab.id)}>
                              {t("database.tabs.closeOthers", "Close Others")}
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => handleCloseAllTabs()}>
                              {t("database.tabs.closeAll", "Close All")}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                  </div>
                )}

                {activeTab ? (
                  <>
                    {/* Tab header */}
                    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {activeTab.selection.schemaName
                            ? `${activeTab.selection.schemaName}.${activeTab.selection.name || activeTab.selection.label}`
                            : activeTab.selection.label}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {activeTab.query?.replace(/\s+/g, " ") || t("database.noPreview")}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleUsePreviewQuery}
                        disabled={!activeTab.query}
                      >
                        <FileText size={14} />
                        {t("database.openInQuery")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => handleRefreshTab(activeTab.id)}
                        disabled={activeTab.isLoading}
                      >
                        {activeTab.isLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        {t("database.refreshData")}
                      </Button>
                    </div>

                    {/* Filter builder */}
                    {filterColumns.length > 0 && (
                      <DatabaseFilterBuilder
                        columns={filterColumns}
                        filter={activeTab.filter}
                        onChange={(filter) => handleFilterChange(activeTab.id, filter)}
                        onApply={(filter) => applyFilter(activeTab.id, filter)}
                        driver={config.driver}
                      />
                    )}

                    {/* Results */}
                    <div className="min-h-0 flex-1 bg-muted/10">
                      {renderTabContent(activeTab, activeTableInfo)}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Table size={32} className="mx-auto mb-2 opacity-40" />
                      <p className="text-sm">{t("database.noPreview")}</p>
                      <p className="mt-1 text-xs opacity-70">{t("database.selectObjectHint")}</p>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* --- STRUCTURE TAB --- */}
              <TabsContent value="structure" className="mt-0 flex min-h-0 w-full flex-1 flex-col">
                <div className="border-b border-border/60 px-3 py-2">
                  <div className="truncate text-sm font-semibold">
                    {structureObject
                      ? structureObject.schemaName
                        ? `${structureObject.schemaName}.${structureObject.name || structureObject.label}`
                        : structureObject.label
                      : t("database.selectObjectHint")}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{t("database.structure")}</div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-4 p-4">
                    {structureObject ? (
                      <>
                        {objectDetailsErrors[`${session.id}:${structureObject.id}`] && (
                          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            {objectDetailsErrors[`${session.id}:${structureObject.id}`]}
                          </div>
                        )}
                        {inspectorSections.map((section) => (
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
                        ))}
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                        {t("database.noStructure")}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* --- QUERY TAB --- */}
              <TabsContent value="query" className="mt-0 flex min-h-0 flex-1 flex-col">
                <ResizablePanelGroup direction="vertical" className="h-full w-full">
                  <ResizablePanel defaultSize={42} minSize={20}>
                    <div className="flex h-full flex-col">
                      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => navigator.clipboard.writeText(query)}
                          disabled={!query}
                        >
                          <Copy size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => { setQuery(""); setQueryResult(null); }}
                          disabled={!query && !queryResult}
                        >
                          <X size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs"
                          onClick={handleUsePreviewQuery}
                          disabled={!activeTab?.query}
                        >
                          <FileText size={12} />
                          {t("database.usePreviewQuery")}
                        </Button>
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          className="h-7 gap-1.5"
                          onClick={handleExecuteQuery}
                          disabled={isExecutingQuery || !query.trim()}
                        >
                          {isExecutingQuery ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Play size={12} />
                          )}
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
                      {queryResult?.kind === "table" ? (
                        <DatabaseResultsTable
                          columns={queryResult.columns}
                          rows={queryResult.rows}
                          truncated={queryResult.truncated}
                          totalRows={queryResult.rowCount}
                          durationMs={queryResult.durationMs}
                          error={queryResult.error}
                          onCopy={createCopyHandler(queryResult)}
                          onExport={() => handleExportResult(queryResult)}
                        />
                      ) : (
                        renderMessagePane(
                          queryResult,
                          t("database.noResultsYet"),
                          t("database.executeQueryHint"),
                        )
                      )}
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <DatabaseStatusBar
        driver={session.driver}
        connected={session.status.connected}
        serverVersion={normalizedSchema.serverVersion || session.status.serverVersion}
        activeQueries={Number(activeTab?.isLoading) + Number(isExecutingQuery)}
        latencyMs={latestLatency}
      />

      {/* Edit dialog */}
      {editDialogRequest && (
        <DatabaseEditDialog
          request={editDialogRequest}
          driver={config.driver}
          tableName={activeTableInfo?.name ?? ""}
          schemaName={activeTableInfo?.schema}
          columnName={editDialogRequest.column}
          onConfirm={(sql) => handleExecuteUpdate(sql, activeTabId!)}
          onCancel={() => setEditDialogRequest(null)}
        />
      )}
    </div>
  );
};

export default DatabaseSessionPanel;
