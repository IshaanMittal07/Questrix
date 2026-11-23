export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      daily_progress: {
        Row: {
          completed_count: number;
          counted_for_streak: boolean;
          last_streak_date_before: string | null;
          local_date: string;
          longest_streak_before: number | null;
          streak_before: number | null;
          streak_freezes_before: number | null;
          streak_freezes_used: number;
          streak_run_started_before: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          completed_count?: number;
          counted_for_streak?: boolean;
          last_streak_date_before?: string | null;
          local_date: string;
          longest_streak_before?: number | null;
          streak_before?: number | null;
          streak_freezes_before?: number | null;
          streak_freezes_used?: number;
          streak_run_started_before?: string | null;
          user_id: string;
        };
        Update: {
          completed_count?: number;
          counted_for_streak?: boolean;
          last_streak_date_before?: string | null;
          local_date?: string;
          longest_streak_before?: number | null;
          streak_before?: number | null;
          streak_freezes_before?: number | null;
          streak_freezes_used?: number;
          streak_run_started_before?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_progress_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_progress_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_schedule: {
        Row: {
          created_at: string;
          local_date: string;
          scheduled_count: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          local_date: string;
          scheduled_count?: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          local_date?: string;
          scheduled_count?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_schedule_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_schedule_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_schedule_habits: {
        Row: {
          added_at: string;
          difficulty: Database["public"]["Enums"]["habit_difficulty"];
          habit_id: string;
          initial: boolean;
          local_date: string;
          target_per_day: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_at?: string;
          difficulty: Database["public"]["Enums"]["habit_difficulty"];
          habit_id: string;
          initial?: boolean;
          local_date: string;
          target_per_day: number;
          user_id: string;
        };
        Update: {
          added_at?: string;
          difficulty?: Database["public"]["Enums"]["habit_difficulty"];
          habit_id?: string;
          initial?: boolean;
          local_date?: string;
          target_per_day?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_schedule_habits_habit_id_user_id_fkey";
            columns: ["habit_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "habits";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "daily_schedule_habits_user_id_local_date_fkey";
            columns: ["user_id", "local_date"];
            isOneToOne: false;
            referencedRelation: "daily_schedule";
            referencedColumns: ["user_id", "local_date"];
          },
        ];
      };
      economy_config: {
        Row: {
          key: string;
          updated_at: string;
          value: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          key: string;
          updated_at?: string;
          value: NonNullable<Json>;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: NonNullable<Json>;
        };
        Relationships: [];
      };
      equipped_cosmetics: {
        Row: {
          accessory_id: string | null;
          avatar_base_id: string | null;
          background_id: string | null;
          border_id: string | null;
          name_color_id: string | null;
          name_style_id: string | null;
          outfit_id: string | null;
          title_id: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          accessory_id?: string | null;
          avatar_base_id?: string | null;
          background_id?: string | null;
          border_id?: string | null;
          name_color_id?: string | null;
          name_style_id?: string | null;
          outfit_id?: string | null;
          title_id?: string | null;
          user_id: string;
        };
        Update: {
          accessory_id?: string | null;
          avatar_base_id?: string | null;
          background_id?: string | null;
          border_id?: string | null;
          name_color_id?: string | null;
          name_style_id?: string | null;
          outfit_id?: string | null;
          title_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "equipped_cosmetics_accessory_id_fkey";
            columns: ["accessory_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_avatar_base_id_fkey";
            columns: ["avatar_base_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_background_id_fkey";
            columns: ["background_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_border_id_fkey";
            columns: ["border_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_name_color_id_fkey";
            columns: ["name_color_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_name_style_id_fkey";
            columns: ["name_style_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_outfit_id_fkey";
            columns: ["outfit_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_title_id_fkey";
            columns: ["title_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equipped_cosmetics_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      habit_completions: {
        Row: {
          base_points: number;
          completed_at: string;
          habit_current_before: number | null;
          habit_id: string;
          habit_last_date_before: string | null;
          habit_longest_before: number | null;
          id: string;
          local_date: string;
          multiplier: number;
          occurrence: number;
          points_awarded: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          base_points: number;
          completed_at?: string;
          habit_current_before?: number | null;
          habit_id: string;
          habit_last_date_before?: string | null;
          habit_longest_before?: number | null;
          id?: string;
          local_date: string;
          multiplier: number;
          occurrence: number;
          points_awarded: number;
          user_id: string;
        };
        Update: {
          base_points?: number;
          completed_at?: string;
          habit_current_before?: number | null;
          habit_id?: string;
          habit_last_date_before?: string | null;
          habit_longest_before?: number | null;
          id?: string;
          local_date?: string;
          multiplier?: number;
          occurrence?: number;
          points_awarded?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "habit_completions_habit_id_user_id_fkey";
            columns: ["habit_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "habits";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "habit_completions_user_id_local_date_habit_id_fkey";
            columns: ["user_id", "local_date", "habit_id"];
            isOneToOne: false;
            referencedRelation: "daily_schedule_habits";
            referencedColumns: ["user_id", "local_date", "habit_id"];
          },
        ];
      };
      habit_streaks: {
        Row: {
          current: number;
          habit_id: string;
          last_date: string | null;
          longest: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          current?: number;
          habit_id: string;
          last_date?: string | null;
          longest?: number;
          user_id: string;
        };
        Update: {
          current?: number;
          habit_id?: string;
          last_date?: string | null;
          longest?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "habit_streaks_habit_id_user_id_fkey";
            columns: ["habit_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "habits";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      habits: {
        Row: {
          archived_at: string | null;
          category: Database["public"]["Enums"]["habit_category"];
          color: string | null;
          created_at: string;
          days_of_week: number[];
          description: string | null;
          difficulty: Database["public"]["Enums"]["habit_difficulty"];
          icon: string | null;
          id: string;
          reminder_times: string[];
          reminders_enabled: boolean;
          sort_order: number;
          target_per_day: number;
          template_key: string | null;
          title: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          category: Database["public"]["Enums"]["habit_category"];
          color?: string | null;
          created_at?: string;
          days_of_week?: number[];
          description?: string | null;
          difficulty?: Database["public"]["Enums"]["habit_difficulty"];
          icon?: string | null;
          id?: string;
          reminder_times?: string[];
          reminders_enabled?: boolean;
          sort_order?: number;
          target_per_day?: number;
          template_key?: string | null;
          title: string;
          user_id?: string;
        };
        Update: {
          archived_at?: string | null;
          category?: Database["public"]["Enums"]["habit_category"];
          color?: string | null;
          created_at?: string;
          days_of_week?: number[];
          description?: string | null;
          difficulty?: Database["public"]["Enums"]["habit_difficulty"];
          icon?: string | null;
          id?: string;
          reminder_times?: string[];
          reminders_enabled?: boolean;
          sort_order?: number;
          target_per_day?: number;
          template_key?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "habits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "habits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      items: {
        Row: {
          asset: NonNullable<Json>;
          category: Database["public"]["Enums"]["item_category"];
          description: string | null;
          id: string;
          is_active: boolean;
          is_default: boolean;
          level_required: number;
          name: string;
          price: number;
          rarity: Database["public"]["Enums"]["item_rarity"];
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          asset?: NonNullable<Json>;
          category: Database["public"]["Enums"]["item_category"];
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          level_required?: number;
          name: string;
          price?: number;
          rarity?: Database["public"]["Enums"]["item_rarity"];
          slug: string;
        };
        Update: {
          asset?: NonNullable<Json>;
          category?: Database["public"]["Enums"]["item_category"];
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          level_required?: number;
          name?: string;
          price?: number;
          rarity?: Database["public"]["Enums"]["item_rarity"];
          slug?: string;
        };
        Relationships: [];
      };
      points_ledger: {
        Row: {
          created_at: string;
          delta: number;
          id: number;
          reason: Database["public"]["Enums"]["ledger_reason"];
          ref_id: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          delta: number;
          id?: never;
          reason: Database["public"]["Enums"]["ledger_reason"];
          ref_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          delta?: number;
          id?: never;
          reason?: Database["public"]["Enums"]["ledger_reason"];
          ref_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "points_ledger_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "points_ledger_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          bio: string | null;
          created_at: string;
          current_streak: number;
          display_name: string | null;
          engine_floor_date: string | null;
          id: string;
          is_private: boolean;
          last_streak_date: string | null;
          lifetime_points: number;
          longest_streak: number;
          onboarded_at: string | null;
          points_balance: number;
          push_enabled: boolean;
          streak_freezes: number;
          streak_run_started: string | null;
          streak_saver_enabled: boolean;
          timezone: string;
          timezone_changed_at: string | null;
          username: string;
        };
        ComputedFields: never;
        Insert: {
          bio?: string | null;
          created_at?: string;
          current_streak?: number;
          display_name?: string | null;
          engine_floor_date?: string | null;
          id: string;
          is_private?: boolean;
          last_streak_date?: string | null;
          lifetime_points?: number;
          longest_streak?: number;
          onboarded_at?: string | null;
          points_balance?: number;
          push_enabled?: boolean;
          streak_freezes?: number;
          streak_run_started?: string | null;
          streak_saver_enabled?: boolean;
          timezone?: string;
          timezone_changed_at?: string | null;
          username: string;
        };
        Update: {
          bio?: string | null;
          created_at?: string;
          current_streak?: number;
          display_name?: string | null;
          engine_floor_date?: string | null;
          id?: string;
          is_private?: boolean;
          last_streak_date?: string | null;
          lifetime_points?: number;
          longest_streak?: number;
          onboarded_at?: string | null;
          points_balance?: number;
          push_enabled?: boolean;
          streak_freezes?: number;
          streak_run_started?: string | null;
          streak_saver_enabled?: boolean;
          timezone?: string;
          timezone_changed_at?: string | null;
          username?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_success_at: string | null;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_success_at?: string | null;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_success_at?: string | null;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_log: {
        Row: {
          habit_id: string;
          local_date: string;
          reminder_time: string;
          sent_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          habit_id: string;
          local_date: string;
          reminder_time: string;
          sent_at?: string;
          user_id: string;
        };
        Update: {
          habit_id?: string;
          local_date?: string;
          reminder_time?: string;
          sent_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminder_log_habit_id_fkey";
            columns: ["habit_id"];
            isOneToOne: false;
            referencedRelation: "habits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      streak_milestones_awarded: {
        Row: {
          awarded_on: string;
          created_at: string;
          id: string;
          milestone: number;
          points: number;
          streak_run_started: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          awarded_on: string;
          created_at?: string;
          id?: string;
          milestone: number;
          points: number;
          streak_run_started: string;
          user_id: string;
        };
        Update: {
          awarded_on?: string;
          created_at?: string;
          id?: string;
          milestone?: number;
          points?: number;
          streak_run_started?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "streak_milestones_awarded_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "streak_milestones_awarded_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_items: {
        Row: {
          acquired_at: string;
          item_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          acquired_at?: string;
          item_id: string;
          user_id: string;
        };
        Update: {
          acquired_at?: string;
          item_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_items_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          bio: string | null;
          created_at: string;
          current_streak: number | null;
          display_name: string | null;
          id: string;
          is_private: boolean;
          lifetime_points: number | null;
          longest_streak: number | null;
          username: string;
        };
        ComputedFields: never;
        Insert: {
          bio?: string | null;
          created_at?: string | null;
          current_streak?: never;
          display_name?: string | null;
          id?: string | null;
          is_private?: boolean | null;
          lifetime_points?: never;
          longest_streak?: never;
          username?: string | null;
        };
        Update: {
          bio?: string | null;
          created_at?: string | null;
          current_streak?: never;
          display_name?: string | null;
          id?: string | null;
          is_private?: boolean | null;
          lifetime_points?: never;
          longest_streak?: never;
          username?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      archive_habit: { Args: { p_habit_id: string }; Returns: undefined };
      complete_habit: { Args: { p_habit_id: string }; Returns: Json };
      complete_habit_at: {
        Args: { p_habit_id: string; p_now: string; p_uid: string };
        Returns: Json;
      };
      economy_config_value_valid: {
        Args: { p_key: string; value: Json };
        Returns: boolean;
      };
      economy_value: { Args: { p_key: string }; Returns: Json };
      ensure_daily_schedule: {
        Args: { p_now: string; p_uid: string };
        Returns: string;
      };
      equip_item: {
        Args: { p_item_id: string; p_slot: string };
        Returns: undefined;
      };
      get_today: { Args: Record<PropertyKey, never>; Returns: Json };
      get_today_at: { Args: { p_now: string; p_uid: string }; Returns: Json };
      habit_missed_days: {
        Args: {
          p_from: string;
          p_habit_id: string;
          p_to: string;
          p_uid: string;
        };
        Returns: number;
      };
      habits_clean_text: { Args: { p_text: string }; Returns: string };
      habits_lock: { Args: { p_user_id: string }; Returns: undefined };
      is_reserved_username: { Args: { p_username: string }; Returns: boolean };
      jsonb_num_between: {
        Args: { hi: number; lo: number; v: Json; whole: boolean };
        Returns: boolean;
      };
      level_for: { Args: { p_lifetime: number }; Returns: number };
      local_date_in: { Args: { p_at: string; p_tz: string }; Returns: string };
      reorder_habits: { Args: { p_habit_ids: string[] }; Returns: undefined };
      save_push_subscription: {
        Args: {
          p_auth: string;
          p_endpoint: string;
          p_p256dh: string;
          p_user_agent?: string;
        };
        Returns: string;
      };
      snapshot_add_habit: {
        Args: { p_habit_id: string; p_now: string; p_uid: string };
        Returns: undefined;
      };
      streak_as_of: {
        Args: {
          p_freezes: number;
          p_last: string;
          p_ref: string;
          p_streak: number;
          p_uid: string;
        };
        Returns: number;
      };
      streak_missed_days: {
        Args: { p_from: string; p_to: string; p_uid: string };
        Returns: number;
      };
      unarchive_habit: { Args: { p_habit_id: string }; Returns: undefined };
      undo_completion: { Args: { p_completion_id: string }; Returns: Json };
      undo_completion_at: {
        Args: { p_completion_id: string; p_now: string; p_uid: string };
        Returns: Json;
      };
      username_available: { Args: { p_username: string }; Returns: boolean };
    };
    Enums: {
      habit_category:
        | "health"
        | "fitness"
        | "mind"
        | "learning"
        | "career"
        | "self_care"
        | "nutrition"
        | "finance"
        | "social"
        | "other";
      habit_difficulty: "easy" | "medium" | "hard";
      item_category:
        | "avatar_base"
        | "outfit"
        | "accessory"
        | "name_color"
        | "name_style"
        | "title"
        | "background"
        | "border"
        | "consumable";
      item_rarity: "common" | "rare" | "epic" | "legendary";
      ledger_reason:
        | "completion"
        | "streak_milestone"
        | "purchase"
        | "undo"
        | "admin_adjust"
        | "refund";
      report_status: "open" | "actioned" | "dismissed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      habit_category: [
        "health",
        "fitness",
        "mind",
        "learning",
        "career",
        "self_care",
        "nutrition",
        "finance",
        "social",
        "other",
      ],
      habit_difficulty: ["easy", "medium", "hard"],
      item_category: [
        "avatar_base",
        "outfit",
        "accessory",
        "name_color",
        "name_style",
        "title",
        "background",
        "border",
        "consumable",
      ],
      item_rarity: ["common", "rare", "epic", "legendary"],
      ledger_reason: [
        "completion",
        "streak_milestone",
        "purchase",
        "undo",
        "admin_adjust",
        "refund",
      ],
      report_status: ["open", "actioned", "dismissed"],
    },
  },
} as const;
