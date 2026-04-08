import {
  Database,
  Plug,
  PlugZap,
  Plus,
  Search,
  Trash2,
  Edit2,
  Play,
  RefreshCw,
  WifiOff,
  AlertCircle,
  Loader2,
  Server,
} from "lucide-react";
import React, { useState, useMemo } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import {
  DatabaseConfig,
  DatabaseDriver,
  DatabaseSession,
} from "../../domain/databaseModels";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Badge } from "../ui/badge";

interface DatabaseViewProps {
  configs: DatabaseConfig[];
  sessions: DatabaseSession[];
  onConnect: (configId: string) => void;
  onDisconnect: (sessionId: string) => void;
  onSaveConfig: (config: DatabaseConfig) => void;
  onDeleteConfig: (configId: string) => void;
  onEditConfig: (config: DatabaseConfig) => void;
  onTestConnection: (config: DatabaseConfig) => void;
}

const DRIVER_ICONS: Record<DatabaseDriver, React.ReactNode> = {
  mysql: <Database size={16} className="text-[#44779F]" />,
  postgresql: <Database size={16} className="text-[#336791]" />,
  sqlite: <Database size={16} className="text-[#003B80]" />,
  redis: <Database size={16} className="text-[#DC382D]" />,
  memcached: <Database size={16} className="text-[#6DB0DB]" />,
  mongodb: <Database size={16} className="text-[#47A248]" />,
};

const DRIVER_LABELS: Record<DatabaseDriver, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
  redis: "Redis",
  memcached: "Memcached",
  mongodb: "MongoDB",
};

const DRIVER_COLORS: Record<DatabaseDriver, string> = {
  mysql: "bg-[#44779F]/10 text-[#44779F]",
  postgresql: "bg-[#336791]/10 text-[#336791]",
  sqlite: "bg-[#003B80]/10 text-[#003B80]",
  redis: "bg-[#DC382D]/10 text-[#DC382D]",
  memcached: "bg-[#6DB0DB]/10 text-[#6DB0DB]",
  mongodb: "bg-[#47A248]/10 text-[#47A248]",
};

type ConnectionState = "connected" | "connecting" | "error" | "disconnected";

