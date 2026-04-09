import {
  ChevronRight,
  Copy,
  Database,
  FileText,
  Hash,
  Server,
  Table,
  Wrench,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type {
  DatabaseExplorerNode,
  DatabaseObjectSelection,
} from "../../domain/databaseSchemaView";
import {
  buildDatabaseExplorerSections,
  buildQueryTemplateForSelection,
  normalizeDatabaseSchema,
} from "../../domain/databaseSchemaView";
import { cn } from "../../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";

interface DatabaseSchemaTreeProps {
  schema: unknown;
  searchQuery?: string;
  selectedObjectId?: string | null;
  onOpenObject: (selection: DatabaseObjectSelection) => void;
  onOpenQuery: (selection: DatabaseObjectSelection) => void;
}

const getNodeIcon = (kind: DatabaseExplorerNode["kind"]): React.ReactNode => {
  switch (kind) {
    case "schema":
      return <Server size={12} className="text-muted-foreground" />;
    case "table":
      return <Table size={12} className="text-[#44779F]" />;
    case "view":
      return <FileText size={12} className="text-sky-500" />;
    case "collection":
      return <Database size={12} className="text-[#47A248]" />;
    case "redis-type":
      return <Hash size={12} className="text-[#DC382D]" />;
    case "extension":
      return <Wrench size={12} className="text-amber-500" />;
    default:
      return <Database size={12} className="text-muted-foreground" />;
  }
};

const buildSelectionFromNode = (
  node: DatabaseExplorerNode,
): DatabaseObjectSelection | null => {
  if (node.kind === "overview" || node.kind === "schema" || node.kind === "extension") {
    return null;
  }

  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    name: node.name,
    schemaName: node.schemaName,
  };
};

const DatabaseSchemaTree: React.FC<DatabaseSchemaTreeProps> = ({
  schema,
  searchQuery = "",
  selectedObjectId,
  onOpenObject,
  onOpenQuery,
}) => {
  const { t } = useI18n();
  const normalizedSchema = useMemo(() => normalizeDatabaseSchema(schema), [schema]);
  const explorerSections = useMemo(
    () => buildDatabaseExplorerSections(schema, searchQuery),
    [schema, searchQuery],
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedIds((prev) => {
      if (prev.size > 0) return prev;

      const next = new Set<string>();
      explorerSections.forEach((section) => {
        next.add(section.id);
        section.items.forEach((item) => {
          if (item.kind === "schema") {
            next.add(item.id);
          }
        });
      });
      return next;
    });
  }, [explorerSections]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const copyPreviewQuery = useCallback(
    (selection: DatabaseObjectSelection) => {
      const template = buildQueryTemplateForSelection(
        selection,
        schema,
        normalizedSchema.driver,
      );
      if (!template) return;
      navigator.clipboard.writeText(template.query);
    },
    [normalizedSchema.driver, schema],
  );

  const renderNode = useCallback(
    (node: DatabaseExplorerNode, depth = 0): React.ReactNode => {
      const selection = buildSelectionFromNode(node);
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const isExpanded = expandedIds.has(node.id);
      const paddingLeft = 10 + depth * 16;
      const template = selection
        ? buildQueryTemplateForSelection(selection, schema, normalizedSchema.driver)
        : null;

      if (hasChildren) {
        return (
          <Collapsible
            key={node.id}
            open={isExpanded}
            onOpenChange={() => toggleExpanded(node.id)}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                style={{ paddingLeft: `${paddingLeft}px` }}
              >
                <ChevronRight
                  size={12}
                  className={cn("shrink-0 transition-transform", isExpanded && "rotate-90")}
                />
                {getNodeIcon(node.kind)}
                <span className="truncate">
                  {node.label === "default" ? t("database.defaultSchema") : node.label}
                </span>
                {typeof node.count === "number" && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/80">
                    {node.count}
                  </span>
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5 py-0.5">
                {node.children?.map((child) => renderNode(child, depth + 1))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      }

      return (
        <ContextMenu key={node.id}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60",
                selectedObjectId === node.id
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              style={{ paddingLeft: `${paddingLeft + 16}px` }}
              onClick={() => {
                if (selection) {
                  onOpenObject(selection);
                }
              }}
            >
              {getNodeIcon(node.kind)}
              <span className="truncate">{node.label}</span>
              {node.secondary && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/80">
                  {node.secondary}
                </span>
              )}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {selection && (
              <ContextMenuItem onClick={() => onOpenObject(selection)}>
                <Table size={12} className="mr-2" />
                {t("database.previewData")}
              </ContextMenuItem>
            )}
            {selection && (
              <ContextMenuItem onClick={() => onOpenQuery(selection)}>
                <FileText size={12} className="mr-2" />
                {t("database.openInQuery")}
              </ContextMenuItem>
            )}
            {selection && template && (
              <ContextMenuItem onClick={() => copyPreviewQuery(selection)}>
                <Copy size={12} className="mr-2" />
                {t("database.copyPreviewQuery")}
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onClick={() => navigator.clipboard.writeText(node.name || node.label)}
            >
              <Copy size={12} className="mr-2" />
              {t("database.copyObjectName")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    },
    [
      copyPreviewQuery,
      expandedIds,
      normalizedSchema.driver,
      onOpenObject,
      onOpenQuery,
      schema,
      selectedObjectId,
      t,
      toggleExpanded,
    ],
  );

  return (
    <div className="space-y-3 px-2 py-2">
      <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Database size={13} className="text-muted-foreground" />
          <span>{normalizedSchema.driver.toUpperCase()}</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {normalizedSchema.serverVersion}
        </div>
      </div>

      {explorerSections.length > 0 ? (
        <div className="space-y-2">
          {explorerSections.map((section) => (
            <div key={section.id} className="space-y-1">
              <div className="flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span>{t(`database.${section.label}`)}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 normal-case tracking-normal text-[10px]">
                  {section.count}
                </span>
              </div>
              <div className="space-y-0.5">{section.items.map((item) => renderNode(item))}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {searchQuery.trim()
            ? t("database.noObjectsFound")
            : t("database.noObjectsAvailable")}
        </div>
      )}
    </div>
  );
};

export default DatabaseSchemaTree;
