import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  AlertCircle,
  Table,
  Clock,
  Loader2,
  Rows3,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";

interface DatabaseResultsTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  totalRows?: number;
  totalRowsEstimated?: boolean;
  durationMs: number;
  error?: string;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  isPageLoading?: boolean;
  onPageChange?: (page: number) => void;
  onCopy: (row: number, col: string) => void;
  onExport: () => void;
}

type SortDirection = "asc" | "desc" | null;

const MAX_VISIBLE_ROWS = 1000;
const MAX_CELL_LENGTH = 200;
const MAX_TITLE_LENGTH = 1000;
const ROW_HEIGHT = 32;
const VIRTUALIZATION_OVERSCAN = 8;

interface IndexedRow {
  row: Record<string, unknown>;
  sourceIndex: number;
}

interface PreparedCell {
  displayValue: string;
  titleValue?: string;
  isNull: boolean;
}

interface PreparedRow {
  sourceIndex: number;
  cells: PreparedCell[];
}

const stringifyCellValue = (value: unknown): string => {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const truncateCellValue = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const DatabaseResultsTable: React.FC<DatabaseResultsTableProps> = ({
  columns,
  rows,
  truncated,
  totalRows,
  totalRowsEstimated,
  durationMs,
  error,
  page,
  pageSize,
  hasMore,
  isPageLoading,
  onPageChange,
  onCopy,
  onExport,
}) => {
  const { t } = useI18n();
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const resolvedPage = typeof page === "number" && page > 0 ? page : 1;
  const resolvedPageSize = typeof pageSize === "number" && pageSize > 0 ? pageSize : rows.length || 1;
  const rowOffset = (resolvedPage - 1) * resolvedPageSize;
  const hasPagination = Boolean(onPageChange && pageSize);
  const totalPages =
    typeof totalRows === "number" && totalRows > 0
      ? Math.max(1, Math.ceil(totalRows / resolvedPageSize))
      : undefined;
  const canGoPrevious = hasPagination && resolvedPage > 1 && !isPageLoading;
  const canGoNext =
    hasPagination &&
    !isPageLoading &&
    (hasMore === true || (hasMore === undefined && totalPages ? resolvedPage < totalPages : false));
  const rangeStart = rows.length > 0 ? rowOffset + 1 : 0;
  const rangeEnd = rowOffset + rows.length;
  const totalRowsLabel =
    typeof totalRows === "number"
      ? `${totalRowsEstimated ? "~" : ""}${totalRows}`
      : null;
  const indexedRows = useMemo<IndexedRow[]>(
    () => rows.map((row, sourceIndex) => ({ row, sourceIndex })),
    [rows],
  );

  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDirection) return indexedRows;

    return [...indexedRows].sort((a, b) => {
      const aVal = a.row[sortColumn];
      const bVal = b.row[sortColumn];

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null) return sortDirection === "asc" ? -1 : 1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = stringifyCellValue(aVal);
      const bStr = stringifyCellValue(bVal);
      return sortDirection === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [indexedRows, sortColumn, sortDirection]);

  const visibleRows = truncated
    ? sortedRows.slice(0, MAX_VISIBLE_ROWS)
    : sortedRows;

  const handleColumnClick = useCallback((column: string) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    if (sortDirection === "desc") {
      setSortColumn(null);
      setSortDirection(null);
      return;
    }

    setSortDirection("asc");
  }, [sortColumn, sortDirection]);

  const preparedRows = useMemo<PreparedRow[]>(
    () =>
      visibleRows.map(({ row, sourceIndex }) => ({
        sourceIndex,
        cells: columns.map((column) => {
          const rawValue = row[column];
          const copyValue = stringifyCellValue(rawValue);
          return {
            displayValue: truncateCellValue(copyValue, MAX_CELL_LENGTH),
            titleValue:
              copyValue.length > MAX_CELL_LENGTH
                ? truncateCellValue(copyValue, MAX_TITLE_LENGTH)
                : undefined,
            isNull: rawValue === null,
          };
        }),
      })),
    [columns, visibleRows],
  );

  useEffect(() => {
    setSelectedRow(null);
  }, [resolvedPage, rows]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const syncViewportHeight = () => {
      setViewportHeight(container.clientHeight);
    };

    syncViewportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(syncViewportHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    setScrollTop(0);
    container?.scrollTo({ top: 0 });
  }, [resolvedPage, rows, columns.length]);

  const virtualState = useMemo(() => {
    const totalCount = preparedRows.length;
    const shouldVirtualize = totalCount > 40 && viewportHeight > 0;

    if (!shouldVirtualize) {
      return {
        enabled: false,
        start: 0,
        end: totalCount - 1,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUALIZATION_OVERSCAN);
    const end = Math.min(
      totalCount - 1,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + VIRTUALIZATION_OVERSCAN,
    );

    return {
      enabled: true,
      start,
      end,
      topSpacerHeight: start * ROW_HEIGHT,
      bottomSpacerHeight: Math.max(0, (totalCount - end - 1) * ROW_HEIGHT),
    };
  }, [preparedRows.length, scrollTop, viewportHeight]);

  const renderedRows = virtualState.enabled
    ? preparedRows.slice(virtualState.start, virtualState.end + 1)
    : preparedRows;

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="flex items-center gap-2 text-destructive mb-2">
          <AlertCircle size={16} />
          <span className="font-medium">{t("database.queryError")}</span>
        </div>
        <ScrollArea className="flex-1">
          <pre className="text-sm text-destructive/80 whitespace-pre-wrap font-mono bg-destructive/5 p-3 rounded-md">
            {error}
          </pre>
        </ScrollArea>
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock size={12} />
            <span>{durationMs}ms</span>
          </div>
        </div>
      </div>
    );
  }

  const paginationFooter = hasPagination ? (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate">
          {totalRowsLabel
            ? t("database.rowRange", { start: rangeStart, end: rangeEnd, total: totalRowsLabel })
            : t("database.rowRangeUnknown", { start: rangeStart, end: rangeEnd })}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          {totalPages
            ? t("database.pageStatusWithTotal", { page: resolvedPage, total: totalPages })
            : t("database.pageStatus", { page: resolvedPage })}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => onPageChange?.(resolvedPage - 1)}
          disabled={!canGoPrevious}
        >
          <ChevronLeft size={12} />
          {t("database.previousPage")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => onPageChange?.(resolvedPage + 1)}
          disabled={!canGoNext}
        >
          {isPageLoading ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
          {t("database.nextPage")}
        </Button>
      </div>
    </div>
  ) : null;

  // Empty state
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
          <Table size={32} className="mb-2 opacity-50" />
          <p className="text-sm">{t("database.noRowsReturned")}</p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Clock size={12} />
            <span>{durationMs}ms</span>
          </div>
        </div>
        {paginationFooter}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs">
            <Rows3 size={10} className="mr-1" />
            {rows.length}
            {truncated && ` / ${totalRows || "?"}`}
          </Badge>
          {sortColumn && (
            <Badge variant="outline" className="text-xs gap-1">
              {sortDirection === "asc" ? (
                <ArrowUp size={10} />
              ) : (
                <ArrowDown size={10} />
              )}
              {sortColumn}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {t("database.doubleClickCopyCell")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onExport}
            title={t("database.exportResults")}
            aria-label={t("database.exportResults")}
          >
            <Download size={12} />
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            <span>{durationMs}ms</span>
          </div>
        </div>
      </div>

      {truncated && (
        <div className="px-3 py-1 bg-yellow-500/10 border-b border-yellow-500/30 text-xs text-yellow-600">
          {t("database.resultsTruncated", { count: MAX_VISIBLE_ROWS })}
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div className="min-w-max">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/95">
              <tr>
                <th className="w-12 border-b border-border/60 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                  #
                </th>
                {columns.map((column) => (
                  <th
                    key={column}
                    className={cn(
                      "px-3 py-1.5 text-left text-xs font-medium border-b border-border/60 cursor-pointer select-none",
                      "hover:bg-muted/50 transition-colors"
                    )}
                    onClick={() => handleColumnClick(column)}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate" title={column}>{column}</span>
                      {sortColumn === column && (
                        <span className="text-muted-foreground">
                          {sortDirection === "asc" ? (
                            <ArrowUp size={10} />
                          ) : (
                            <ArrowDown size={10} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {virtualState.topSpacerHeight > 0 && (
                <tr
                  aria-hidden="true"
                >
                  <td
                    colSpan={columns.length + 1}
                    className="border-0 p-0"
                    style={{ height: virtualState.topSpacerHeight }}
                  />
                </tr>
              )}
              {renderedRows.map((row, localIndex) => {
                const rowIndex = virtualState.enabled
                  ? virtualState.start + localIndex
                  : localIndex;
                const isSelected = selectedRow === rowIndex;

                return (
                  <tr
                    key={`${row.sourceIndex}-${rowIndex}`}
                    className={cn(
                      "h-8 transition-colors",
                      isSelected && "bg-primary/10",
                      rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20",
                    )}
                    onClick={() => setSelectedRow(rowIndex)}
                  >
                    <td className="h-8 border-b border-border/30 px-2 py-0 align-middle text-xs text-muted-foreground">
                      {rowOffset + rowIndex + 1}
                    </td>
                    {row.cells.map((cell, cellIndex) => {
                      const column = columns[cellIndex];
                      return (
                        <td
                          key={column}
                          className={cn(
                            "h-8 max-w-[300px] border-b border-border/30 px-3 py-0 align-middle text-sm",
                            cell.isNull && "text-muted-foreground italic",
                            isSelected && "bg-primary/5",
                          )}
                          onDoubleClick={() => onCopy(row.sourceIndex, column)}
                          title={cell.titleValue}
                        >
                          <span className="block truncate font-mono text-xs leading-5">
                            {cell.displayValue}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {virtualState.bottomSpacerHeight > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length + 1}
                    className="border-0 p-0"
                    style={{ height: virtualState.bottomSpacerHeight }}
                  />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {paginationFooter}
    </div>
  );
};

export default DatabaseResultsTable;
