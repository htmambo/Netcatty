import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  AlertCircle,
  Table,
  Clock,
  Rows3,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Badge } from "../ui/badge";

interface DatabaseResultsTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  totalRows?: number;
  durationMs: number;
  error?: string;
  onCopy: (row: number, col: string) => void;
  onExport: () => void;
}

type SortDirection = "asc" | "desc" | null;

const MAX_VISIBLE_ROWS = 1000;
const MAX_CELL_LENGTH = 200;

const DatabaseResultsTable: React.FC<DatabaseResultsTableProps> = ({
  columns,
  rows,
  truncated,
  totalRows,
  durationMs,
  error,
  onCopy,
  onExport,
}) => {
  const { t } = useI18n();
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDirection) return rows;

    return [...rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      // Handle nulls
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null) return sortDirection === "asc" ? -1 : 1;

      // Compare values
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDirection === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [rows, sortColumn, sortDirection]);

  // Visible rows (with truncation)
  const visibleRows = truncated
    ? sortedRows.slice(0, MAX_VISIBLE_ROWS)
    : sortedRows;

  // Handle column click for sorting
  const handleColumnClick = useCallback((column: string) => {
    setSortColumn((prev) => {
      if (prev === column) {
        setSortDirection((currentDir) => {
          if (currentDir === "asc") return "desc";
          if (currentDir === "desc") return null;
          return "asc";
        });
        // Get current direction for the return value
        return sortDirection === "asc" ? column : null;
      }
      setSortDirection("asc");
      return column;
    });
  }, [sortDirection]);

  // Format cell value for display
  const formatCellValue = useCallback((value: unknown): string => {
    if (value === null) return "NULL";
    if (value === undefined) return "";
    if (typeof value === "object") {
      const str = JSON.stringify(value);
      return str.length > MAX_CELL_LENGTH ? str.slice(0, MAX_CELL_LENGTH) + "..." : str;
    }
    const str = String(value);
    return str.length > MAX_CELL_LENGTH ? str.slice(0, MAX_CELL_LENGTH) + "..." : str;
  }, []);

  // Error state
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

  // Empty state
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <Table size={32} className="mb-2 opacity-50" />
        <p className="text-sm">{t("database.noRowsReturned")}</p>
        <div className="flex items-center gap-2 mt-2 text-xs">
          <Clock size={12} />
          <span>{durationMs}ms</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onExport}
                >
                  <Download size={12} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("database.exportResults")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            <span>{durationMs}ms</span>
          </div>
        </div>
      </div>

      {/* Truncation warning */}
      {truncated && (
        <div className="px-3 py-1 bg-yellow-500/10 border-b border-yellow-500/30 text-xs text-yellow-600">
          {t("database.resultsTruncated", { count: MAX_VISIBLE_ROWS })}
        </div>
      )}

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="min-w-max">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground border-b border-border/60 w-10">
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
                      <span className="truncate">{column}</span>
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
              {visibleRows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    "group transition-colors",
                    selectedRow === rowIndex && "bg-primary/10",
                    rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20"
                  )}
                  onClick={() => setSelectedRow(rowIndex)}
                >
                  <td className="px-2 py-1 text-xs text-muted-foreground border-b border-border/30">
                    {rowIndex + 1}
                  </td>
                  {columns.map((column) => {
                    const value = row[column];
                    const isNull = value === null;
                    const isSelected =
                      selectedRow === rowIndex;

                    return (
                      <td
                        key={column}
                        className={cn(
                          "px-3 py-1 text-sm border-b border-border/30 max-w-[300px]",
                          isNull && "text-muted-foreground italic",
                          isSelected && "bg-primary/5"
                        )}
                      >
                        <div className="flex items-center gap-1 group-hover:opacity-100 opacity-80 transition-opacity">
                          <span className="truncate font-mono text-xs">
                            {formatCellValue(value)}
                          </span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="p-0.5 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCopy(rowIndex, column);
                                  }}
                                >
                                  <Copy size={10} className="text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isNull ? "NULL" : t("common.copy")}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
};

export default DatabaseResultsTable;
