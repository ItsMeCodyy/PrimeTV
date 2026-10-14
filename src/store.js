import { createClient } from "../vendor/supabase.js";
import { config } from "../config.js";
import { keyOf, normalize } from "./catalog.js";
export const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export const colors = ["violet", "peach", "sage", "blue", "rose"];
export class LibraryStore extends EventTarget {
  constructor() {
    super();
    this.client =
      config.supabaseUrl && config.supabasePublishableKey
        ? createClient(config.supabaseUrl, config.supabasePublishableKey, {
            auth: { storageKey: "primetv:auth", detectSessionInUrl: true },
          })
        : null;
    this.user = null;
    this.profiles = [];
    this.profile = null;
    this.records = [];
    this.pending = new Map();
    this.syncing = null;
    this.status = "local";
    this.epoch = 0;
    this.guest();
    window.addEventListener("online", () => this.flush());
  }
  emit() {
    this.dispatchEvent(new Event("change"));
  }
  guest() {
    this.epoch++;
    this.user = null;
    this.pending.clear();
    this.profiles = read("primetv:v2:guest-profiles", [
      { id: crypto.randomUUID(), name: "You", color: "violet", slot: 1 },
    ]);
    if (!Array.isArray(this.profiles) || !this.profiles.length)
      this.profiles = [
        { id: crypto.randomUUID(), name: "You", color: "violet", slot: 1 },
      ];
    write("primetv:v2:guest-profiles", this.profiles);
    this.profile = this.profiles[0];
    this.loadLocal();
    this.status = "local";
    this.migrateLegacy();
  }
  cacheKey(profile = this.profile) {
    return `primetv:v2:${this.user?.id || "guest"}:${profile.id}`;
  }
  loadLocal() {
    const data = read(this.cacheKey(), { records: [], pending: [] });
    this.records = Array.isArray(data.records) ? data.records : [];
    this.pending = new Map(data.pending || []);
  }
  persist() {
    if (
      !write(this.cacheKey(), {
        records: this.records,
        pending: [...this.pending],
      })
    )
      this.status = "storage-error";
  }
  migrateLegacy() {
    if (read("primetv:v2:migrated", false)) return;
    const rows = new Map();
    for (const old of read("primetv:continue", [])) {
      const item = normalize(old);
      rows.set(keyOf(item), {
        media_id: item.id,
        media_type: item.media_type,
        item,
        position: 0,
        duration: 0,
        season: old.season || 1,
        episode: old.episode || 1,
        started_at: new Date(old.watchedAt || Date.now()).toISOString(),
        updated_at: new Date(old.watchedAt || Date.now()).toISOString(),
        rating: 0,
        in_list: false,
        completed: false,
      });
    }
    for (const old of read("primetv:favorites", [])) {
      const item = normalize(old);
      rows.set(keyOf(item), {
        media_id: item.id,
        media_type: item.media_type,
        item,
        position: 0,
        duration: 0,
        season: 1,
        episode: 1,
        updated_at: new Date().toISOString(),
        completed: false,
        ...rows.get(keyOf(item)),
        rating: 1,
        in_list: true,
      });
    }
    this.records = [...rows.values(), ...this.records];
    this.persist();
    write("primetv:v2:migrated", true);
  }
  async init() {
    if (!this.client) return;
    this.client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY")
        this.dispatchEvent(new Event("recovery"));
      if (event === "SIGNED_OUT") {
        this.guest();
        this.emit();
        this.dispatchEvent(new Event("account"));
      }
      // Avoid awaiting Supabase work from the auth callback (auth lock).
      if (session?.user && session.user.id !== this.user?.id)
        setTimeout(
          () =>
            this.account(session.user).catch(() => {
              this.status = "error";
              this.emit();
            }),
          0,
        );
    });
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await this.account(data.session.user);
  }
  async account(user, force = false) {
    if (this.user?.id === user.id && !force) return;
    const epoch = ++this.epoch;
    this.user = user;
    this.profile = null;
    this.records = [];
    this.pending.clear();
    this.status = "loading";
    this.emit();
    const { data, error } = await this.client
      .from("primetv_profiles")
      .select("*")
      .eq("user_id", user.id)
      .order("slot");
    if (epoch !== this.epoch) return;
    if (error) {
      this.status = "error";
      this.emit();
      throw error;
    }
    this.profiles = data || [];
    this.status = "synced";
    this.emit();
    this.dispatchEvent(new Event("account"));
  }
  async select(profile) {
    if (!this.profiles.some((p) => p.id === profile.id))
      throw new Error("Choose one of your profiles.");
    await this.flush();
    this.epoch++;
    const epoch = this.epoch;
    this.profile = profile;
    this.loadLocal();
    this.emit();
    if (!this.user) return;
    this.status = "loading";
    this.emit();
    const { data, error } = await this.client
      .from("primetv_activity")
      .select("*")
      .eq("profile_id", profile.id);
    if (epoch !== this.epoch) return;
    if (error) {
      this.status = "error";
      this.emit();
      throw error;
    }
    const merged = new Map(
      (data || []).map((r) => [`${r.media_type}:${r.media_id}`, r]),
    );
    this.pending.forEach((r, k) => merged.set(k, r));
    this.records = [...merged.values()];
    this.persist();
    this.status = "synced";
    this.emit();
    await this.flush();
  }
  async saveProfile(name, color, id) {
    name = name.trim();
    if (!name || name.length > 24)
      throw new Error("Use a name between 1 and 24 characters.");
    if (!colors.includes(color)) color = "violet";
    let profile = this.profiles.find((p) => p.id === id);
    if (!profile && this.profiles.length >= 5)
      throw new Error("You can have up to five profiles.");
    profile = {
      ...profile,
      id: profile?.id || crypto.randomUUID(),
      name,
      color,
      slot:
        profile?.slot ||
        [1, 2, 3, 4, 5].find((n) => !this.profiles.some((p) => p.slot === n)),
    };
    if (this.user) {
      const { data, error } = await this.client
        .from("primetv_profiles")
        .upsert({ ...profile, user_id: this.user.id })
        .select()
        .single();
      if (error) throw error;
      profile = data;
    }
    this.profiles = [
      ...this.profiles.filter((p) => p.id !== profile.id),
      profile,
    ].sort((a, b) => a.slot - b.slot);
    if (!this.user) write("primetv:v2:guest-profiles", this.profiles);
    if (this.profile?.id === profile.id) this.profile = profile;
    this.emit();
    return profile;
  }
  async deleteProfile(id) {
    await this.flush();
    if (this.profiles.length <= 1)
      throw new Error("Keep at least one profile.");
    if (this.user) {
      const { error } = await this.client
        .from("primetv_profiles")
        .delete()
        .eq("id", id)
        .eq("user_id", this.user.id);
      if (error) throw error;
    }
    const profile = this.profiles.find((p) => p.id === id);
    if (profile) localStorage.removeItem(this.cacheKey(profile));
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (!this.user) write("primetv:v2:guest-profiles", this.profiles);
    if (this.profile?.id === id) {
      this.epoch++;
      this.profile = null;
      this.records = [];
      this.pending.clear();
    }
    this.emit();
  }
  get(item) {
    return this.records.find(
      (r) => `${r.media_type}:${r.media_id}` === keyOf(item),
    );
  }
  update(item, patch) {
    if (!this.profile) throw new Error("Choose a profile first.");
    const key = keyOf(item),
      old = this.get(item);
    const record = {
      media_id: item.id,
      media_type: item.media_type,
      position: 0,
      duration: 0,
      season: 1,
      episode: 1,
      rating: 0,
      in_list: false,
      completed: false,
      ...old,
      ...patch,
      item: normalize(item),
      profile_id: this.profile.id,
      updated_at: new Date().toISOString(),
    };
    if (this.user) record.user_id = this.user.id;
    this.records = [
      record,
      ...this.records.filter((r) => `${r.media_type}:${r.media_id}` !== key),
    ];
    if (this.user) this.pending.set(key, record);
    this.persist();
    this.emit();
    void this.flush();
    return record;
  }
  async flush() {
    if (!this.user || !this.profile || !this.pending.size) return;
    if (this.syncing) {
      await this.syncing;
      return this.flush();
    }
    if (!navigator.onLine) {
      this.status = "offline";
      this.emit();
      return;
    }
    const epoch = this.epoch,
      batch = [...this.pending];
    this.status = "saving";
    this.emit();
    this.syncing = (async () => {
      try {
        const { error } = await this.client.from("primetv_activity").upsert(
          batch.map(([, r]) => r),
          { onConflict: "profile_id,media_type,media_id" },
        );
        if (error) throw error;
        if (epoch !== this.epoch) return;
        for (const [key, r] of batch)
          if (this.pending.get(key) === r) this.pending.delete(key);
        this.status = "synced";
        this.persist();
      } catch {
        if (epoch === this.epoch) this.status = "error";
      } finally {
        this.syncing = null;
        this.emit();
      }
    })();
    await this.syncing;
    if (this.status === "synced" && this.pending.size) return this.flush();
  }
  async signOut() {
    await this.flush();
    if (this.pending.size)
      throw new Error(
        "Your latest changes haven’t synced. Reconnect and try again.",
      );
    const user = this.user;
    if (user) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key?.startsWith(`primetv:v2:${user.id}:`) &&
          read(key, {}).pending?.length
        ) {
          throw new Error(
            "Another profile has unsynced changes. Open that profile while online before signing out.",
          );
        }
      }
    }
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    if (user)
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(`primetv:v2:${user.id}:`)) localStorage.removeItem(k);
      }
  }
}
