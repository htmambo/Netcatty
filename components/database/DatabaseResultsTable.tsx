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
  Copy,
  Clipboard,
  Edit3,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type { EditCellRequest, TableInfo } from "../../domain/databaseModels";
import { detectColumnInputType } from "../../domain/databaseSchemaView";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

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
  onPageSizeChange?: (pageSize: number) => void;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc" | null;
  onSortChange?: (column: string) => void;
  onCopy: (row: number, col: string) => void;
  onExport: () => void;
  tableInfo?: TableInfo;
  onCellEdit?: (request: EditCellRequest) => void;
}

type SortDirection = "asc" | "desc" | null;

const MAX_VISIBLE_ROWS = 1000;
const PAGE_SIZE_OPTIONS = [30, 50, 100, 200, 300, 500, 1000];
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

// Get native browser text selection (for "copy selection" context menu)
const getNativeSelection = (): string => {
  const selection = window.getSelection();
  return selection?.toString().trim() ?? "";
};

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
  onPageSizeChange,
  sortColumn: propSortColumn,
  sortDirection: propSortDirection,
  onSortChange,
  onCopy,
  onExport,
  tableInfo,
  onCellEdit,
}) => {
  const { t } = useI18n();
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [editDraft, setEditDraft] = useState<unknown>(null);
  const [textareaDialog, setTextareaDialog] = useState<{ rowIndex: number; column: string } | null>(null);
  const [textareaDraft, setTextareaDraft] = useState<string>("");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sortColumn = propSortColumn ?? null;
  const sortDirection = propSortDirection ?? null;

  // Primary key columns
  const pkColumns = useMemo(
    () => new Set(tableInfo?.columns.filter((c) => c.primaryKey).map((c) => c.name) ?? []),
    [tableInfo],
  );

  // Column type map
  const columnTypeMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof detectColumnInputType>>();
    tableInfo?.columns.forEach((col) => {
      map.set(col.name, detectColumnInputType(col, "mysql"));
    });
    return map;
  }, [tableInfo]);

  const canEdit = Boolean(onCellEdit && tableInfo && pkColumns.size > 0);

  // Get selected column name
  const selectedColumn = selectedCell ? columns[selectedCell.colIndex] : null;
  const selectedRow = selectedCell ? selectedCell.rowIndex : null;
  const isSelectedEditable = selectedColumn
    ? canEdit && !pkColumns.has(selectedColumn)
    : false;
  const selectedInputType = selectedColumn ? columnTypeMap.get(selectedColumn) : null;
  const isSelectedTextarea = selectedInputType === "text";

  // Check if a cell is in editing mode
  const isCellEditing = (rowIdx: number, colIdx: number) =>
    editingCell?.rowIndex === rowIdx && editingCell?.column === columns[colIdx];

  // Start editing a cell (non-text, in-cell)
  const startEditing = useCallback(
    (rowIndex: number, column: string) => {
      if (!canEdit || pkColumns.has(column)) return;
      setEditingCell({ rowIndex, column });
      const currentValue = rows[rowIndex]?.[column];
      setEditDraft(currentValue);
    },
    [canEdit, pkColumns, rows],
  );

  // Start textarea editing (opens modal)
  const startTextareaEdit = useCallback(
    (rowIndex: number, column: string) => {
      if (!canEdit || pkColumns.has(column)) return;
      setTextareaDialog({ rowIndex, column });
      setTextareaDraft(stringifyCellValue(rows[rowIndex]?.[column]));
    },
    [canEdit, pkColumns, rows],
  );

  // Commit textarea edit
  const commitTextareaEdit = useCallback(() => {
    if (!textareaDialog || !onCellEdit || !tableInfo) return;
    const pkCol = tableInfo.columns.find((c) => c.primaryKey);
    if (!pkCol) return;
    const row = rows[textareaDialog.rowIndex];
    const oldValue = row[textareaDialog.column];
    const newValue = textareaDraft;
    // Skip if no actual change
    if (String(oldValue ?? "") === String(newValue ?? "")) {
      setTextareaDialog(null);
      setTextareaDraft("");
      return;
    }
    onCellEdit({
      rowIndex: textareaDialog.rowIndex,
      column: textareaDialog.column,
      oldValue,
      newValue,
      primaryKeyColumn: pkCol.name,
      primaryKeyValue: row[pkCol.name],
    });
    setTextareaDialog(null);
    setTextareaDraft("");
  }, [textareaDialog, textareaDraft, onCellEdit, tableInfo, rows]);

  // Commit the edit
  const commitEdit = useCallback(() => {
    if (!editingCell || !onCellEdit || !tableInfo) return;
    const pkCol = tableInfo.columns.find((c) => c.primaryKey);
    if (!pkCol) return;

    const row = rows[editingCell.rowIndex];
    const pkValue = row[pkCol.name];
    const oldValue = row[editingCell.column];
    // Skip if no actual change
    if (String(oldValue ?? "") === String(editDraft ?? "")) {
      setEditingCell(null);
      setEditDraft(null);
      return;
    }

    onCellEdit({
      rowIndex: editingCell.rowIndex,
      column: editingCell.column,
      oldValue,
      newValue: editDraft,
      primaryKeyColumn: pkCol.name,
      primaryKeyValue: pkValue,
    });

    setEditingCell(null);
    setEditDraft(null);
  }, [editingCell, editDraft, onCellEdit, rows, tableInfo]);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditDraft(null);
  }, []);

  // Cancel textarea edit
  const cancelTextareaEdit = useCallback(() => {
    setTextareaDialog(null);
    setTextareaDraft("");
  }, []);

  // Keyboard handler for editing
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit],
  );

  // Table-level keyboard navigation
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Don't intercept if editing
      if (editingCell || textareaDialog) return;

      const totalRows_ = rows.length;
      const totalCols = columns.length;
      if (totalRows_ === 0 || totalCols === 0) return;

      let { rowIndex, colIndex } = selectedCell ?? { rowIndex: 0, colIndex: 0 };

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          rowIndex = Math.max(0, rowIndex - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          rowIndex = Math.min(totalRows_ - 1, rowIndex + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          colIndex = Math.max(0, colIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          colIndex = Math.min(totalCols - 1, colIndex + 1);
          break;
        case "Enter":
        case "F2":
          e.preventDefault();
          if (selectedCell) {
            const col = columns[selectedCell.colIndex];
            const inputType = columnTypeMap.get(col);
            if (inputType === "longtext") {
              startTextareaEdit(selectedCell.rowIndex, col);
            } else {
              startEditing(selectedCell.rowIndex, col);
            }
          }
          return;
        case "Escape":
          e.preventDefault();
          setSelectedCell(null);
          return;
        default:
          return;
      }

      setSelectedCell({ rowIndex, colIndex });

      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        // Only scroll vertically for up/down keys
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          const HEADER_HEIGHT = 36;
          const rowEl = container.querySelector(`tr[data-visible-index="${rowIndex}"]`);
          if (rowEl) {
            rowEl.scrollIntoView({ block: "nearest", inline: "nearest" });
            const rect = rowEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (rect.top < containerRect.top + HEADER_HEIGHT) {
              container.scrollTop -= (containerRect.top + HEADER_HEIGHT - rect.top) + 2;
            }
          }
        }

        // Only scroll horizontally for left/right keys
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const rowEl = container.querySelector(`tr[data-visible-index="${rowIndex}"]`);
          if (rowEl) {
            const cells = rowEl.querySelectorAll("td");
            const cell = cells[colIndex];
            if (cell) {
              const cellRect = cell.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const cellLeft = cellRect.left - containerRect.left + container.scrollLeft;
              const cellRight = cellLeft + cellRect.width;
              const viewWidth = container.clientWidth;
              if (cellRight > container.scrollLeft + viewWidth) {
                // Cell is too far right — scroll so cell left edge is at container left
                container.scrollLeft = cellLeft - 8;
              } else if (cellLeft < container.scrollLeft) {
                container.scrollLeft = cellLeft - 8;
              }
            }
          }
        }
      });
    },
    [selectedCell, rows.length, columns, columnTypeMap, editingCell, textareaDialog, startEditing, startTextareaEdit, scrollContainerRef],
  );
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

  const sortedRows = indexedRows;

  const visibleRows = truncated
    ? sortedRows.slice(0, MAX_VISIBLE_ROWS)
    : sortedRows;

  const handleColumnClick = useCallback((column: string) => {
    if (!onSortChange) return;
    onSortChange(column);
  }, [onSortChange]);

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
    setSelectedCell(null);
  }, [resolvedPage, rows]);

  // Reset editing state when data changes
  useEffect(() => {
    setEditingCell(null);
    setEditDraft(null);
  }, [rows, columns.length]);

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
          {onPageSizeChange ? (
            <Select
              value={String(resolvedPageSize)}
              onValueChange={(val) => onPageSizeChange(Number(val))}
            >
              <SelectTrigger className="h-5 text-[11px] py-0 px-1.5 gap-1 border-primary/30 bg-primary/5 hover:bg-primary/10">
                <Rows3 size={10} />
                <SelectValue />
                {truncated && <span className="text-[10px] text-muted-foreground">/ {totalRows || "?"}</span>}
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} {t("database.pageSizeLabel", "page")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary" className="text-xs">
              <Rows3 size={10} className="mr-1" />
              {rows.length}
              {truncated && ` / ${totalRows || "?"}`}
            </Badge>
          )}
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
            {t("database.cellNavigationHint", "←↑↓→ 导航 · 双击/Enter 编辑 · 右键复制")}
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
        className="flex-1 overflow-auto focus:outline-none"
        onScroll={handleScroll}
        onKeyDown={handleTableKeyDown}
        tabIndex={0}
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
                <tr aria-hidden="true">
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
                const isRowSelected = selectedCell?.rowIndex === rowIndex;

                return (
                  <tr
                    key={`${row.sourceIndex}-${rowIndex}`}
                    data-visible-index={rowIndex}
                    className={cn(
                      "h-8 transition-colors",
                      isRowSelected && "bg-primary/10",
                      rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20",
                    )}
                  >
                    <td className="h-8 border-b border-border/30 px-2 py-0 align-middle text-xs text-muted-foreground">
                      {rowOffset + rowIndex + 1}
                    </td>
                    {row.cells.map((cell, cellIndex) => {
                      const column = columns[cellIndex];
                      const isPK = pkColumns.has(column);
                      const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.column === column;
                      const inputType = columnTypeMap.get(column);
                      const isEditable = canEdit && !isPK;
                      const isCellSelected = selectedCell?.rowIndex === rowIndex && selectedCell?.colIndex === cellIndex;
                      const cellValue = rows[rowIndex]?.[column];

                      // Build enum options if needed
                      let enumOptions: string[] | null = null;
                      if (inputType === "enum") {
                        const col = tableInfo?.columns.find((c) => c.name === column);
                        const match = col?.dataType.match(/^enum\s*\(\s*(.+)\s*\)/i);
                        if (match) {
                          enumOptions = match[1].split(",").map((o) => o.trim().replace(/^'|'$/g, ""));
                        }
                      }

                      return (
                        <ContextMenu key={column}>
                          <ContextMenuTrigger asChild>
                            <td
                              className={cn(
                                "h-8 max-w-[300px] border-b border-border/30 px-2 py-0 align-middle text-sm relative",
                                "transition-colors outline-none",
                                cell.isNull && "text-muted-foreground italic",
                                isCellSelected && "ring-1 ring-primary ring-inset bg-primary/5",
                                !isEditing && "cursor-cell",
                              )}
                              onClick={() => setSelectedCell({ rowIndex, colIndex: cellIndex })}
                              onDoubleClick={() => {
                                if (!isEditable) return;
                                if (inputType === "longtext") {
                                  startTextareaEdit(rowIndex, column);
                                } else {
                                  startEditing(rowIndex, column);
                                }
                              }}
                              title={cell.titleValue}
                            >
                              {isEditing ? (
                                inputType === "boolean" ? (
                                  <Switch
                                    checked={Boolean(editDraft)}
                                    onCheckedChange={(val) => {
                                      setEditDraft(val);
                                      setTimeout(() => {
                                        const pkCol = tableInfo?.columns.find((c) => c.primaryKey);
                                        if (!pkCol || !onCellEdit) return;
                                        const r = rows[rowIndex];
                                        onCellEdit({
                                          rowIndex,
                                          column,
                                          oldValue: r[column],
                                          newValue: val,
                                          primaryKeyColumn: pkCol.name,
                                          primaryKeyValue: r[pkCol.name],
                                        });
                                      }, 0);
                                    }}
                                    className="h-5 w-8 data-[state=checked]:bg-primary"
                                  />
                                ) : inputType === "enum" && enumOptions ? (
                                  <select
                                    className="absolute inset-0 w-full h-full bg-background/95 border border-primary/50 text-xs font-mono px-2 py-0 outline-none"
                                    value={String(editDraft ?? "")}
                                    autoFocus
                                    onChange={(e) => setEditDraft(e.target.value)}
                                    onBlur={() => commitEdit()}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } }}
                                  >
                                    {enumOptions.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={inputType === "number" ? "number" : inputType === "decimal" ? "number" : inputType === "date" ? "date" : inputType === "datetime" ? "datetime-local" : "text"}
                                    step={inputType === "decimal" ? "any" : inputType === "number" ? "1" : undefined}
                                    className="absolute inset-0 w-full h-full bg-background/95 border border-primary/50 text-xs font-mono px-2 py-0 outline-none"
                                    value={editDraft ?? ""}
                                    autoFocus
                                    onChange={(e) => setEditDraft(e.target.value)}
                                    onBlur={() => commitEdit()}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } }}
                                  />
                                )
                              ) : (
                                <span className={cn(
                                  "block truncate font-mono text-xs leading-5",
                                )}>
                                  {cell.displayValue}
                                </span>
                              )}
                            </td>
                          </ContextMenuTrigger>
                          <ContextMenuContent onContextMenu={() => {
                            // Clear any native text selection so it doesn't interfere
                            window.getSelection()?.removeAllRanges();
                          }}>
                            <ContextMenuItem
                              onClick={() => onCopy(row.sourceIndex, column)}
                            >
                              <Copy size={12} className="mr-2" />
                              {t("database.copyCell")}
                            </ContextMenuItem>
                            {isEditable && (
                              <ContextMenuItem
                                onClick={() => {
                                  if (inputType === "longtext") {
                                    startTextareaEdit(rowIndex, column);
                                  } else {
                                    startEditing(rowIndex, column);
                                  }
                                }}
                              >
                                <Edit3 size={12} className="mr-2" />
                                {t("database.editCell")}
                              </ContextMenuItem>
                            )}
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onClick={() => {
                                const sel = window.getSelection();
                                if (sel?.toString().trim()) {
                                  navigator.clipboard.writeText(sel.toString());
                                }
                              }}
                            >
                              <Clipboard size={12} className="mr-2" />
                              {t("database.copySelection")}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
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

      {/* Textarea edit dialog for TEXT columns */}
      {textareaDialog && (
        <Dialog
          open
          onOpenChange={(open) => !open && cancelTextareaEdit()}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {t("database.editTextarea.title", "编辑文本内容")}
              </DialogTitle>
              <DialogDescription>
                {columns[columns.findIndex((c) => c === textareaDialog.column)]}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              className="min-h-[300px] font-mono text-sm"
              value={textareaDraft}
              onChange={(e) => setTextareaDraft(e.target.value)}
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={cancelTextareaEdit}>
                {t("database.edit.cancel", "取消")}
              </Button>
              <Button onClick={commitTextareaEdit}>
                {t("database.edit.update", "更新")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default DatabaseResultsTable;
