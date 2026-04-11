import React from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type { DatabaseDriver, EditCellRequest } from "../../domain/databaseModels";
import { buildUpdateStatement } from "../../domain/databaseSchemaView";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface DatabaseEditDialogProps {
  request: EditCellRequest;
  driver: DatabaseDriver;
  tableName: string;
  schemaName?: string;
  columnName: string;
  onConfirm: (sql: string) => void;
  onCancel: () => void;
}

const formatValue = (value: unknown): string => {
  if (value === null) return "NULL";
  if (value === undefined) return "(empty)";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const DatabaseEditDialog: React.FC<DatabaseEditDialogProps> = ({
  request,
  driver,
  tableName,
  schemaName,
  columnName,
  onConfirm,
  onCancel,
}) => {
  const { t } = useI18n();

  const sql = buildUpdateStatement(
    tableName,
    schemaName,
    request.primaryKeyColumn,
    request.primaryKeyValue,
    { [columnName]: request.newValue },
    driver,
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("database.edit.confirmTitle", "Confirm Cell Update")}</DialogTitle>
          <DialogDescription>
            {t("database.edit.confirmMessage", "Review the change before applying it to the database.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Table & Column info */}
          <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <span className="text-muted-foreground text-xs">{t("database.edit.table", "Table")}</span>
            <span className="font-mono text-xs">{schemaName ? `${schemaName}.${tableName}` : tableName}</span>
            <span className="text-muted-foreground text-xs">{t("database.edit.column", "Column")}</span>
            <span className="font-mono text-xs">{columnName}</span>
            <span className="text-muted-foreground text-xs">{t("database.edit.primaryKey", "PK")}</span>
            <span className="font-mono text-xs">{request.primaryKeyColumn} = {formatValue(request.primaryKeyValue)}</span>
          </div>

          {/* Value change */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground mb-2">{t("database.edit.valueChange", "Value Change")}</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{t("database.edit.oldValue", "OLD")}</div>
                <div className={cn(
                  "font-mono text-xs px-2 py-1 rounded border truncate",
                  request.oldValue === null
                    ? "border-destructive/30 bg-destructive/5 text-muted-foreground italic"
                    : "border-border/60 bg-background text-foreground",
                )}>
                  {formatValue(request.oldValue)}
                </div>
              </div>
              <div className="text-muted-foreground text-lg shrink-0">→</div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{t("database.edit.newValue", "NEW")}</div>
                <div className={cn(
                  "font-mono text-xs px-2 py-1 rounded border truncate",
                  request.newValue === null
                    ? "border-destructive/30 bg-destructive/5 text-muted-foreground italic"
                    : "border-primary/30 bg-primary/5 text-primary",
                )}>
                  {formatValue(request.newValue)}
                </div>
              </div>
            </div>
          </div>

          {/* SQL preview */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground mb-1.5">{t("database.edit.sqlPreview", "SQL")}</div>
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
              {sql}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("database.edit.cancel", "Cancel")}
          </Button>
          <Button onClick={() => onConfirm(sql)}>
            {t("database.edit.update", "Update")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DatabaseEditDialog;
