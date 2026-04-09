import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Key,
  Loader2,
  Server,
  Shield,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { cn } from "../../lib/utils";
import {
  DatabaseConfig,
  DatabaseDriver,
} from "../../domain/databaseModels";
import {
  AsidePanel,
  AsidePanelContent,
  AsidePanelFooter,
} from "../ui/aside-panel";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ScrollArea } from "../ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

interface DatabaseDetailsPanelProps {
  config?: Partial<DatabaseConfig>;
  open: boolean;
  onClose: () => void;
  onSave: (config: DatabaseConfig) => void;
  onCancel: () => void;
  onTestConnection: (config: DatabaseConfig) => Promise<{ok: boolean; error?: string; latencyMs?: number}>;
  availableHosts?: { id: string; label: string }[];
  availableGroups?: string[];
}

const DRIVER_OPTIONS: { value: DatabaseDriver; label: string; defaultPort: number }[] = [
  { value: "mysql", label: "MySQL", defaultPort: 3306 },
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "sqlite", label: "SQLite", defaultPort: 0 },
  { value: "redis", label: "Redis", defaultPort: 6379 },
  { value: "memcached", label: "Memcached", defaultPort: 11211 },
  { value: "mongodb", label: "MongoDB", defaultPort: 27017 },
];

const DatabaseDetailsPanel: React.FC<DatabaseDetailsPanelProps> = ({
  config,
  open,
  onClose,
  onSave,
  onCancel,
  onTestConnection,
  availableHosts = [],
  availableGroups = [],
}) => {
  const { t } = useI18n();
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ok: boolean; error?: string; latencyMs?: number} | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tlsOpen, setTlsOpen] = useState(false);

  // Form state
  const [form, setForm] = useState<Partial<DatabaseConfig>>({
    id: "",
    label: "",
    driver: "mysql",
    group: undefined,
    host: "localhost",
    port: 3306,
    database: "",
    username: "",
    authPassword: "",
    tls: false,
    tlsCa: "",
    tlsCert: "",
    tlsKey: "",
    tlsRejectUnauthorized: true,
    filePath: "",
    databaseIndex: 0,
    replicaSet: "",
    authSource: "admin",
    poolMin: 1,
    poolMax: 10,
    poolIdleTimeoutMs: 30000,
    sshTunnelHostId: undefined,
  });

  // Initialize form with config data
  useEffect(() => {
    if (config?.id) {
      setForm(config);
      setTestResult(null);
    } else {
      // New config - generate ID - use empty object base
      setForm({
        id: crypto.randomUUID(),
        label: "",
        driver: "mysql",
        group: undefined,
        host: "localhost",
        port: 3306,
        database: "",
        username: "",
        authPassword: "",
        tls: false,
        tlsCa: "",
        tlsCert: "",
        tlsKey: "",
        tlsRejectUnauthorized: true,
        filePath: "",
        databaseIndex: 0,
        replicaSet: "",
        authSource: "admin",
        poolMin: 1,
        poolMax: 10,
        poolIdleTimeoutMs: 30000,
        sshTunnelHostId: undefined,
      });
      setTestResult(null);
    }
  }, [config, open]);

  // Auto-update port when driver changes
  const handleDriverChange = useCallback((driver: DatabaseDriver) => {
    const driverOption = DRIVER_OPTIONS.find((d) => d.value === driver);
    setForm((prev) => ({
      ...prev,
      driver,
      port: driverOption?.defaultPort || 0,
      // Reset driver-specific fields
      filePath: driver === "sqlite" ? prev.filePath : undefined,
      databaseIndex: driver === "redis" ? prev.databaseIndex : undefined,
      replicaSet: driver === "mongodb" ? prev.replicaSet : undefined,
    }));
  }, []);

  // Update form field
  const update = useCallback(<K extends keyof DatabaseConfig>(field: K, value: DatabaseConfig[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    const fullConfig: DatabaseConfig = {
      id: form.id || crypto.randomUUID(),
      label: form.label || "",
      driver: form.driver || "mysql",
      group: form.group,
      host: form.host || "",
      port: form.port || 0,
      database: form.database,
      username: form.username,
      authPassword: form.authPassword,
      tls: form.tls,
      tlsCa: form.tlsCa,
      tlsCert: form.tlsCert,
      tlsKey: form.tlsKey,
      tlsRejectUnauthorized: form.tlsRejectUnauthorized,
      filePath: form.filePath,
      databaseIndex: form.databaseIndex,
      replicaSet: form.replicaSet,
      authSource: form.authSource,
      poolMin: form.poolMin,
      poolMax: form.poolMax,
      poolIdleTimeoutMs: form.poolIdleTimeoutMs,
      sshTunnelHostId: form.sshTunnelHostId,
    };
    onSave(fullConfig);
  }, [form, onSave]);

  // Handle test connection
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const fullConfig: DatabaseConfig = {
        id: form.id || crypto.randomUUID(),
        label: form.label || "",
        driver: form.driver || "mysql",
        group: form.group,
        host: form.host || "",
        port: form.port || 0,
        database: form.database,
        username: form.username,
        authPassword: form.authPassword,
        tls: form.tls,
        tlsCa: form.tlsCa,
        tlsCert: form.tlsCert,
        tlsKey: form.tlsKey,
        tlsRejectUnauthorized: form.tlsRejectUnauthorized,
        filePath: form.filePath,
        databaseIndex: form.databaseIndex,
        replicaSet: form.replicaSet,
        authSource: form.authSource,
        poolMin: form.poolMin,
        poolMax: form.poolMax,
        poolIdleTimeoutMs: form.poolIdleTimeoutMs,
        sshTunnelHostId: form.sshTunnelHostId,
      };
      const result = await onTestConnection(fullConfig);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  }, [form, onTestConnection]);

  // Validate form
  const isValid = useMemo(() => {
    if (!form.label?.trim()) return false;
    if (!form.driver) return false;
    if (form.driver === "sqlite" && !form.filePath?.trim()) return false;
    if (form.driver !== "sqlite" && !form.host?.trim()) return false;
    return true;
  }, [form]);

  const isNew = !config?.id;

  return (
    <AsidePanel
      open={open}
      onClose={onClose}
      title={isNew ? t("database.addDatabase") : t("database.editDatabase")}
      subtitle={form.label || t("database.newConnection")}
      width="w-[420px]"
      className="flex flex-col"
    >
      <AsidePanelContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full [&>[data-radix-scroll-area-viewport]>div]:!block">
          <div className="space-y-4 pr-4">
            {/* Basic Info */}
            <Card className="p-3 space-y-3 bg-card border-border/80">
              <div className="flex items-center gap-2">
                <Database size={14} className="text-muted-foreground" />
                <p className="text-xs font-semibold">{t("database.connectionDetails")}</p>
              </div>

              {/* Label */}
              <div className="space-y-1.5">
                <Label htmlFor="label">{t("database.label")} *</Label>
                <Input
                  id="label"
                  placeholder={t("database.labelPlaceholder")}
                  value={form.label || ""}
                  onChange={(e) => update("label", e.target.value)}
                  className="h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="group">{t("database.group")}</Label>
                <Select
                  value={form.group || "__none__"}
                  onValueChange={(value) => update("group", value === "__none__" ? undefined : value)}
                >
                  <SelectTrigger id="group" className="h-10">
                    <SelectValue placeholder={t("database.selectGroup")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("database.noGroup")}</SelectItem>
                    {availableGroups.map((groupPath) => (
                      <SelectItem key={groupPath} value={groupPath}>
                        {groupPath}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Driver */}
              <div className="space-y-1.5">
                <Label htmlFor="driver">{t("database.type")}</Label>
                <Select
                  value={form.driver}
                  onValueChange={(v) => handleDriverChange(v as DatabaseDriver)}
                >
                  <SelectTrigger id="driver" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DRIVER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Card>

            {/* Connection Settings - Different for SQLite vs Network */}
            {form.driver === "sqlite" ? (
              <Card className="p-3 space-y-3 bg-card border-border/80">
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <p className="text-xs font-semibold">{t("database.filePath")}</p>
                </div>
                <div className="space-y-1.5">
                  <Input
                    id="filePath"
                    placeholder={t("database.filePathPlaceholder")}
                    value={form.filePath || ""}
                    onChange={(e) => update("filePath", e.target.value)}
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("database.sqliteHelp")}
                  </p>
                </div>
              </Card>
            ) : (
              <Card className="p-3 space-y-3 bg-card border-border/80">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-muted-foreground" />
                  <p className="text-xs font-semibold">{t("database.networkSettings")}</p>
                </div>

                {/* Host */}
                <div className="space-y-1.5">
                  <Label htmlFor="host">{t("database.host")}</Label>
                  <Input
                    id="host"
                    placeholder="localhost"
                    value={form.host || ""}
                    onChange={(e) => update("host", e.target.value)}
                    className="h-10"
                  />
                </div>

                {/* Port */}
                <div className="space-y-1.5">
                  <Label htmlFor="port">{t("database.port")}</Label>
                  <Input
                    id="port"
                    type="number"
                    value={form.port || ""}
                    onChange={(e) => update("port", Number(e.target.value))}
                    className="h-10"
                  />
                </div>

                {/* Database name */}
                <div className="space-y-1.5">
                  <Label htmlFor="database">{t("database.databaseName")}</Label>
                  <Input
                    id="database"
                    placeholder={form.driver === "redis" ? "0" : "mydb"}
                    value={form.database || ""}
                    onChange={(e) => update("database", e.target.value)}
                    className="h-10"
                  />
                </div>
              </Card>
            )}

            {/* Authentication */}
            {form.driver !== "sqlite" && (
              <Card className="p-3 space-y-3 bg-card border-border/80">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-muted-foreground" />
                  <p className="text-xs font-semibold">{t("database.authentication")}</p>
                </div>

                {/* Username */}
                <div className="space-y-1.5">
                  <Label htmlFor="username">{t("database.username")}</Label>
                  <Input
                    id="username"
                    placeholder={t("database.usernamePlaceholder")}
                    value={form.username || ""}
                    onChange={(e) => update("username", e.target.value)}
                    className="h-10"
                    autoComplete="off"
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t("database.password")}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t("database.passwordPlaceholder")}
                      value={form.authPassword || ""}
                      onChange={(e) => update("authPassword", e.target.value)}
                      className="h-10 pr-10"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-md transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff size={16} className="text-muted-foreground" />
                      ) : (
                        <Eye size={16} className="text-muted-foreground" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("database.passwordHelp")}
                  </p>
                </div>
              </Card>
            )}

            {/* Redis specific */}
            {form.driver === "redis" && (
              <Card className="p-3 space-y-3 bg-card border-border/80">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-muted-foreground" />
                  <p className="text-xs font-semibold">{t("database.redisSettings")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="databaseIndex">{t("database.redisDbIndex")}</Label>
                  <Input
                    id="databaseIndex"
                    type="number"
                    min={0}
                    max={15}
                    value={form.databaseIndex || 0}
                    onChange={(e) => update("databaseIndex", Number(e.target.value))}
                    className="h-10"
                  />
                </div>
              </Card>
            )}

            {/* MongoDB specific */}
            {form.driver === "mongodb" && (
              <Card className="p-3 space-y-3 bg-card border-border/80">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-muted-foreground" />
                  <p className="text-xs font-semibold">{t("database.mongodbSettings")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="replicaSet">{t("database.replicaSet")}</Label>
                  <Input
                    id="replicaSet"
                    placeholder={t("database.replicaSetPlaceholder")}
                    value={form.replicaSet || ""}
                    onChange={(e) => update("replicaSet", e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="authSource">{t("database.authSource")}</Label>
                  <Input
                    id="authSource"
                    placeholder="admin"
                    value={form.authSource || "admin"}
                    onChange={(e) => update("authSource", e.target.value)}
                    className="h-10"
                  />
                </div>
              </Card>
            )}

            {/* TLS Settings */}
            {form.driver !== "sqlite" && (
              <Collapsible open={tlsOpen} onOpenChange={setTlsOpen}>
                <Card className="p-3 bg-card border-border/80 overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Shield size={14} className="text-muted-foreground" />
                        <p className="text-xs font-semibold">{t("database.tlsSettings")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={form.tls || false}
                          onCheckedChange={(checked) => {
                            update("tls", checked);
                            if (checked) setTlsOpen(true);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <ChevronDown
                          size={14}
                          className={cn(
                            "text-muted-foreground transition-transform",
                            tlsOpen && "rotate-180"
                          )}
                        />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="tlsCa">{t("database.tlsCa")}</Label>
                      <Input
                        id="tlsCa"
                        placeholder={t("database.tlsCaPlaceholder")}
                        value={form.tlsCa || ""}
                        onChange={(e) => update("tlsCa", e.target.value)}
                        className="h-10 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tlsCert">{t("database.tlsCert")}</Label>
                      <Input
                        id="tlsCert"
                        placeholder={t("database.tlsCertPlaceholder")}
                        value={form.tlsCert || ""}
                        onChange={(e) => update("tlsCert", e.target.value)}
                        className="h-10 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tlsKey">{t("database.tlsKey")}</Label>
                      <Input
                        id="tlsKey"
                        placeholder={t("database.tlsKeyPlaceholder")}
                        value={form.tlsKey || ""}
                        onChange={(e) => update("tlsKey", e.target.value)}
                        className="h-10 font-mono text-xs"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="tlsRejectUnauthorized" className="cursor-pointer">
                        {t("database.tlsRejectUnauthorized")}
                      </Label>
                      <Switch
                        id="tlsRejectUnauthorized"
                        checked={form.tlsRejectUnauthorized !== false}
                        onCheckedChange={(checked) => update("tlsRejectUnauthorized", checked)}
                      />
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* SSH Tunnel */}
            {form.driver !== "sqlite" && availableHosts.length > 0 && (
              <Card className="p-3 space-y-3 bg-card border-border/80">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-muted-foreground" />
                  <p className="text-xs font-semibold">{t("database.sshTunnel")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sshTunnel">{t("database.sshTunnelHost")}</Label>
                  <Select
                    value={form.sshTunnelHostId || "__none__"}
                    onValueChange={(v) => update("sshTunnelHostId", v === "__none__" ? undefined : v)}
                  >
                    <SelectTrigger id="sshTunnel" className="h-10">
                      <SelectValue placeholder={t("database.selectSshTunnel")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("common.none")}</SelectItem>
                      {availableHosts.map((host) => (
                        <SelectItem key={host.id} value={host.id}>
                          {host.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Card>
            )}

            {/* Advanced Settings */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <Card className="p-3 bg-card border-border/80 overflow-hidden">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between cursor-pointer">
                    <p className="text-xs font-semibold">{t("database.advancedSettings")}</p>
                    <ChevronDown
                      size={14}
                      className={cn(
                        "text-muted-foreground transition-transform",
                        advancedOpen && "rotate-180"
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="poolMin">{t("database.poolMin")}</Label>
                      <Input
                        id="poolMin"
                        type="number"
                        min={1}
                        value={form.poolMin || 1}
                        onChange={(e) => update("poolMin", Number(e.target.value))}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="poolMax">{t("database.poolMax")}</Label>
                      <Input
                        id="poolMax"
                        type="number"
                        min={1}
                        value={form.poolMax || 10}
                        onChange={(e) => update("poolMax", Number(e.target.value))}
                        className="h-10"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="poolIdleTimeout">{t("database.poolIdleTimeout")}</Label>
                    <Input
                      id="poolIdleTimeout"
                      type="number"
                      min={1000}
                      step={1000}
                      value={form.poolIdleTimeoutMs || 30000}
                      onChange={(e) => update("poolIdleTimeoutMs", Number(e.target.value))}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("database.poolIdleTimeoutHelp")}
                    </p>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        </ScrollArea>
      </AsidePanelContent>

      <AsidePanelFooter className="flex-col gap-2">
        {/* Test Result */}
        {testResult && (
          <div
            className={cn(
              "w-full p-2 rounded-md text-xs flex items-center gap-2",
              testResult.ok
                ? "bg-green-500/10 text-green-600"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {testResult.ok ? (
              <>
                <Check size={14} />
                <span>
                  {t("database.connectionSuccess")}
                  {testResult.latencyMs !== undefined && ` (${testResult.latencyMs}ms)`}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle size={14} />
                <span className="truncate">{testResult.error || t("database.connectionFailed")}</span>
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 w-full">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testing || !isValid}
                  className="gap-1.5"
                >
                  {testing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Server size={14} />
                  )}
                  {t("database.testConnection")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("database.testConnectionHelp")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="flex-1" />

          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!isValid}>
            {isNew ? t("database.createConnection") : t("common.save")}
          </Button>
        </div>
      </AsidePanelFooter>
    </AsidePanel>
  );
};

export default DatabaseDetailsPanel;
