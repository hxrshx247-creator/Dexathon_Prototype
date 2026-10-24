import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadDashboard,
  refreshStatusAndEvents,
  type Case,
  type CaseEvent,
  type CaseStatus,
} from "../api/client";

type Data = { caseData: Case; status: CaseStatus; events: CaseEvent[] };

/** Loads the three dashboard calls in parallel; `refresh` re-fetches status and events after any change. */
export function useDashboard(caseId: string | undefined) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!caseId) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await loadDashboard(caseId);
      if (mine === seq.current) setData(d);
    } catch (e) {
      if (mine === seq.current) setError(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [caseId]);

  const refresh = useCallback(async () => {
    if (!caseId) return;
    const { status, events } = await refreshStatusAndEvents(caseId);
    setData((d) => (d ? { ...d, status, events } : d));
  }, [caseId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  return { data, error, loading, reload: load, refresh };
}
