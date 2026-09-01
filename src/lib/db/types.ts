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
      advert_artwork_proposals: {
        Row: {
          advert_id: string
          decided_at: string | null
          decided_by: string | null
          desktop_path: string
          id: string
          mobile_path: string
          review_reason: string | null
          source: string
          status: string
          submitted_at: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          advert_id: string
          decided_at?: string | null
          decided_by?: string | null
          desktop_path: string
          id?: string
          mobile_path: string
          review_reason?: string | null
          source: string
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          advert_id?: string
          decided_at?: string | null
          decided_by?: string | null
          desktop_path?: string
          id?: string
          mobile_path?: string
          review_reason?: string | null
          source?: string
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advert_artwork_proposals_advert_id_fkey"
            columns: ["advert_id"]
            isOneToOne: false
            referencedRelation: "adverts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advert_artwork_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "advert_artwork_proposals_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      advert_bookings: {
        Row: {
          advert_id: string
          approved_at: string | null
          approved_by: string | null
          bundle_id: string | null
          created_at: string
          ended_at: string | null
          ended_by: string | null
          ended_note: string | null
          ended_notified_for: string | null
          ended_reason: string | null
          ending_soon_notified_for: string | null
          ends_on: string
          id: string
          notes: string | null
          product_id: string | null
          renewed_from: string | null
          review_reason: string | null
          source: string
          starts_on: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          went_live_at: string | null
        }
        Insert: {
          advert_id: string
          approved_at?: string | null
          approved_by?: string | null
          bundle_id?: string | null
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          ended_note?: string | null
          ended_notified_for?: string | null
          ended_reason?: string | null
          ending_soon_notified_for?: string | null
          ends_on: string
          id?: string
          notes?: string | null
          product_id?: string | null
          renewed_from?: string | null
          review_reason?: string | null
          source?: string
          starts_on: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          went_live_at?: string | null
        }
        Update: {
          advert_id?: string
          approved_at?: string | null
          approved_by?: string | null
          bundle_id?: string | null
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          ended_note?: string | null
          ended_notified_for?: string | null
          ended_reason?: string | null
          ending_soon_notified_for?: string | null
          ends_on?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          renewed_from?: string | null
          review_reason?: string | null
          source?: string
          starts_on?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          went_live_at?: string | null
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
            foreignKeyName: "advert_bookings_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "advert_bookings_bundle_fk"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advert_bookings_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "advert_bookings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "advert_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advert_bookings_renewed_from_fkey"
            columns: ["renewed_from"]
            isOneToOne: false
            referencedRelation: "advert_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advert_bookings_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      advert_products: {
        Row: {
          archived_at: string | null
          cap: number
          created_at: string
          description: string | null
          format: string
          id: string
          rate_pennies: number | null
          sample_path: string | null
          short_name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cap?: number
          created_at?: string
          description?: string | null
          format: string
          id?: string
          rate_pennies?: number | null
          sample_path?: string | null
          short_name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cap?: number
          created_at?: string
          description?: string | null
          format?: string
          id?: string
          rate_pennies?: number | null
          sample_path?: string | null
          short_name?: string
          updated_at?: string
        }
        Relationships: []
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
      adverts: {
        Row: {
          created_at: string
          desktop_path: string
          format: string
          id: string
          link_url: string | null
          member_id: string
          mobile_path: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          desktop_path: string
          format?: string
          id?: string
          link_url?: string | null
          member_id: string
          mobile_path: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          desktop_path?: string
          format?: string
          id?: string
          link_url?: string | null
          member_id?: string
          mobile_path?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "adverts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
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
          platform: string | null
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
          platform?: string | null
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
          platform?: string | null
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
          platform: string | null
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
          platform?: string | null
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
          platform?: string | null
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
          platform: string | null
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
          platform?: string | null
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
          platform?: string | null
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
          platform: string | null
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
          platform?: string | null
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
          platform?: string | null
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
          platform: string | null
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
          platform?: string | null
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
          platform?: string | null
          referrer?: string | null
          region?: string | null
          session_hash?: string | null
          story_id?: string | null
        }
        Relationships: []
      }
      analytics_events_2026_10: {
        Row: {
          advert_id: string | null
          company: string | null
          id: number
          kind: string
          member_id: string | null
          occurred_at: string
          path: string | null
          platform: string | null
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
          platform?: string | null
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
          platform?: string | null
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
          created_at: string
          id: string
          member_id: string
          name: string
          notes: string | null
          price_pennies: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          name: string
          notes?: string | null
          price_pennies?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          name?: string
          notes?: string | null
          price_pennies?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bundles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
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
      consent_stats: {
        Row: {
          consented_requests: number
          day: string
          total_requests: number
        }
        Insert: {
          consented_requests?: number
          day: string
          total_requests?: number
        }
        Update: {
          consented_requests?: number
          day?: string
          total_requests?: number
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
      dev_tasks: {
        Row: {
          assignee: string | null
          context: Json
          created_at: string
          created_by: string | null
          description: string
          id: string
          kind: string | null
          notes: string
          page_path: string | null
          priority: string
          reporter_email: string | null
          sort_order: number
          status: string
          title: string
          triage_notes: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          kind?: string | null
          notes?: string
          page_path?: string | null
          priority?: string
          reporter_email?: string | null
          sort_order?: number
          status?: string
          title: string
          triage_notes?: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          kind?: string | null
          notes?: string
          page_path?: string | null
          priority?: string
          reporter_email?: string | null
          sort_order?: number
          status?: string
          title?: string
          triage_notes?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dev_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
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
          rejected_reason: string | null
          slug: string
          source: string
          starts_on: string
          starts_time: string | null
          status: Database["public"]["Enums"]["content_status"]
          submitted_by: string | null
          title: string
          type: string | null
          updated_at: string
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
          rejected_reason?: string | null
          slug: string
          source?: string
          starts_on: string
          starts_time?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          submitted_by?: string | null
          title: string
          type?: string | null
          updated_at?: string
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
          rejected_reason?: string | null
          slug?: string
          source?: string
          starts_on?: string
          starts_time?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          submitted_by?: string | null
          title?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
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
          rejected_reason: string | null
          source: string
          status: string
          submitted_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          external_url?: string | null
          id?: string
          image_path?: string | null
          member_id: string
          name: string
          rejected_reason?: string | null
          source?: string
          status?: string
          submitted_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          external_url?: string | null
          id?: string
          image_path?: string | null
          member_id?: string
          name?: string
          rejected_reason?: string | null
          source?: string
          status?: string
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "featured_machines_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "featured_machines_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
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
      media: {
        Row: {
          alt_text: string | null
          byte_size: number | null
          content_type: string
          created_at: string
          id: string
          kind: string
          original_name: string | null
          path: string
          uploaded_by: string | null
        }
        Insert: {
          alt_text?: string | null
          byte_size?: number | null
          content_type: string
          created_at?: string
          id?: string
          kind: string
          original_name?: string | null
          path: string
          uploaded_by?: string | null
        }
        Update: {
          alt_text?: string | null
          byte_size?: number | null
          content_type?: string
          created_at?: string
          id?: string
          kind?: string
          original_name?: string | null
          path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
          cancel_requested_at: string | null
          category_id: number | null
          comped_until: string | null
          contact_email: string | null
          created_at: string
          description: string | null
          draft_submitted_at: string | null
          grace_until: string | null
          hero_path: string | null
          id: string
          is_bundle_account: boolean
          joined_at: string | null
          lat: number | null
          lng: number | null
          logo_path: string | null
          name: string
          onboarding_seen: boolean
          paid_at: string | null
          phone: string | null
          search_tsv: unknown
          slug: string
          social: Json
          status: Database["public"]["Enums"]["member_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          testimonials: Json
          video_url: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          billing_mode?: string
          cancel_requested_at?: string | null
          category_id?: number | null
          comped_until?: string | null
          contact_email?: string | null
          created_at?: string
          description?: string | null
          draft_submitted_at?: string | null
          grace_until?: string | null
          hero_path?: string | null
          id?: string
          is_bundle_account?: boolean
          joined_at?: string | null
          lat?: number | null
          lng?: number | null
          logo_path?: string | null
          name: string
          onboarding_seen?: boolean
          paid_at?: string | null
          phone?: string | null
          search_tsv?: unknown
          slug: string
          social?: Json
          status?: Database["public"]["Enums"]["member_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          testimonials?: Json
          video_url?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          billing_mode?: string
          cancel_requested_at?: string | null
          category_id?: number | null
          comped_until?: string | null
          contact_email?: string | null
          created_at?: string
          description?: string | null
          draft_submitted_at?: string | null
          grace_until?: string | null
          hero_path?: string | null
          id?: string
          is_bundle_account?: boolean
          joined_at?: string | null
          lat?: number | null
          lng?: number | null
          logo_path?: string | null
          name?: string
          onboarding_seen?: boolean
          paid_at?: string | null
          phone?: string | null
          search_tsv?: unknown
          slug?: string
          social?: Json
          status?: Database["public"]["Enums"]["member_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
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
          clicks_count: number
          created_at: string
          id: string
          intro: string | null
          number: number
          opens_count: number
          provider_broadcast_id: string | null
          scheduled_at: string | null
          send_error: string | null
          sent_at: string | null
          sent_count: number | null
          status: string
          subject: string
          web_slug: string | null
        }
        Insert: {
          clicks_count?: number
          created_at?: string
          id?: string
          intro?: string | null
          number: number
          opens_count?: number
          provider_broadcast_id?: string | null
          scheduled_at?: string | null
          send_error?: string | null
          sent_at?: string | null
          sent_count?: number | null
          status?: string
          subject: string
          web_slug?: string | null
        }
        Update: {
          clicks_count?: number
          created_at?: string
          id?: string
          intro?: string | null
          number?: number
          opens_count?: number
          provider_broadcast_id?: string | null
          scheduled_at?: string | null
          send_error?: string | null
          sent_at?: string | null
          sent_count?: number | null
          status?: string
          subject?: string
          web_slug?: string | null
        }
        Relationships: []
      }
      newsletter_items: {
        Row: {
          id: string
          issue_id: string
          position: number
          story_id: string | null
          video_id: string | null
        }
        Insert: {
          id?: string
          issue_id: string
          position: number
          story_id?: string | null
          video_id?: string | null
        }
        Update: {
          id?: string
          issue_id?: string
          position?: number
          story_id?: string | null
          video_id?: string | null
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
          {
            foreignKeyName: "newsletter_items_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
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
          job_id: string | null
          kind: string
          member_id: string
          payload: Json
          read_at: string | null
        }
        Insert: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          job_id?: string | null
          kind: string
          member_id: string
          payload?: Json
          read_at?: string | null
        }
        Update: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          job_id?: string | null
          kind?: string
          member_id?: string
          payload?: Json
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      page_layouts: {
        Row: {
          entity_id: string | null
          id: string
          layout: Json
          page_type: string
          updated_at: string
        }
        Insert: {
          entity_id?: string | null
          id?: string
          layout: Json
          page_type: string
          updated_at?: string
        }
        Update: {
          entity_id?: string | null
          id?: string
          layout?: Json
          page_type?: string
          updated_at?: string
        }
        Relationships: []
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
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          expires_at: string | null
          id: string
          max_uses: number | null
          months: number
          used_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          months: number
          used_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          months?: number
          used_count?: number
        }
        Relationships: []
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
      resources: {
        Row: {
          created_at: string
          id: string
          kind: string
          path: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          path: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          path?: string
          title?: string
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
      search_queries: {
        Row: {
          id: number
          occurred_at: string
          query: string
          results_count: number
          session_hash: string | null
        }
        Insert: {
          id?: never
          occurred_at?: string
          query: string
          results_count?: number
          session_hash?: string | null
        }
        Update: {
          id?: never
          occurred_at?: string
          query?: string
          results_count?: number
          session_hash?: string | null
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
          id: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          id?: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          id?: string
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
          description: string | null
          id: string
          member_id: string | null
          pinned_until: string | null
          published_at: string | null
          rejected_reason: string | null
          scheduled_at: string | null
          slug: string
          source: string
          status: Database["public"]["Enums"]["content_status"]
          submitted_by: string | null
          thumbnail_path: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          member_id?: string | null
          pinned_until?: string | null
          published_at?: string | null
          rejected_reason?: string | null
          scheduled_at?: string | null
          slug: string
          source?: string
          status?: Database["public"]["Enums"]["content_status"]
          submitted_by?: string | null
          thumbnail_path?: string | null
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          member_id?: string | null
          pinned_until?: string | null
          published_at?: string | null
          rejected_reason?: string | null
          scheduled_at?: string | null
          slug?: string
          source?: string
          status?: Database["public"]["Enums"]["content_status"]
          submitted_by?: string | null
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
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
          {
            foreignKeyName: "videos_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
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
      bump_consent_stats: { Args: { p_consented: boolean }; Returns: undefined }
      bump_newsletter_metric: {
        Args: { p_broadcast_id: string; p_metric: string }
        Returns: undefined
      }
      current_member_id: { Args: never; Returns: string }
      ensure_analytics_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      run_daily_rollup: { Args: never; Returns: undefined }
      site_sessions_last_year: { Args: never; Returns: number }
    }
    Enums: {
      category_kind: "story" | "member"
      content_status:
        | "draft"
        | "awaiting_approval"
        | "scheduled"
        | "published"
        | "rejected"
        | "withdrawn"
      member_status: "draft" | "active" | "grace" | "lapsed"
      placement_kind:
        | "featured_member"
        | "featured_machine"
        | "grid_block"
        | "takeover"
      user_role: "admin" | "member"
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
        "withdrawn",
      ],
      member_status: ["draft", "active", "grace", "lapsed"],
      placement_kind: [
        "featured_member",
        "featured_machine",
        "grid_block",
        "takeover",
      ],
      user_role: ["admin", "member"],
    },
  },
} as const

