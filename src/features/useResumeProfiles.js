import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase";
export function useResumeProfiles(userId, pushToast) {
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const [profiles, setProfiles] = useState([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const reload = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("resume_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("created_at");
    if (currentUser.current !== userId) return;
    if (error) {
      console.warn("Resume library unavailable", {
        code: error.code || "LOAD_FAILED",
      });
      pushToast(
        "Couldn’t load resume versions. Your primary resume remains available.",
        "error",
      );
      return;
    }
    setProfiles(data);
    setReady(true);
    setSelectedId((id) =>
      data.some((p) => p.id === id)
        ? id
        : data.find((p) => p.is_default)?.id || data[0]?.id || "",
    );
  }, [userId, pushToast]);
  useEffect(() => {
    setProfiles([]);
    setReady(false);
    setSelectedId("");
    reload();
  }, [reload]);
  const save = async (profile) => {
    try {
      const row = {
        user_id: userId,
        title: profile.title.trim(),
        text: profile.text,
        notes: profile.notes || "",
        updated_at: new Date().toISOString(),
      };
      if (!row.title || row.text.length > 100000)
        throw new Error("Check the resume title and length.");
      let query = profile.id
        ? supabase
            .from("resume_profiles")
            .update(row)
            .eq("id", profile.id)
            .eq("user_id", userId)
        : supabase
            .from("resume_profiles")
            .insert({ ...row, is_default: !profiles.length });
      const { data, error } = await query.select().single();
      if (error) throw error;
      await reload();
      setSelectedId(data.id);
      pushToast("Resume saved.", "success");
      return true;
    } catch {
      pushToast("Couldn’t save this resume. Please try again.", "error");
      return false;
    }
  };
  const remove = async (id) => {
    const { error } = await supabase
      .from("resume_profiles")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      pushToast(
        "Couldn’t delete this resume. Reassign applications using it first.",
        "error",
      );
      return false;
    }
    await reload();
    pushToast("Resume deleted.", "success");
    return true;
  };
  const makeDefault = async (id) => {
    const { error } = await supabase.rpc("set_default_resume", {
      profile_id: id,
    });
    if (error) pushToast("Couldn’t change the default resume.", "error");
    else {
      await reload();
      pushToast("Default resume updated.", "success");
    }
  };
  return {
    profiles,
    ready,
    selectedId,
    setSelectedId,
    reload,
    save,
    remove,
    makeDefault,
  };
}
