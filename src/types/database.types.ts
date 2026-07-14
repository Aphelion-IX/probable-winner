export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_documents: {
        Row: {
          category: string
          created_at: string
          date: string
          description: string
          edition: string
          file_size: string
          file_type: string
          file_url: string | null
          id: string
          notes: string | null
          page_count: number
          search_text: string
          sections: Json
          swatch: string
          tags: Json
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          date?: string
          description?: string
          edition?: string
          file_size?: string
          file_type?: string
          file_url?: string | null
          id?: string
          notes?: string | null
          page_count?: number
          search_text?: string
          sections?: Json
          swatch?: string
          tags?: Json
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          date?: string
          description?: string
          edition?: string
          file_size?: string
          file_type?: string
          file_url?: string | null
          id?: string
          notes?: string | null
          page_count?: number
          search_text?: string
          sections?: Json
          swatch?: string
          tags?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          actor_id: string | null
          company_id: string | null
          created_at: string
          detail: Json | null
          event_type: string
          id: string
          project_id: string | null
          target_user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          detail?: Json | null
          event_type: string
          id?: string
          project_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          detail?: Json | null
          event_type?: string
          id?: string
          project_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      colours: {
        Row: {
          code: string
          created_at: string
          hex: string
          id: string
          label: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          hex: string
          id?: string
          label: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          hex?: string
          id?: string
          label?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          abn: string | null
          address: string | null
          billing_email: string | null
          created_at: string
          created_by: string
          customer_account_number: string | null
          id: string
          legal_name: string
          phone: string | null
          price_list_id: string
          status: string
          trading_name: string | null
          updated_at: string
        }
        Insert: {
          abn?: string | null
          address?: string | null
          billing_email?: string | null
          created_at?: string
          created_by: string
          customer_account_number?: string | null
          id?: string
          legal_name: string
          phone?: string | null
          price_list_id: string
          status?: string
          trading_name?: string | null
          updated_at?: string
        }
        Update: {
          abn?: string | null
          address?: string | null
          billing_email?: string | null
          created_at?: string
          created_by?: string
          customer_account_number?: string | null
          id?: string
          legal_name?: string
          phone?: string | null
          price_list_id?: string
          status?: string
          trading_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          company_id: string
          id: string
          invited_by: string | null
          joined_at: string
          last_active_at: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          company_id: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          last_active_at?: string | null
          role: string
          status?: string
          user_id: string
        }
        Update: {
          company_id?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          last_active_at?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_product_overrides: {
        Row: {
          category: string
          company_id: string
          created_at: string
          created_by: string
          fixing_id: string | null
          id: string
          panel_id: string | null
          price: number
          sealant_id: string | null
          track_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string
          created_by: string
          fixing_id?: string | null
          id?: string
          panel_id?: string | null
          price: number
          sealant_id?: string | null
          track_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string
          fixing_id?: string | null
          id?: string
          panel_id?: string | null
          price?: number
          sealant_id?: string | null
          track_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_product_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_product_overrides_fixing_id_fkey"
            columns: ["fixing_id"]
            isOneToOne: false
            referencedRelation: "fixings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_product_overrides_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_product_overrides_sealant_id_fkey"
            columns: ["sealant_id"]
            isOneToOne: false
            referencedRelation: "sealants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_product_overrides_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      fixings: {
        Row: {
          code: string
          created_at: string
          gauge: string
          id: string
          length_mm: number
          notes: string | null
          per_box: number
          price_per_box: number | null
          updated_at: string
          use: string
        }
        Insert: {
          code: string
          created_at?: string
          gauge: string
          id?: string
          length_mm: number
          notes?: string | null
          per_box: number
          price_per_box?: number | null
          updated_at?: string
          use: string
        }
        Update: {
          code?: string
          created_at?: string
          gauge?: string
          id?: string
          length_mm?: number
          notes?: string | null
          per_box?: number
          price_per_box?: number | null
          updated_at?: string
          use?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          invitee_name: string | null
          message: string | null
          project_ids: string[] | null
          role: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          invitee_name?: string | null
          message?: string | null
          project_ids?: string[] | null
          role: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invitee_name?: string | null
          message?: string | null
          project_ids?: string[] | null
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      math_constants: {
        Row: {
          id: string
          updated_at: string
          values: Json
        }
        Insert: {
          id?: string
          updated_at?: string
          values: Json
        }
        Update: {
          id?: string
          updated_at?: string
          values?: Json
        }
        Relationships: []
      }
      order_adjustments: {
        Row: {
          amount_ex_gst: number | null
          created_at: string
          created_by: string
          id: string
          kind: string
          label: string
          order_id: string
          saved_fee_id: string | null
          updated_at: string
        }
        Insert: {
          amount_ex_gst?: number | null
          created_at?: string
          created_by: string
          id?: string
          kind: string
          label: string
          order_id: string
          saved_fee_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_ex_gst?: number | null
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          label?: string
          order_id?: string
          saved_fee_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_adjustments_saved_fee_id_fkey"
            columns: ["saved_fee_id"]
            isOneToOne: false
            referencedRelation: "saved_fees"
            referencedColumns: ["id"]
          },
        ]
      }
      order_deliveries: {
        Row: {
          actual_date: string | null
          address_line1: string
          address_line2: string | null
          approval_status: string
          confirmed_date: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          customer_note: string | null
          delivery_instructions: string | null
          id: string
          internal_note: string | null
          item_allocations: Json
          order_id: string
          postcode: string
          preferred_window: string | null
          proposed_date: string | null
          requested_date: string | null
          sequence_no: number
          site_access_details: string | null
          state: string
          status: string
          suburb: string
          updated_at: string
        }
        Insert: {
          actual_date?: string | null
          address_line1: string
          address_line2?: string | null
          approval_status?: string
          confirmed_date?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_note?: string | null
          delivery_instructions?: string | null
          id?: string
          internal_note?: string | null
          item_allocations?: Json
          order_id: string
          postcode: string
          preferred_window?: string | null
          proposed_date?: string | null
          requested_date?: string | null
          sequence_no: number
          site_access_details?: string | null
          state: string
          status?: string
          suburb: string
          updated_at?: string
        }
        Update: {
          actual_date?: string | null
          address_line1?: string
          address_line2?: string | null
          approval_status?: string
          confirmed_date?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_note?: string | null
          delivery_instructions?: string | null
          id?: string
          internal_note?: string | null
          item_allocations?: Json
          order_id?: string
          postcode?: string
          preferred_window?: string | null
          proposed_date?: string | null
          requested_date?: string | null
          sequence_no?: number
          site_access_details?: string | null
          state?: string
          status?: string
          suburb?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_stage_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          note: string | null
          order_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          note?: string | null
          order_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          note?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_stage_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          company_id: string | null
          created_at: string
          customer_note: string | null
          gst_amount: number
          gst_rate: number
          id: string
          line_items: Json
          manufacturing_est_completion: string | null
          owner_id: string
          panels_manufactured: number | null
          proforma_issued_at: string | null
          proforma_requested_at: string | null
          project_id: string
          stage: string
          submitted_at: string | null
          subtotal_ex_gst: number
          total_inc_gst: number
          unpriced_item_count: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          company_id?: string | null
          created_at?: string
          customer_note?: string | null
          gst_amount?: number
          gst_rate?: number
          id?: string
          line_items?: Json
          manufacturing_est_completion?: string | null
          owner_id: string
          panels_manufactured?: number | null
          proforma_issued_at?: string | null
          proforma_requested_at?: string | null
          project_id: string
          stage?: string
          submitted_at?: string | null
          subtotal_ex_gst?: number
          total_inc_gst?: number
          unpriced_item_count?: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          company_id?: string | null
          created_at?: string
          customer_note?: string | null
          gst_amount?: number
          gst_rate?: number
          id?: string
          line_items?: Json
          manufacturing_est_completion?: string | null
          owner_id?: string
          panels_manufactured?: number | null
          proforma_issued_at?: string | null
          proforma_requested_at?: string | null
          project_id?: string
          stage?: string
          submitted_at?: string | null
          subtotal_ex_gst?: number
          total_inc_gst?: number
          unpriced_item_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      panels: {
        Row: {
          corner_post: Json
          created_at: string
          ctrack_dim: string
          ctrack_stock: number
          depth: string
          frl: string
          horiz_ctrack: Json
          id: string
          jtrack_dim: string
          label: string
          max_h_horiz: number
          max_h_vert: number
          notes: string | null
          pack: number
          price_per_panel: number | null
          span_horiz: Json
          span_vert: Json
          type: number
          updated_at: string
        }
        Insert: {
          corner_post: Json
          created_at?: string
          ctrack_dim: string
          ctrack_stock: number
          depth: string
          frl: string
          horiz_ctrack: Json
          id?: string
          jtrack_dim: string
          label: string
          max_h_horiz: number
          max_h_vert: number
          notes?: string | null
          pack: number
          price_per_panel?: number | null
          span_horiz: Json
          span_vert: Json
          type: number
          updated_at?: string
        }
        Update: {
          corner_post?: Json
          created_at?: string
          ctrack_dim?: string
          ctrack_stock?: number
          depth?: string
          frl?: string
          horiz_ctrack?: Json
          id?: string
          jtrack_dim?: string
          label?: string
          max_h_horiz?: number
          max_h_vert?: number
          notes?: string | null
          pack?: number
          price_per_panel?: number | null
          span_horiz?: Json
          span_vert?: Json
          type?: number
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string
          key: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          key: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          key?: string
        }
        Relationships: []
      }
      price_list_prices: {
        Row: {
          category: string
          created_at: string
          fixing_id: string | null
          id: string
          panel_id: string | null
          price: number
          price_list_id: string
          sealant_id: string | null
          track_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          fixing_id?: string | null
          id?: string
          panel_id?: string | null
          price: number
          price_list_id: string
          sealant_id?: string | null
          track_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          fixing_id?: string | null
          id?: string
          panel_id?: string | null
          price?: number
          price_list_id?: string
          sealant_id?: string | null
          track_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_list_prices_fixing_id_fkey"
            columns: ["fixing_id"]
            isOneToOne: false
            referencedRelation: "fixings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_prices_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_prices_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_prices_sealant_id_fkey"
            columns: ["sealant_id"]
            isOneToOne: false
            referencedRelation: "sealants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_prices_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_default: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_default?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_default?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          role: string
          staff_role: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          phone?: string | null
          role?: string
          staff_role?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          role?: string
          staff_role?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_documents: {
        Row: {
          content_type: string | null
          created_at: string
          file_name: string
          file_size: number
          id: string
          project_id: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          file_name: string
          file_size: number
          id?: string
          project_id: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          file_name?: string
          file_size?: number
          id?: string
          project_id?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_memberships: {
        Row: {
          added_at: string
          added_by: string | null
          project_id: string
          project_role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          project_id: string
          project_role?: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          project_id?: string
          project_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stage_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          note: string | null
          project_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          note?: string | null
          project_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          note?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_stage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          company_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          install_review_note: string | null
          install_review_status: string | null
          name: string
          owner_id: string
          project_manager_user_id: string | null
          stage: string
          technical_review_note: string | null
          technical_review_status: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          data: Json
          deleted_at?: string | null
          id?: string
          install_review_note?: string | null
          install_review_status?: string | null
          name: string
          owner_id: string
          project_manager_user_id?: string | null
          stage?: string
          technical_review_note?: string | null
          technical_review_status?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          install_review_note?: string | null
          install_review_status?: string | null
          name?: string
          owner_id?: string
          project_manager_user_id?: string | null
          stage?: string
          technical_review_note?: string | null
          technical_review_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string | null
          name: string
          phone: string | null
          project_id: string | null
          project_snapshot: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message?: string | null
          name: string
          phone?: string | null
          project_id?: string | null
          project_snapshot?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
          project_id?: string | null
          project_snapshot?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          granted_at: string
          granted_by: string | null
          permission_key: string
          role: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          permission_key: string
          role: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          permission_key?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      saved_fees: {
        Row: {
          active: boolean
          created_at: string
          default_amount_ex_gst: number | null
          id: string
          kind: string
          label: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_amount_ex_gst?: number | null
          id?: string
          kind: string
          label: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_amount_ex_gst?: number | null
          id?: string
          kind?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      sealants: {
        Row: {
          created_at: string
          id: string
          m2_per_sausage: number
          notes: string | null
          per_box: number
          price_per_box: number | null
          product: string
          system: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          m2_per_sausage: number
          notes?: string | null
          per_box: number
          price_per_box?: number | null
          product: string
          system: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          m2_per_sausage?: number
          notes?: string | null
          per_box?: number
          price_per_box?: number | null
          product?: string
          system?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_assignments: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          role: string
          staff_user_id: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          role: string
          staff_user_id: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          role?: string
          staff_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_locked_rows: {
        Row: {
          rows: Json
          system: string
          updated_at: string
        }
        Insert: {
          rows?: Json
          system: string
          updated_at?: string
        }
        Update: {
          rows?: Json
          system?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_tables: {
        Row: {
          id: string
          updated_at: string
          values: Json
        }
        Insert: {
          id?: string
          updated_at?: string
          values: Json
        }
        Update: {
          id?: string
          updated_at?: string
          values?: Json
        }
        Relationships: []
      }
      tracks: {
        Row: {
          bmt: string | null
          created_at: string
          dim: string
          id: string
          kind: string
          label: string
          notes: string | null
          panel_type: number | null
          price_per_metre: number | null
          stock_lengths: Json
          system: string
          updated_at: string
        }
        Insert: {
          bmt?: string | null
          created_at?: string
          dim: string
          id?: string
          kind: string
          label: string
          notes?: string | null
          panel_type?: number | null
          price_per_metre?: number | null
          stock_lengths?: Json
          system: string
          updated_at?: string
        }
        Update: {
          bmt?: string | null
          created_at?: string
          dim?: string
          id?: string
          kind?: string
          label?: string
          notes?: string | null
          panel_type?: number | null
          price_per_metre?: number | null
          stock_lengths?: Json
          system?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_company_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      accept_delivery_date: {
        Args: { p_delivery_id: string }
        Returns: undefined
      }
      accept_proposed_delivery_date: {
        Args: { p_delivery_id: string }
        Returns: undefined
      }
      add_order_adjustment: {
        Args: {
          p_amount_ex_gst?: number
          p_kind: string
          p_label: string
          p_order_id: string
          p_saved_fee_id?: string
        }
        Returns: string
      }
      add_project_member: {
        Args: {
          p_project_id: string
          p_project_role?: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_add_company_member_by_email: {
        Args: { p_company_id: string; p_email: string; p_role: string }
        Returns: undefined
      }
      admin_clear_company_override: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_count_users: {
        Args: never
        Returns: {
          admins: number
          total: number
        }[]
      }
      admin_create_company: {
        Args: {
          p_abn?: string
          p_address?: string
          p_billing_email?: string
          p_customer_account_number?: string
          p_legal_name: string
          p_phone?: string
          p_trading_name?: string
        }
        Returns: string
      }
      admin_create_delivery: {
        Args: {
          p_address_line1: string
          p_address_line2: string
          p_contact_name: string
          p_contact_phone: string
          p_delivery_instructions: string
          p_item_allocations?: Json
          p_order_id: string
          p_postcode: string
          p_preferred_window?: string
          p_requested_date: string
          p_site_access_details?: string
          p_state: string
          p_suburb: string
        }
        Returns: string
      }
      admin_create_price_list: {
        Args: { p_name: string; p_notes?: string }
        Returns: string
      }
      admin_delete_price_list: {
        Args: { p_price_list_id: string }
        Returns: undefined
      }
      admin_delete_price_list_price: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_duplicate_price_list: {
        Args: { p_new_name: string; p_source_price_list_id: string }
        Returns: string
      }
      admin_list_companies: {
        Args: never
        Returns: {
          created_at: string
          id: string
          member_count: number
          name: string
        }[]
      }
      admin_list_delivery_requests: {
        Args: never
        Returns: {
          actual_date: string
          address_line1: string
          address_line2: string
          approval_status: string
          company_id: string
          confirmed_date: string
          contact_name: string
          contact_phone: string
          created_at: string
          customer_note: string
          delivery_instructions: string
          id: string
          internal_note: string
          item_allocations: Json
          order_id: string
          order_stage: string
          postcode: string
          preferred_window: string
          project_name: string
          proposed_date: string
          requested_date: string
          sequence_no: number
          site_access_details: string
          state: string
          status: string
          suburb: string
          updated_at: string
        }[]
      }
      admin_list_permission_matrix: {
        Args: never
        Returns: {
          category: string
          description: string
          granted: boolean
          permission_key: string
          role: string
        }[]
      }
      admin_list_price_lists: {
        Args: never
        Returns: {
          company_count: number
          created_at: string
          id: string
          is_default: boolean
          name: string
          notes: string
          product_count: number
          updated_at: string
        }[]
      }
      admin_list_staff_candidates: {
        Args: never
        Returns: {
          display_name: string
          email: string
          id: string
          staff_role: string
          title: string
        }[]
      }
      admin_list_stage_events: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          actor_email: string
          actor_id: string
          created_at: string
          event_type: string
          id: string
          note: string
          project_id: string
          project_name: string
        }[]
      }
      admin_list_users: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          phone: string
          role: string
          staff_role: string
          title: string
        }[]
      }
      admin_promote_user_to_staff_by_email: {
        Args: { p_email: string; p_staff_role: string }
        Returns: undefined
      }
      admin_remove_staff_assignment: {
        Args: { p_company_id: string; p_role: string; p_staff_user_id: string }
        Returns: undefined
      }
      admin_rename_price_list: {
        Args: { p_name: string; p_price_list_id: string }
        Returns: undefined
      }
      admin_set_company_override: {
        Args: {
          p_category: string
          p_company_id: string
          p_price: number
          p_product_id: string
        }
        Returns: undefined
      }
      admin_set_company_price_list: {
        Args: { p_company_id: string; p_price_list_id: string }
        Returns: undefined
      }
      admin_set_order_line_price: {
        Args: {
          p_line_item_id: string
          p_order_id: string
          p_unit_price_ex_gst: number
        }
        Returns: undefined
      }
      admin_set_price_list_price: {
        Args: {
          p_category: string
          p_price: number
          p_price_list_id: string
          p_product_id: string
        }
        Returns: undefined
      }
      admin_set_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      admin_set_role_permission: {
        Args: { p_granted: boolean; p_permission_key: string; p_role: string }
        Returns: undefined
      }
      admin_set_staff_assignment: {
        Args: { p_company_id: string; p_role: string; p_staff_user_id: string }
        Returns: undefined
      }
      admin_set_staff_profile: {
        Args: {
          p_display_name: string
          p_phone: string
          p_title: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_staff_role: {
        Args: { p_staff_role: string; p_user_id: string }
        Returns: undefined
      }
      admin_set_user_company: {
        Args: { p_company_id: string; p_role?: string; p_user_id: string }
        Returns: undefined
      }
      admin_update_delivery: {
        Args: {
          p_address_line1: string
          p_address_line2: string
          p_contact_name: string
          p_contact_phone: string
          p_delivery_id: string
          p_delivery_instructions: string
          p_item_allocations: Json
          p_postcode: string
          p_preferred_window: string
          p_site_access_details: string
          p_state: string
          p_suburb: string
        }
        Returns: undefined
      }
      admin_update_delivery_status: {
        Args: { p_delivery_id: string; p_status: string }
        Returns: undefined
      }
      admin_update_manufacturing: {
        Args: {
          p_manufacturing_est_completion: string
          p_order_id: string
          p_panels_manufactured: number
        }
        Returns: undefined
      }
      can_edit_project: {
        Args: { p_company_id: string; p_owner_id: string; p_project_id: string }
        Returns: boolean
      }
      can_submit_orders: {
        Args: { p_company_id: string; p_owner_id: string; p_project_id: string }
        Returns: boolean
      }
      can_view_project: {
        Args: { p_company_id: string; p_owner_id: string; p_project_id: string }
        Returns: boolean
      }
      cancel_company_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      cancel_order: { Args: { p_order_id: string }; Returns: undefined }
      company_list_audit_log: {
        Args: { p_company_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          actor_email: string
          actor_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
          project_id: string
          project_name: string
          target_email: string
          target_user_id: string
        }[]
      }
      company_list_members: {
        Args: { p_company_id: string }
        Returns: {
          assigned_project_count: number
          email: string
          joined_at: string
          last_active_at: string
          role: string
          status: string
          user_id: string
        }[]
      }
      company_list_staff_team: {
        Args: { p_company_id: string }
        Returns: {
          display_name: string
          email: string
          is_primary: boolean
          phone: string
          role: string
          staff_user_id: string
          title: string
        }[]
      }
      company_member_removal_warnings: {
        Args: { p_company_id: string; p_user_id: string }
        Returns: {
          active_projects_as_pm: number
          draft_orders: number
          open_reviews_as_pm: number
        }[]
      }
      company_remove_member: {
        Args: { p_company_id: string; p_user_id: string }
        Returns: undefined
      }
      company_set_member_role: {
        Args: { p_company_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      company_set_member_status: {
        Args: { p_company_id: string; p_status: string; p_user_id: string }
        Returns: undefined
      }
      decline_company_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      decline_delivery_request: {
        Args: { p_customer_note?: string; p_delivery_id: string }
        Returns: undefined
      }
      has_permission: { Args: { p_permission_key: string }; Returns: boolean }
      has_staff_role: { Args: { p_roles: string[] }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_company_admin: { Args: { p_company_id: string }; Returns: boolean }
      is_company_owner: { Args: { p_company_id: string }; Returns: boolean }
      issue_proforma_invoice: {
        Args: { p_note?: string; p_order_id: string }
        Returns: undefined
      }
      log_audit: {
        Args: {
          p_actor_id: string
          p_company_id: string
          p_detail?: Json
          p_event_type: string
          p_project_id?: string
          p_target_user_id?: string
        }
        Returns: undefined
      }
      propose_delivery_date: {
        Args: { p_delivery_id: string; p_proposed_date: string }
        Returns: undefined
      }
      recompute_order_totals: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      remove_order_adjustment: {
        Args: { p_adjustment_id: string; p_order_id: string }
        Returns: undefined
      }
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: undefined
      }
      request_delivery_date_change: {
        Args: { p_delivery_id: string; p_new_requested_date: string }
        Returns: undefined
      }
      request_install_review: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      request_proforma_invoice: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      request_technical_review: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      resend_company_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      review_install: {
        Args: { p_decision: string; p_note?: string; p_project_id: string }
        Returns: undefined
      }
      review_technical: {
        Args: { p_decision: string; p_note?: string; p_project_id: string }
        Returns: undefined
      }
      set_delivery_customer_note: {
        Args: { p_delivery_id: string; p_note: string }
        Returns: undefined
      }
      set_delivery_internal_note: {
        Args: { p_delivery_id: string; p_note: string }
        Returns: undefined
      }
      set_project_member_role: {
        Args: {
          p_project_id: string
          p_project_role: string
          p_user_id: string
        }
        Returns: undefined
      }
      submit_order: { Args: { p_order_id: string }; Returns: undefined }
      touch_last_active: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
