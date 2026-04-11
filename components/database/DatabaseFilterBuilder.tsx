import { ChevronDown, ChevronRight, Filter, Play, Plus, X } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import type {
  ColumnInfo,
  DatabaseDriver,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  FilterState,
} from "../../domain/databaseModels";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface DatabaseFilterBuilderProps {
  columns: ColumnInfo[];
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  onApply: (filter: FilterState) => void;
  driver: DatabaseDriver;
}

const OPERATORS: { value: FilterOperator; labelKey: string; group: string; needsValue: boolean }[] = [
  { value: "=", labelKey: "database.filter.op.equals", group: "comparison", needsValue: true },
  { value: "!=", labelKey: "database.filter.op.notEquals", group: "comparison", needsValue: true },
  { value: "<", labelKey: "database.filter.op.lessThan", group: "comparison", needsValue: true },
  { value: ">", labelKey: "database.filter.op.greaterThan", group: "comparison", needsValue: true },
  { value: "<=", labelKey: "database.filter.op.lessOrEqual", group: "comparison", needsValue: true },
  { value: ">=", labelKey: "database.filter.op.greaterOrEqual", group: "comparison", needsValue: true },
  { value: "LIKE", labelKey: "database.filter.op.contains", group: "text", needsValue: true },
  { value: "NOT LIKE", labelKey: "database.filter.op.notContains", group: "text", needsValue: true },
  { value: "IN", labelKey: "database.filter.op.inList", group: "set", needsValue: true },
  { value: "NOT IN", labelKey: "database.filter.op.notInList", group: "set", needsValue: true },
  { value: "IS NULL", labelKey: "database.filter.op.isNull", group: "null", needsValue: false },
  { value: "IS NOT NULL", labelKey: "database.filter.op.isNotNull", group: "null", needsValue: false },
  { value: "BETWEEN", labelKey: "database.filter.op.between", group: "range", needsValue: true },
];

const OPERATOR_GROUPS = [
  { key: "comparison", labelKey: "database.filter.opGroup.comparison" },
  { key: "text", labelKey: "database.filter.opGroup.text" },
  { key: "set", labelKey: "database.filter.opGroup.set" },
  { key: "null", labelKey: "database.filter.opGroup.null" },
  { key: "range", labelKey: "database.filter.opGroup.range" },
];

// --- Helpers ---

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const newCondition = (columns: ColumnInfo[]): FilterCondition => ({
  id: `c-${newId()}`,
  column: columns[0]?.name ?? "",
  operator: "=",
  value: null,
  enabled: true,
});

const newGroup = (columns: ColumnInfo[]): FilterGroup => ({
  id: `g-${newId()}`,
  logicOperator: "AND",
  children: [newCondition(columns)],
});

// --- Recursive child renderer ---

interface ChildItemProps {
  child: FilterCondition | FilterGroup;
  index: number;
  siblings: (FilterCondition | FilterGroup)[];
  columns: ColumnInfo[];
  onUpdate: (id: string, updated: FilterCondition | FilterGroup) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onAddCondition: (afterId: string) => void;
  onAddGroup: (afterId: string) => void;
  onChangeLogic: (id: string, op: "AND" | "OR") => void;
}

