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
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          post_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          post_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          post_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
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
      follows: {
        Row: {
          created_at: string;
          followee_id: string;
          follower_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          followee_id: string;
          follower_id: string;
        };
        Update: {
          created_at?: string;
          followee_id?: string;
          follower_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey";
            columns: ["followee_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "follows_followee_id_fkey";
            columns: ["followee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_followee_id_fkey";
            columns: ["followee_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
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
      notifications_inbox: {
        Row: {
          created_at: string;
          id: string;
          payload: NonNullable<Json>;
          read_at: string | null;
          type: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          payload?: NonNullable<Json>;
          read_at?: string | null;
          type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          payload?: NonNullable<Json>;
          read_at?: string | null;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_inbox_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "notifications_inbox_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_inbox_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
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
      post_likes: {
        Row: {
          created_at: string;
          post_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "post_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          attachment: Json | null;
          author_id: string;
          body: string;
          comment_count: number;
          created_at: string;
          deleted_at: string | null;
          id: string;
          like_count: number;
        };
        ComputedFields: never;
        Insert: {
          attachment?: Json | null;
          author_id: string;
          body: string;
          comment_count?: number;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          like_count?: number;
        };
        Update: {
          attachment?: Json | null;
          author_id?: string;
          body?: string;
          comment_count?: number;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          like_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
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
      reports: {
        Row: {
          created_at: string;
          id: string;
          reason: string;
          reporter_id: string;
          status: Database["public"]["Enums"]["report_status"];
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          reason?: string;
          reporter_id: string;
          status?: Database["public"]["Enums"]["report_status"];
          target_id: string;
          target_type: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          reason?: string;
          reporter_id?: string;
          status?: Database["public"]["Enums"]["report_status"];
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_events: {
        Row: {
          created_at: string;
          id: number;
          kind: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: never;
          kind: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          kind?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "social_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_events_user_id_fkey";
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
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
      streak_saver_log: {
        Row: {
          local_date: string;
          sent_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          local_date: string;
          sent_at?: string;
          user_id: string;
        };
        Update: {
          local_date?: string;
          sent_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "streak_saver_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "streak_saver_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "streak_saver_log_user_id_fkey";
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
            referencedRelation: "leaderboard_weekly";
            referencedColumns: ["user_id"];
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
      leaderboard_weekly: {
        Row: {
          display_name: string | null;
          user_id: string;
          username: string;
          week_points: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
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
      cleanup_push_logs: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      cleanup_social_events: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      complete_habit: { Args: { p_habit_id: string }; Returns: Json };
      complete_habit_at: {
        Args: { p_habit_id: string; p_now: string; p_uid: string };
        Returns: Json;
      };
      create_comment: {
        Args: { p_body: string; p_post_id: string };
        Returns: string;
      };
      create_post: {
        Args: { p_attach_summary?: boolean; p_body: string };
        Returns: string;
      };
      delete_comment: { Args: { p_comment_id: string }; Returns: undefined };
      delete_post: { Args: { p_post_id: string }; Returns: undefined };
      due_reminders: {
        Args: { p_limit?: number; p_now: string };
        Returns: {
          category: string;
          habit_id: string;
          icon: string;
          local_date: string;
          points: number;
          reminder_time: string;
          streak: number;
          subscriptions: Json;
          title: string;
          user_id: string;
        }[];
      };
      due_streak_savers: {
        Args: { p_now: string };
        Returns: {
          local_date: string;
          streak: number;
          subscriptions: Json;
          user_id: string;
        }[];
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
      get_feed: {
        Args: {
          p_author?: string;
          p_before_created?: string;
          p_before_id?: string;
          p_limit?: number;
          p_tab?: string;
        };
        Returns: Json;
      };
      get_leaderboard: { Args: { p_scope?: string }; Returns: Json };
      get_public_profile: { Args: { p_username: string }; Returns: Json };
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
      invoke_reminders: { Args: Record<PropertyKey, never>; Returns: number };
      is_blocked_between: { Args: { a: string; b: string }; Returns: boolean };
      is_blocked_with_me: { Args: { p_other: string }; Returns: boolean };
      is_reserved_username: { Args: { p_username: string }; Returns: boolean };
      jsonb_num_between: {
        Args: { hi: number; lo: number; v: Json; whole: boolean };
        Returns: boolean;
      };
      level_for: { Args: { p_lifetime: number }; Returns: number };
      local_date_in: { Args: { p_at: string; p_tz: string }; Returns: string };
      my_blocked_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          user_id: string;
          username: string;
        }[];
      };
      notify: {
        Args: {
          p_actor: string;
          p_payload: Json;
          p_type: string;
          p_user: string;
        };
        Returns: undefined;
      };
      popular_templates_among_following: {
        Args: Record<PropertyKey, never>;
        Returns: {
          followers_using: number;
          template_key: string;
        }[];
      };
      purchase_item: { Args: { p_item_id: string }; Returns: Json };
      refresh_leaderboard: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      reorder_habits: { Args: { p_habit_ids: string[] }; Returns: undefined };
      report_content: {
        Args: { p_reason?: string; p_target_id: string; p_target_type: string };
        Returns: undefined;
      };
      require_onboarded: { Args: { p_uid: string }; Returns: undefined };
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
      social_event: {
        Args: {
          p_kind: string;
          p_limit: number;
          p_uid: string;
          p_window: string;
        };
        Returns: undefined;
      };
      social_limit: { Args: { p_kind: string }; Returns: number };
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
      text_is_clean: { Args: { p_text: string }; Returns: boolean };
      unarchive_habit: { Args: { p_habit_id: string }; Returns: undefined };
      undo_completion: { Args: { p_completion_id: string }; Returns: Json };
      undo_completion_at: {
        Args: { p_completion_id: string; p_now: string; p_uid: string };
        Returns: Json;
      };
      username_available: { Args: { p_username: string }; Returns: boolean };
      weekly_summary: { Args: { p_uid: string }; Returns: Json };
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
