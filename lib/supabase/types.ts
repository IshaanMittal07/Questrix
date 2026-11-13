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
      profiles: {
        Row: {
          bio: string | null;
          created_at: string;
          current_streak: number;
          display_name: string | null;
          id: string;
          is_private: boolean;
          last_streak_date: string | null;
          lifetime_points: number;
          longest_streak: number;
          onboarded_at: string | null;
          points_balance: number;
          streak_freezes: number;
          streak_run_started: string | null;
          timezone: string;
          username: string;
        };
        ComputedFields: never;
        Insert: {
          bio?: string | null;
          created_at?: string;
          current_streak?: number;
          display_name?: string | null;
          id: string;
          is_private?: boolean;
          last_streak_date?: string | null;
          lifetime_points?: number;
          longest_streak?: number;
          onboarded_at?: string | null;
          points_balance?: number;
          streak_freezes?: number;
          streak_run_started?: string | null;
          timezone?: string;
          username: string;
        };
        Update: {
          bio?: string | null;
          created_at?: string;
          current_streak?: number;
          display_name?: string | null;
          id?: string;
          is_private?: boolean;
          last_streak_date?: string | null;
          lifetime_points?: number;
          longest_streak?: number;
          onboarded_at?: string | null;
          points_balance?: number;
          streak_freezes?: number;
          streak_run_started?: string | null;
          timezone?: string;
          username?: string;
        };
        Relationships: [];
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
      equip_item: {
        Args: { p_item_id: string; p_slot: string };
        Returns: undefined;
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
