import React, { useState, useCallback } from "react";
import { useI18n } from "../application/i18n/I18nProvider";
import { GenericCredential } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Plus, Trash2, Edit2, Eye, EyeOff, Copy, Check } from "lucide-react";
import { cn } from "../lib/utils";
import { toast } from "./ui/toast";

interface CredentialsViewProps {
  credentials: GenericCredential[];
  onSave: (credential: GenericCredential) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const CredentialsView: React.FC<CredentialsViewProps> = ({
  credentials,
  onSave,
  onDelete,
}) => {
  const { t } = useI18n();
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    label: "",
    username: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData({ label: "", username: "", password: "" });
    setIsAddingNew(false);
    setEditingId(null);
    setShowPassword(false);
  }, []);

  const handleAddNew = useCallback(() => {
    resetForm();
    setIsAddingNew(true);
  }, [resetForm]);

  const handleEdit = useCallback((cred: GenericCredential) => {
    setFormData({
      label: cred.label,
      username: cred.username,
      password: cred.password,
    });
    setIsAddingNew(false);
    setEditingId(cred.id);
    setShowPassword(false);
  }, []);

  const handleCancel = useCallback(() => {
    resetForm();
  }, [resetForm]);

  const handleSave = useCallback(async () => {
    if (!formData.label.trim()) {
      toast.error("Label is required");
      return;
    }

    const credential: GenericCredential = {
      id: editingId || crypto.randomUUID(),
      label: formData.label.trim(),
      username: formData.username.trim(),
      password: formData.password,
      createdAt: editingId ? credentials.find(c => c.id === editingId)?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now(),
    };

    await onSave(credential);
    resetForm();
  }, [formData, editingId, credentials, onSave, resetForm]);

  const handleDelete = useCallback(async (id: string) => {
    await onDelete(id);
  }, [onDelete]);

  const handleCopyPassword = useCallback(async (cred: GenericCredential) => {
    try {
      await navigator.clipboard.writeText(cred.password);
      setCopiedId(cred.id);
      toast.success("Password copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy password");
    }
  }, []);

  const maskPassword = (password: string) => {
    return "*".repeat(Math.min(password.length, 12));
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">{t("vault.credentials.title") || "Credentials"}</h2>
          <Button onClick={handleAddNew} size="sm">
            <Plus size={16} className="mr-2" />
            {t("vault.credentials.add") || "Add Credential"}
          </Button>
        </div>

        {/* Add/Edit Form */}
        {isAddingNew && (
          <div className="bg-card border border-border rounded-lg p-4 mb-6">
            <h3 className="text-lg font-medium mb-4">{t("vault.credentials.addNew") || "Add New Credential"}</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="cred-label">{t("vault.credentials.label") || "Label"}</Label>
                <Input
                  id="cred-label"
                  value={formData.label}
                  onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                  placeholder={t("vault.credentials.labelPlaceholder") || "e.g., GitHub, AWS Console"}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="cred-username">{t("vault.credentials.username") || "Username"}</Label>
                <Input
                  id="cred-username"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder={t("vault.credentials.usernamePlaceholder") || "Username or email"}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="cred-password">{t("vault.credentials.password") || "Password"}</Label>
                <div className="relative mt-1">
                  <Input
                    id="cred-password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    placeholder={t("vault.credentials.passwordPlaceholder") || "Password"}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave}>
                  {t("common.save") || "Save"}
                </Button>
                <Button variant="ghost" onClick={handleCancel}>
                  {t("common.cancel") || "Cancel"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Credentials List */}
        {credentials.length === 0 && !isAddingNew ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>{t("vault.credentials.empty") || "No credentials saved yet"}</p>
            <p className="text-sm mt-2">{t("vault.credentials.emptyHint") || "Click 'Add Credential' to store your first credential"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {credentials.map((cred) => (
              <div
                key={cred.id}
                className={cn(
                  "bg-card border border-border rounded-lg p-4",
                  editingId === cred.id && "border-primary"
                )}
              >
                {editingId === cred.id ? (
                  // Edit mode
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">{t("vault.credentials.edit") || "Edit Credential"}</h3>
                    <div>
                      <Label htmlFor="edit-cred-label">{t("vault.credentials.label") || "Label"}</Label>
                      <Input
                        id="edit-cred-label"
                        value={formData.label}
                        onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-cred-username">{t("vault.credentials.username") || "Username"}</Label>
                      <Input
                        id="edit-cred-username"
                        value={formData.username}
                        onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-cred-password">{t("vault.credentials.password") || "Password"}</Label>
                      <div className="relative mt-1">
                        <Input
                          id="edit-cred-password"
                          type={showPassword ? "text" : "password"}
                          value={formData.password}
                          onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleSave}>
                        {t("common.save") || "Save"}
                      </Button>
                      <Button variant="ghost" onClick={handleCancel}>
                        {t("common.cancel") || "Cancel"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  // Display mode
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{cred.label}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {cred.username || t("vault.credentials.noUsername") || "(no username)"}
                      </div>
                      <div className="text-sm text-muted-foreground font-mono mt-1">
                        {cred.password ? maskPassword(cred.password) : "********"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopyPassword(cred)}
                        title={t("vault.credentials.copyPassword") || "Copy password"}
                      >
                        {copiedId === cred.id ? (
                          <Check size={16} className="text-green-500" />
                        ) : (
                          <Copy size={16} />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(cred)}
                        title={t("common.edit") || "Edit"}
                      >
                        <Edit2 size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(cred.id)}
                        title={t("common.delete") || "Delete"}
                        className="hover:text-destructive"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
