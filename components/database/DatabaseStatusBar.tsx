import {
  Activity,
  Circle,
  Database,
  Loader2,
  WifiOff,
} from "lucide-react";
import React from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import { DatabaseDriver } from "../../domain/databaseModels";

interface DatabaseStatusBarProps {
  driver: DatabaseDriver;
  connected: boolean;
  serverVersion?: string;
  activeQueries: number;
  latencyMs?: number;
}

const DRIVER_LABELS: Record<DatabaseDriver, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
  redis: "Redis",
  memcached: "Memcached",
  mongodb: "MongoDB",
};

const DRIVER_COLORS: Record<DatabaseDriver, string> = {
  mysql: "text-[#44779F]",
  postgresql: "text-[#336791]",
  sqlite: "text-[#003B80]",
  redis: "text-[#DC382D]",
  memcached: "text-[#6DB0DB]",
  mongodb: "text-[#47A248]",
};

const DatabaseStatusBar: React.FC<DatabaseStatusBarProps> = ({
  driver,
  connected,
  serverVersion,
  activeQueries,
  latencyMs,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-3 px-3 py-1 border-t border-border/60 bg-muted/30 text-xs">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "relative flex h-2 w-2",
            connected ? "text-green-500" : "text-muted-foreground"
          )}
        >
          {connected ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </>
          ) : (
            <WifiOff size={10} />
          )}
        </span>
        <span className={cn(connected ? "text-foreground" : "text-muted-foreground")}>
          {connected ? t("database.connected") : t("database.disconnected")}
        </span>
      </div>

      {/* Separator */}
      <div className="h-3 w-px bg-border/60" />

      {/* Driver */}
      <div className="flex items-center gap-1.5">
        <Database size={12} className={DRIVER_COLORS[driver]} />
        <span className={cn(DRIVER_COLORS[driver], "font-medium")}>
          {DRIVER_LABELS[driver]}
        </span>
      </div>

      {/* Server version */}
      {connected && serverVersion && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <span className="text-muted-foreground truncate max-w-[200px]">
            {serverVersion}
          </span>
        </>
      )}

      {/* Active queries */}
      {connected && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="flex items-center gap-1">
            {activeQueries > 0 ? (
              <>
                <Loader2 size={10} className="animate-spin text-yellow-500" />
                <span className="text-yellow-500">
                  {t("database.executingQuery", { count: activeQueries })}
                </span>
              </>
            ) : (
              <>
                <Activity size={10} className="text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t("database.ready")}
                </span>
              </>
            )}
          </div>
        </>
      )}

      {/* Latency */}
      {connected && latencyMs !== undefined && (
        <>
          <div className="h-3 w-px bg-border/60" />
          <div className="flex items-center gap-1">
            <Circle
              size={8}
              className={cn(
                latencyMs < 50 && "fill-green-500 text-green-500",
                latencyMs >= 50 && latencyMs < 200 && "fill-yellow-500 text-yellow-500",
                latencyMs >= 200 && "fill-red-500 text-red-500"
              )}
            />
            <span
              className={cn(
                latencyMs < 50 && "text-green-500",
                latencyMs >= 50 && latencyMs < 200 && "text-yellow-500",
                latencyMs >= 200 && "text-red-500"
              )}
            >
              {latencyMs}ms
            </span>
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Version info */}
      <span className="text-muted-foreground/60">
        Netcatty Database
      </span>
    </div>
  );
};

export default DatabaseStatusBar;
