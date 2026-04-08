import { useCallback, useState } from "react";
import { GenericCredential } from "../../domain/models";
import { netcattyBridge } from "../../infrastructure/services/netcattyBridge";

export const useGenericCredentials = () => {
  const [credentials, setCredentials] = useState<GenericCredential[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const bridge = netcattyBridge.get();
      const result = await bridge?.genericCredentials?.list?.();
      if (result?.ok) {
        setCredentials(result.credentials || []);
      }
    } catch (err) {
      console.error("[useGenericCredentials] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveCredential = useCallback(async (credential: GenericCredential) => {
    const bridge = netcattyBridge.get();
    const result = await bridge?.genericCredentials?.save?.(credential);
    return result;
  }, []);

  const deleteCredential = useCallback(async (id: string) => {
    const bridge = netcattyBridge.get();
    const result = await bridge?.genericCredentials?.delete?.(id);
    return result;
  }, []);

  return { credentials, loading, loadCredentials, saveCredential, deleteCredential };
};