const DatabaseView: React.FC<DatabaseViewProps> = ({
  configs,
  sessions,
  onConnect,
  onDisconnect,
  onSaveConfig: _onSaveConfig,
  onDeleteConfig,
  onEditConfig,
  onTestConnection,
}) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [testingConfigId, setTestingConfigId] = useState<string | null>(null);

  // Build a map of config ID to session for quick lookup
  const sessionByConfigId = useMemo(() => {
    const map = new Map<string, DatabaseSession>();
    for (const session of sessions) {
      if (session.status.connected) {
        map.set(session.configId, session);
      }
    }
    return map;
  }, [sessions]);

  // Get connection state for a config
  const getConnectionState = (configId: string): ConnectionState => {
    const session = sessionByConfigId.get(configId);
    if (session?.status.connected) return "connected";
    if (session?.status.error) return "error";
    return "disconnected";
  };

  // Filter configs by search query
  const filteredConfigs = useMemo(() => {
    if (!searchQuery.trim()) return configs;
    const query = searchQuery.toLowerCase();
    return configs.filter(
      (config) =>
        config.label.toLowerCase().includes(query) ||
        config.driver.toLowerCase().includes(query) ||
        config.host?.toLowerCase().includes(query) ||
        config.database?.toLowerCase().includes(query)
    );
  }, [configs, searchQuery]);

  // Handle test connection
  const handleTestConnection = async (config: DatabaseConfig) => {
    setTestingConfigId(config.id);
    try {
      await onTestConnection(config);
    } finally {
      setTestingConfigId(null);
    }
  };

  // Render status indicator
  const renderStatusIndicator = (configId: string) => {
    const state = getConnectionState(configId);
    const session = sessionByConfigId.get(configId);

    switch (state) {
      case "connected":
        return (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            {session?.status.serverVersion && (
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                {session.status.serverVersion}
              </span>
            )}
          </div>
        );
      case "connecting":
        return (
          <div className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-yellow-500" />
            <span className="text-xs text-yellow-500">{t("common.connecting")}</span>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-1.5">
            <AlertCircle size={12} className="text-destructive" />
            <span className="text-xs text-destructive truncate max-w-[120px]">
              {session?.status.error || t("database.error")}
            </span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5">
            <WifiOff size={12} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("database.disconnected")}</span>
          </div>
        );
    }
  };

  // Render connection button
  const renderConnectionButton = (config: DatabaseConfig) => {
    const state = getConnectionState(config.id);
    const session = sessionByConfigId.get(config.id);

    if (state === "connected" && session) {
      return (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onDisconnect(session.id)}
        >
          <PlugZap size={14} />
          {t("database.disconnect")}
        </Button>
      );
    }

    if (state === "connecting") {
      return (
        <Button variant="outline" size="sm" disabled className="gap-1.5">
          <Loader2 size={14} className="animate-spin" />
          {t("common.connecting")}
        </Button>
      );
    }

    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onConnect(config.id)}
      >
        <Plug size={14} />
        {t("database.connect")}
      </Button>
    );
  };

  // Empty state
  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
          <Database size={32} className="text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{t("database.noDatabases")}</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          {t("database.noDatabasesDescription")}
        </p>
        <Button onClick={() => onEditConfig({} as DatabaseConfig)}>
          <Plus size={16} className="mr-2" />
          {t("database.addDatabase")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("database.databases")}</h2>
            <Badge variant="secondary" className="text-xs">
              {configs.length}
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={() => onEditConfig({} as DatabaseConfig)}
          >
            <Plus size={14} className="mr-1.5" />
            {t("database.addDatabase")}
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={t("database.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Database list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <TooltipProvider>
          {filteredConfigs.map((config) => (
            <ContextMenu key={config.id}>
              <ContextMenuTrigger>
                <Card
                  className={cn(
                    "p-3 hover:bg-secondary/50 transition-colors cursor-pointer group",
                    getConnectionState(config.id) === "connected" && "border-green-500/50"
                  )}
                  onClick={() => {
                    const state = getConnectionState(config.id);
                    if (state === "connected") {
                      // Focus on existing session
                    } else if (state !== "connecting") {
                      onConnect(config.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Driver icon */}
                      <div
                        className={cn(
                          "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                          DRIVER_COLORS[config.driver]
                        )}
                      >
                        {DRIVER_ICONS[config.driver]}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {config.label}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-xs shrink-0", DRIVER_COLORS[config.driver])}
                          >
                            {DRIVER_LABELS[config.driver]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {config.host && (
                            <span className="text-xs text-muted-foreground truncate">
                              {config.host}:{config.port}
                            </span>
                          )}
                          {config.filePath && (
                            <span className="text-xs text-muted-foreground truncate font-mono text-[10px]">
                              {config.filePath}
                            </span>
                          )}
                          {config.database && (
                            <span className="text-xs text-muted-foreground truncate">
                              /{config.database}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status and actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {renderStatusIndicator(config.id)}

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTestConnection(config);
                              }}
                              disabled={testingConfigId === config.id}
                            >
                              <RefreshCw
                                size={14}
                                className={cn(
                                  testingConfigId === config.id && "animate-spin"
                                )}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("database.testConnection")}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditConfig(config);
                              }}
                            >
                              <Edit2 size={14} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("common.edit")}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteConfig(config.id);
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("common.delete")}</TooltipContent>
                        </Tooltip>
                      </div>

                      {renderConnectionButton(config)}
                    </div>
                  </div>
                </Card>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  icon={<Plug size={14} />}
                  onClick={() => onConnect(config.id)}
                  disabled={getConnectionState(config.id) !== "disconnected"}
                >
                  {t("database.connect")}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<PlugZap size={14} />}
                  onClick={() => {
                    const session = sessionByConfigId.get(config.id);
                    if (session) onDisconnect(session.id);
                  }}
                  disabled={getConnectionState(config.id) !== "connected"}
                >
                  {t("database.disconnect")}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Play size={14} />}
                  onClick={() => handleTestConnection(config)}
                  disabled={testingConfigId === config.id}
                >
                  {t("database.testConnection")}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Edit2 size={14} />}
                  onClick={() => onEditConfig(config)}
                >
                  {t("common.edit")}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Trash2 size={14} />}
                  onClick={() => onDeleteConfig(config.id)}
                  variant="destructive"
                >
                  {t("common.delete")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </TooltipProvider>

        {filteredConfigs.length === 0 && searchQuery && (
          <div className="text-center py-8 text-muted-foreground">
            <Search size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t("database.noResults")}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseView;
