export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      advert_bookings: {
        Row: {
          advert_id: string
          bundle_id: string | null
          created_at: string
          ends_on: string
          id: string
          notes: string | null
          starts_on: string
        }
        Insert: {
          advert_id: string
          bundle_id?: string | null
          created_at?: string
          ends_on: string
          id?: string
          notes?: string | null
          starts_on: string
        }
        Update: {
          advert_id?: string
          bundle_id?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          notes?: string | null
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "advert_bookings_advert_id_fkey"
            columns: ["advert_id"]
            isOneToOne: false
            referencedRelation: "adverts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advert_bookings_bundle_fk"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "bundles"
            referencedColumns: ["id"]
          },
        ]
      }
      advert_slots: {
        Row: {
          cap: number
          key: string
          label: string
        }
        Insert: {
          cap?: number
          key: string
          label: string
        }
        Update: {
          cap?: number
          key?: string
          label?: string
        }
        Relationships: []
      }
      advertisers: {
        Row: {
          contact_email: string | null
          created_at: string
          id: string
          member_id: string | null
          name: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          id?: string
          member_id?: string | null
          name: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          id?: string
          member_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "advertisers_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      adverts: {
        Row: {
          advertiser_id: string
          created_at: string
          desktop_path: string
          format: string
          id: string
          link_url: string | null
          mobile_path: string
          name: string
        }
        Insert: {
          advertiser_id: string
          created_at?: string
          desktop_path: string
          format?: string
          id?: string
          link_url?: string | null
          mobile_path: string
          name: string
        }
        Update: {
          advertiser_id?: string
          created_at?: string
          desktop_path?: string
          format?: string
          id?: string
          link_url?: string | null
          mobile_path?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "adverts_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          referrer: string | null
          region: string | null
          session_hash: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind?: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_05: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          referrer: string | null
          region: string | null
          session_hash: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind?: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_06: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          referrer: string | null
          region: string | null
          session_hash: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind?: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_07: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          referrer: string | null
          region: string | null
          session_hash: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind?: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_08: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          referrer: string | null
          region: string | null
          session_hash: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind?: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_09: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          referrer: string | null
          region: string | null
          session_hash: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          company?: string | null
          id?: never
          kind?: string
          member_id?: string | null
          occurred_at?: string
          path?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      approvals: {
        Row: {
          decided_at: string
          decided_by: string | null
          decision: string
          id: string
          kind: string
          reason: string | null
          subject_id: string
        }
        Insert: {
          decided_at?: string
          decided_by?: string | null
          decision: string
          id?: string
          kind: string
          reason?: string | null
          subject_id: string
        }
        Update: {
          decided_at?: string
          decided_by?: string | null
          decision?: string
          id?: string
          kind?: string
          reason?: string | null
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bundles: {
        Row: {
          advertiser_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          price_pennies: number | null
        }
        Insert: {
          advertiser_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          price_pennies?: number | null
        }
        Update: {
          advertiser_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          price_pennies?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bundles_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          id: number
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          slug: string
        }
        Insert: {
          id?: number
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          slug: string
        }
        Update: {
          id?: number
          kind?: Database["public"]["Enums"]["category_kind"]
          name?: string
          slug?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          bigin_id: string | null
          company: string | null
          created_at: string
          email: string
          id: string
          last_synced_at: string | null
          member_id: string | null
          name: string | null
          social: Json
          source: string | null
          subscribed: boolean
          unsubscribed_at: string | null
        }
        Insert: {
          bigin_id?: string | null
          company?: string | null
          created_at?: string
          email: string
          id?: string
          last_synced_at?: string | null
          member_id?: string | null
          name?: string | null
          social?: Json
          source?: string | null
          subscribed?: boolean
          unsubscribed_at?: string | null
        }
        Update: {
          bigin_id?: string | null
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          last_synced_at?: string | null
          member_id?: string | null
          name?: string | null
          social?: Json
          source?: string | null
          subscribed?: boolean
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_audit: {
        Row: {
          company: string | null
          id: string
          member_id: string
          occurred_on: string
          page: string | null
          region: string | null
          views: number
        }
        Insert: {
          company?: string | null
          id?: string
          member_id: string
          occurred_on: string
          page?: string | null
          region?: string | null
          views?: number
        }
        Update: {
          company?: string | null
          id?: string
          member_id?: string
          occurred_on?: string
          page?: string | null
          region?: string | null
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "engagement_audit_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cover_path: string | null
          created_at: string
          description: string | null
          ends_on: string | null
          id: string
          link: string | null
          location: string | null
          member_id: string | null
          slug: string
          starts_on: string
          status: Database["public"]["Enums"]["content_status"]
          title: string
        }
        Insert: {
          cover_path?: string | null
          created_at?: string
          description?: string | null
          ends_on?: string | null
          id?: string
          link?: string | null
          location?: string | null
          member_id?: string | null
          slug: string
          starts_on: string
          status?: Database["public"]["Enums"]["content_status"]
          title: string
        }
        Update: {
          cover_path?: string | null
          created_at?: string
          description?: string | null
          ends_on?: string | null
          id?: string
          link?: string | null
          location?: string | null
          member_id?: string | null
          slug?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      featured_machines: {
        Row: {
          created_at: string
          description: string | null
          external_url: string | null
          id: string
          image_path: string | null
          member_id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          external_url?: string | null
          id?: string
          image_path?: string | null
          member_id: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          external_url?: string | null
          id?: string
          image_path?: string | null
          member_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "featured_machines_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          kind: string
          message: string
          name: string
          read: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          kind: string
          message: string
          name: string
          read?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          kind?: string
          message?: string
          name?: string
          read?: boolean
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_pennies: number
          created_at: string
          id: string
          issued_on: string
          member_id: string
          number: string
          pdf_path: string | null
          status: string
        }
        Insert: {
          amount_pennies: number
          created_at?: string
          id?: string
          issued_on: string
          member_id: string
          number: string
          pdf_path?: string | null
          status?: string
        }
        Update: {
          amount_pennies?: number
          created_at?: string
          id?: string
          issued_on?: string
          member_id?: string
          number?: string
          pdf_path?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          due_at: string
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          due_at?: string
          id?: string
          kind: string
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          due_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      member_revisions: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          member_id: string
          payload: Json
          rejected_reason: string | null
          status: Database["public"]["Enums"]["content_status"]
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          member_id: string
          payload: Json
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          member_id?: string
          payload?: Json
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["content_status"]
        }
        Relationships: [
          {
            foreignKeyName: "member_revisions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          address: string | null
          billing_mode: string
          category_id: number | null
          created_at: string
          description: string | null
          grace_until: string | null
          hero_path: string | null
          id: string
          joined_at: string | null
          lat: number | null
          lng: number | null
          logo_path: string | null
          name: string
          phone: string | null
          search_tsv: unknown
          slug: string
          social: Json
          status: Database["public"]["Enums"]["member_status"]
          stripe_customer_id: string | null
          testimonials: Json
          video_url: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          billing_mode?: string
          category_id?: number | null
          created_at?: string
          description?: string | null
          grace_until?: string | null
          hero_path?: string | null
          id?: string
          joined_at?: string | null
          lat?: number | null
          lng?: number | null
          logo_path?: string | null
          name: string
          phone?: string | null
          search_tsv?: unknown
          slug: string
          social?: Json
          status?: Database["public"]["Enums"]["member_status"]
          stripe_customer_id?: string | null
          testimonials?: Json
          video_url?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          billing_mode?: string
          category_id?: number | null
          created_at?: string
          description?: string | null
          grace_until?: string | null
          hero_path?: string | null
          id?: string
          joined_at?: string | null
          lat?: number | null
          lng?: number | null
          logo_path?: string | null
          name?: string
          phone?: string | null
          search_tsv?: unknown
          slug?: string
          social?: Json
          status?: Database["public"]["Enums"]["member_status"]
          stripe_customer_id?: string | null
          testimonials?: Json
          video_url?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_ads: {
        Row: {
          advert_id: string
          issue_id: string
          position: number
        }
        Insert: {
          advert_id: string
          issue_id: string
          position: number
        }
        Update: {
          advert_id?: string
          issue_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_ads_advert_id_fkey"
            columns: ["advert_id"]
            isOneToOne: false
            referencedRelation: "adverts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_ads_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "newsletter_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_issues: {
        Row: {
          created_at: string
          id: string
          intro: string | null
          number: number
          sent_at: string | null
          status: string
          subject: string
          web_slug: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          intro?: string | null
          number: number
          sent_at?: string | null
          status?: string
          subject: string
          web_slug?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          intro?: string | null
          number?: number
          sent_at?: string | null
          status?: string
          subject?: string
          web_slug?: string | null
        }
        Relationships: []
      }
      newsletter_items: {
        Row: {
          issue_id: string
          position: number
          story_id: string
        }
        Insert: {
          issue_id: string
          position: number
          story_id: string
        }
        Update: {
          issue_id?: string
          position?: number
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_items_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "newsletter_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_items_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_signups: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          leads_frequency: string
          member_id: string
          stats_frequency: string
        }
        Insert: {
          leads_frequency?: string
          member_id: string
          stats_frequency?: string
        }
        Update: {
          leads_frequency?: string
          member_id?: string
          stats_frequency?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          emailed_at: string | null
          id: string
          kind: string
          member_id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind: string
          member_id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind?: string
          member_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      placements: {
        Row: {
          config: Json
          created_at: string
          ends_on: string
          featured_machine_id: string | null
          grid_position: number | null
          id: string
          kind: Database["public"]["Enums"]["placement_kind"]
          member_id: string | null
          starts_on: string
        }
        Insert: {
          config?: Json
          created_at?: string
          ends_on: string
          featured_machine_id?: string | null
          grid_position?: number | null
          id?: string
          kind: Database["public"]["Enums"]["placement_kind"]
          member_id?: string | null
          starts_on: string
        }
        Update: {
          config?: Json
          created_at?: string
          ends_on?: string
          featured_machine_id?: string | null
          grid_position?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["placement_kind"]
          member_id?: string | null
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "placements_featured_machine_id_fkey"
            columns: ["featured_machine_id"]
            isOneToOne: false
            referencedRelation: "featured_machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          member_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          member_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          member_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      redirects: {
        Row: {
          from_path: string
          status_code: number
          to_path: string
        }
        Insert: {
          from_path: string
          status_code?: number
          to_path: string
        }
        Update: {
          from_path?: string
          status_code?: number
          to_path?: string
        }
        Relationships: []
      }
      rollups_daily: {
        Row: {
          advert_id: string | null
          count: number
          day: string
          kind: string
          member_id: string | null
          story_id: string | null
        }
        Insert: {
          advert_id?: string | null
          count?: number
          day: string
          kind: string
          member_id?: string | null
          story_id?: string | null
        }
        Update: {
          advert_id?: string | null
          count?: number
          day?: string
          kind?: string
          member_id?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      static_pages: {
        Row: {
          body: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          body: string
          cover_focus: Json | null
          cover_path: string | null
          created_at: string
          excerpt: string | null
          id: string
          is_member_news: boolean
          member_id: string | null
          pinned_until: string | null
          published_at: string | null
          rejected_reason: string | null
          scheduled_at: string | null
          search_tsv: unknown
          slug: string
          source: string
          status: Database["public"]["Enums"]["content_status"]
          submitted_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          cover_focus?: Json | null
          cover_path?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          is_member_news?: boolean
          member_id?: string | null
          pinned_until?: string | null
          published_at?: string | null
          rejected_reason?: string | null
          scheduled_at?: string | null
          search_tsv?: unknown
          slug: string
          source?: string
          status?: Database["public"]["Enums"]["content_status"]
          submitted_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          cover_focus?: Json | null
          cover_path?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          is_member_news?: boolean
          member_id?: string | null
          pinned_until?: string | null
          published_at?: string | null
          rejected_reason?: string | null
          scheduled_at?: string | null
          search_tsv?: unknown
          slug?: string
          source?: string
          status?: Database["public"]["Enums"]["content_status"]
          submitted_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stories_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      story_categories: {
        Row: {
          category_id: number
          story_id: string
        }
        Insert: {
          category_id: number
          story_id: string
        }
        Update: {
          category_id?: number
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_categories_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          created_at: string
          id: string
          member_id: string | null
          published_at: string | null
          source: string
          status: Database["public"]["Enums"]["content_status"]
          thumbnail_path: string | null
          title: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id?: string | null
          published_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["content_status"]
          thumbnail_path?: string | null
          title: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string | null
          published_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["content_status"]
          thumbnail_path?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      visibility_requests: {
        Row: {
          created_at: string
          id: string
          member_id: string
          message: string | null
          product: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          message?: string | null
          product: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          message?: string | null
          product?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "visibility_requests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_member_id: { Args: never; Returns: string }
      ensure_analytics_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      run_daily_rollup: { Args: never; Returns: undefined }
    }
    Enums: {
      category_kind: "story" | "member"
      content_status:
        | "draft"
        | "awaiting_approval"
        | "scheduled"
        | "published"
        | "rejected"
      member_status: "draft" | "active" | "grace" | "lapsed"
      placement_kind:
        | "featured_member"
        | "featured_machine"
        | "grid_block"
        | "takeover"
      user_role: "super_admin" | "approver" | "viewer" | "input_only" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      category_kind: ["story", "member"],
      content_status: [
        "draft",
        "awaiting_approval",
        "scheduled",
        "published",
        "rejected",
      ],
      member_status: ["draft", "active", "grace", "lapsed"],
      placement_kind: [
        "featured_member",
        "featured_machine",
        "grid_block",
        "takeover",
      ],
      user_role: ["super_admin", "approver", "viewer", "input_only", "member"],
    },
  },
} as const