const ChildItem: React.FC<ChildItemProps> = ({
  child,
  index,
  siblings,
  columns,
  onUpdate,
  onRemove,
  onToggle,
  onAddCondition,
  onAddGroup,
  onChangeLogic,
}) => {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  // Show AND/OR toggle between siblings (before each child except the first)
  const showLogicToggle = index > 0;
  const prevChild = siblings[index - 1];
  // The logic operator is stored on the PREVIOUS sibling
  const logicOperator = prevChild?.logicOperator ?? "AND";

  if ("column" in child) {
    // --- FilterCondition ---
    const condition = child as FilterCondition;
    const needsValue = OPERATORS.find((o) => o.value === condition.operator)?.needsValue ?? true;
    const isEnum = columns.find((c) => c.name === condition.column)?.dataType.toLowerCase().startsWith("enum");

    return (
      <>
        {showLogicToggle && (
          <Select
            value={logicOperator}
            onValueChange={(val) => onChangeLogic(prevChild.id, val as "AND" | "OR")}
          >
            <SelectTrigger className="h-5 w-12 text-[10px] py-0 px-1 border-none bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">{t("database.filter.and", "AND")}</SelectItem>
              <SelectItem value="OR">{t("database.filter.or", "OR")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div
          className={cn(
            "flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
            condition.enabled && condition.column
              ? "border-primary/30 bg-primary/5"
              : "border-border/40 bg-muted/30 opacity-60",
          )}
        >
          {/* Toggle */}
          <button
            className={cn(
              "w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0",
              condition.enabled ? "bg-primary border-primary" : "bg-transparent border-muted-foreground/40",
            )}
            onClick={() => onToggle(condition.id)}
            title={condition.enabled ? "Disable" : "Enable"}
          >
            {condition.enabled && <span className="text-[8px] text-primary-foreground">&#10003;</span>}
          </button>

          {/* Column select */}
          <select
            className="bg-transparent text-xs border-none outline-none cursor-pointer max-w-[100px] truncate"
            value={condition.column}
            onChange={(e) => onUpdate(condition.id, { ...condition, column: e.target.value })}
          >
            <option value="">{t("database.filter.column", "Column")}</option>
            {columns.map((col) => (
              <option key={col.name} value={col.name}>{col.name}</option>
            ))}
          </select>

          {/* Operator select */}
          <select
            className="bg-transparent text-xs border-none outline-none cursor-pointer max-w-[110px] truncate"
            value={condition.operator}
            onChange={(e) =>
              onUpdate(condition.id, {
                ...condition,
                operator: e.target.value as FilterOperator,
                value: needsValue ? condition.value : null,
              })
            }
          >
            {OPERATOR_GROUPS.map((group) => (
              <optgroup key={group.key} label={t(group.labelKey)}>
                {OPERATORS.filter((o) => o.group === group.key).map((op) => (
                  <option key={op.value} value={op.value}>{t(op.labelKey)}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Value input */}
          {needsValue && condition.column && (
            isEnum ? (
              <select
                className="bg-transparent text-xs border-none outline-none cursor-pointer max-w-[100px] truncate"
                value={String(condition.value ?? "")}
                onChange={(e) => onUpdate(condition.id, { ...condition, value: e.target.value })}
              >
                <option value="">—</option>
                {(() => {
                  const colType = columns.find((c) => c.name === condition.column)?.dataType ?? "";
                  const match = colType.match(/^enum\s*\(\s*(.+)\s*\)/i);
                  if (match) {
                    const opts = match[1].split(",").map((o) => o.trim().replace(/^'|'$/g, ""));
                    return opts.map((opt) => <option key={opt} value={opt}>{opt}</option>);
                  }
                  return null;
                })()}
              </select>
            ) : condition.operator === "BETWEEN" ? (
              <div className="flex items-center gap-0.5">
                <Input
                  className="h-5 w-20 text-xs py-0 px-1.5"
                  placeholder="min"
                  value={Array.isArray(condition.value) ? condition.value[0] ?? "" : ""}
                  onChange={(e) =>
                    onUpdate(condition.id, {
                      ...condition,
                      value: [e.target.value, Array.isArray(condition.value) ? condition.value[1] ?? "" : ""],
                    })
                  }
                />
                <span className="text-[10px] text-muted-foreground">—</span>
                <Input
                  className="h-5 w-20 text-xs py-0 px-1.5"
                  placeholder="max"
                  value={Array.isArray(condition.value) ? condition.value[1] ?? "" : ""}
                  onChange={(e) =>
                    onUpdate(condition.id, {
                      ...condition,
                      value: [Array.isArray(condition.value) ? condition.value[0] ?? "" : "", e.target.value],
                    })
                  }
                />
              </div>
            ) : condition.operator === "IN" || condition.operator === "NOT IN" ? (
              <Input
                className="h-5 w-32 text-xs py-0 px-1.5"
                placeholder="val1, val2, ..."
                value={Array.isArray(condition.value) ? condition.value.join(", ") : String(condition.value ?? "")}
                onChange={(e) =>
                  onUpdate(condition.id, { ...condition, value: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })
                }
              />
            ) : (
              <Input
                className="h-5 w-28 text-xs py-0 px-1.5"
                placeholder="value"
                value={String(condition.value ?? "")}
                onChange={(e) => onUpdate(condition.id, { ...condition, value: e.target.value })}
              />
            )
          )}

          {/* Remove */}
          <button
            className="ml-0.5 rounded-sm hover:bg-muted/80 p-0.5 shrink-0"
            onClick={() => onRemove(condition.id)}
          >
            <X size={10} />
          </button>
        </div>
      </>
    );
  }

  // --- FilterGroup (nested) ---
  const group = child as FilterGroup;

  return (
    <>
      {showLogicToggle && (
        <Select
          value={logicOperator}
          onValueChange={(val) => onChangeLogic(prevChild.id, val as "AND" | "OR")}
        >
          <SelectTrigger className="h-5 w-12 text-[10px] py-0 px-1 border-none bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">{t("database.filter.and", "AND")}</SelectItem>
            <SelectItem value="OR">{t("database.filter.or", "OR")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      <div className="rounded-md border border-primary/30 bg-primary/5 min-w-[200px]">
        {/* Group header */}
        <div className="flex items-center gap-1 px-2 py-1 border-b border-primary/20">
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          </button>
          <span className="text-[10px] text-muted-foreground truncate">
            {t("database.filter.group", "Group")}
          </span>
          <Select
            value={group.logicOperator}
            onValueChange={(val) => onUpdate(group.id, { ...group, logicOperator: val as "AND" | "OR" })}
          >
            <SelectTrigger className="h-4 w-10 text-[10px] py-0 px-1 border-none bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">{t("database.filter.and", "AND")}</SelectItem>
              <SelectItem value="OR">{t("database.filter.or", "OR")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <button
            className="rounded-sm hover:bg-muted/80 p-0.5 shrink-0"
            onClick={() => onRemove(group.id)}
          >
            <X size={10} />
          </button>
        </div>

        {/* Group children */}
        {!collapsed && (
          <div className="flex flex-wrap gap-1 p-2 items-center">
            {group.children.map((c, i) => (
              <ChildItem
                key={c.id}
                child={c}
                index={i}
                siblings={group.children}
                columns={columns}
                onUpdate={(id, updated) => {
                  const newChildren = group.children.map((ch) => (ch.id === id ? updated : ch));
                  onUpdate(group.id, { ...group, children: newChildren });
                }}
                onRemove={(id) => {
                  const newChildren = group.children.filter((ch) => ch.id !== id);
                  if (newChildren.length === 0) {
                    onRemove(group.id);
                  } else {
                    onUpdate(group.id, { ...group, children: newChildren });
                  }
                }}
                onToggle={(id) => {
                  const newChildren = group.children.map((ch) =>
                    ch.id === id && "column" in ch ? { ...ch, enabled: !(ch as FilterCondition).enabled } : ch,
                  );
                  onUpdate(group.id, { ...group, children: newChildren });
                }}
                onAddCondition={(afterId) => {
                  const idx = group.children.findIndex((c) => c.id === afterId);
                  const newChildren = [...group.children];
                  newChildren.splice(idx + 1, 0, newCondition(columns));
                  onUpdate(group.id, { ...group, children: newChildren });
                }}
                onAddGroup={(afterId) => {
                  const idx = group.children.findIndex((c) => c.id === afterId);
                  const newChildren = [...group.children];
                  newChildren.splice(idx + 1, 0, newGroup(columns));
                  onUpdate(group.id, { ...group, children: newChildren });
                }}
              />
            ))}
            {/* Add buttons inside group */}
            <div className="flex gap-1 ml-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] gap-0.5 px-1 py-0"
                onClick={() => {
                  const newChildren = [...group.children, newCondition(columns)];
                  onUpdate(group.id, { ...group, children: newChildren });
                }}
              >
                <Plus size={8} /> {t("database.filter.addCondition", "Filter")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] gap-0.5 px-1 py-0"
                onClick={() => {
                  const newChildren = [...group.children, newGroup(columns)];
                  onUpdate(group.id, { ...group, children: newChildren });
                }}
              >
                <Plus size={8} /> {t("database.filter.addGroup", "Group")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// --- Main component ---

const DatabaseFilterBuilder: React.FC<DatabaseFilterBuilderProps> = ({
  columns,
  filter,
  onChange,
  onApply,
}) => {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  const { rootGroup } = filter;

  const updateRootGroup = useCallback(
    (updated: FilterGroup) => {
      onChange({ ...filter, rootGroup: updated });
    },
    [filter, onChange],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const newChildren = rootGroup.children.map((c) =>
        c.id === id && "column" in c ? { ...c, enabled: !(c as FilterCondition).enabled } : c,
      );
      updateRootGroup({ ...rootGroup, children: newChildren });
    },
    [rootGroup, updateRootGroup],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const newChildren = rootGroup.children.filter((c) => c.id !== id);
      updateRootGroup({ ...rootGroup, children: newChildren });
    },
    [rootGroup, updateRootGroup],
  );

  const handleUpdateChild = useCallback(
    (id: string, updated: FilterCondition | FilterGroup) => {
      const newChildren = rootGroup.children.map((c) => (c.id === id ? updated : c));
      updateRootGroup({ ...rootGroup, children: newChildren });
    },
    [rootGroup, updateRootGroup],
  );

  const handleChildUpdate = useCallback(
    (id: string, updated: FilterCondition | FilterGroup) => {
      handleUpdateChild(id, updated);
    },
    [handleUpdateChild],
  );

  const handleAddCondition = useCallback(
    (afterId?: string) => {
      let newChildren: (FilterCondition | FilterGroup)[];
      if (afterId) {
        const idx = rootGroup.children.findIndex((c) => c.id === afterId);
        newChildren = [...rootGroup.children];
        newChildren.splice(idx + 1, 0, newCondition(columns));
      } else {
        newChildren = [...rootGroup.children, newCondition(columns)];
      }
      updateRootGroup({ ...rootGroup, children: newChildren });
    },
    [rootGroup, columns, updateRootGroup],
  );

  const handleAddGroup = useCallback(
    (afterId?: string) => {
      let newChildren: (FilterCondition | FilterGroup)[];
      if (afterId) {
        const idx = rootGroup.children.findIndex((c) => c.id === afterId);
        newChildren = [...rootGroup.children];
        newChildren.splice(idx + 1, 0, newGroup(columns));
      } else {
        newChildren = [...rootGroup.children, newGroup(columns)];
      }
      updateRootGroup({ ...rootGroup, children: newChildren });
    },
    [rootGroup, columns, updateRootGroup],
  );

  const handleChangeLogic = useCallback(
    (id: string, op: "AND" | "OR") => {
      const newChildren = rootGroup.children.map((c) =>
        c.id === id ? ({ ...c, logicOperator: op } as FilterCondition | FilterGroup) : c,
      );
      updateRootGroup({ ...rootGroup, children: newChildren });
    },
    [rootGroup, updateRootGroup],
  );

  const handleClearAll = useCallback(() => {
    onChange({ rootGroup: { id: newId(), logicOperator: "AND", children: [] } });
  }, [onChange]);

  const hasChildren = rootGroup.children.length > 0;

  return (
    <div className="border-b border-border/60 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2 mb-2">
        <Filter size={12} className="text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {t("database.filter.label", "Filter")}
        </span>
        {hasChildren && (
          <Select
            value={rootGroup.logicOperator}
            onValueChange={(val) => updateRootGroup({ ...rootGroup, logicOperator: val as "AND" | "OR" })}
          >
            <SelectTrigger className="h-6 w-16 text-xs py-0 px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">{t("database.filter.and", "AND")}</SelectItem>
              <SelectItem value="OR">{t("database.filter.or", "OR")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        {hasChildren && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] gap-1 px-2"
            onClick={handleClearAll}
          >
            <X size={10} />
            {t("database.filter.clearAll", "Clear All")}
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          className="h-6 text-[11px] gap-1 px-2"
          onClick={() => onApply(filter)}
        >
          <Play size={10} />
          {t("database.filter.apply", "Apply Filter")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[11px] gap-1 px-2"
          onClick={() => handleAddCondition()}
        >
          <Plus size={10} />
          {t("database.filter.addCondition", "Add Filter")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[11px] gap-1 px-2"
          onClick={() => handleAddGroup()}
        >
          <Plus size={10} />
          {t("database.filter.addGroup", "Add Group")}
        </Button>
      </div>

      {hasChildren ? (
        <div className="flex flex-wrap gap-1 items-center">
          {rootGroup.children.map((child, i) => (
            <ChildItem
              key={child.id}
              child={child}
              index={i}
              siblings={rootGroup.children}
              columns={columns}
              onUpdate={handleChildUpdate}
              onRemove={handleRemove}
              onToggle={handleToggle}
              onAddCondition={handleAddCondition}
              onAddGroup={handleAddGroup}
              onChangeLogic={handleChangeLogic}
            />
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/60 italic">
          {t("database.filter.hint", "Click Add Filter to create a condition")}
        </div>
      )}
    </div>
  );
};

export default DatabaseFilterBuilder;
