# Graph Report - .  (2026-05-04)

## Corpus Check
- Corpus is ~36,572 words - fits in a single context window. You may not need a graph.

## Summary
- 110 nodes · 174 edges · 16 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.86)
- Token cost: 12,800 input · 3,100 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Database Schema & Architecture|Database Schema & Architecture]]
- [[_COMMUNITY_Migration Script Docs|Migration Script Docs]]
- [[_COMMUNITY_CSV Import Pipeline|CSV Import Pipeline]]
- [[_COMMUNITY_App Logo & Icons|App Logo & Icons]]
- [[_COMMUNITY_PWA iOS Assets|PWA iOS Assets]]
- [[_COMMUNITY_Web App Icons|Web App Icons]]
- [[_COMMUNITY_POS & Stock Operations|POS & Stock Operations]]
- [[_COMMUNITY_Design System Docs|Design System Docs]]
- [[_COMMUNITY_App Shell & Navigation|App Shell & Navigation]]
- [[_COMMUNITY_Stock Movement & Returns|Stock Movement & Returns]]
- [[_COMMUNITY_Auth & Settings|Auth & Settings]]
- [[_COMMUNITY_Product & Inventory|Product & Inventory]]
- [[_COMMUNITY_Reporting & Data|Reporting & Data]]
- [[_COMMUNITY_UI Design System|UI Design System]]
- [[_COMMUNITY_Icon Component|Icon Component]]
- [[_COMMUNITY_PWA Configuration|PWA Configuration]]

## God Nodes (most connected - your core abstractions)
1. `App — React root shell; manages auth session and view routing` - 15 edges
2. `TIMES POS Logo (Web 64px)` - 13 edges
3. `TIMES-POS-Architecture.md — Architecture & DB Schema Reference` - 12 edges
4. `main() — data migration entry point` - 11 edges
5. `TIMES POS Application` - 10 edges
6. `Shopping Bag Icon` - 10 edges
7. `TIMES POS Brand Identity` - 10 edges
8. `main()` - 8 edges
9. `POSView — point-of-sale screen: product search, cart, checkout, VAT, tax invoice` - 7 edges
10. `StockMovementForm — unified form for receive/claim/return with adjust_stock RPC` - 7 edges

## Surprising Connections (you probably didn't know these)
- `normalize_discount_type() — maps Thai symbols to percent/baht` --semantically_similar_to--> `applyDiscounts() — computes line total after two cascading discounts (percent or baht)`  [INFERRED] [semantically similar]
  TIMES-POS-Architecture/import_to_supabase.py → index.html
- `normalize_channel() — maps single-char codes to channel slugs` --semantically_similar_to--> `CHANNELS / PAYMENTS constants — tiktok/shopee/lazada/facebook/store, cash/transfer/card/cod`  [INFERRED] [semantically similar]
  TIMES-POS-Architecture/import_to_supabase.py → index.html
- `Supabase client (create_client) — service_role key, bypasses RLS` --semantically_similar_to--> `sb — Supabase anon client with custom authStorage (localStorage/sessionStorage)`  [INFERRED] [semantically similar]
  TIMES-POS-Architecture/import_to_supabase.py → index.html
- `Web Application Icon (192px)` --provides_pwa_icon_for--> `TIMES POS Application`  [INFERRED]
  icons/logo_web3_192.png → apple-touch-icon.png
- `main() — data migration entry point` --shares_data_with--> `Supabase tables — products, sale_orders, sale_order_items, receive_orders, receive_order_items, return_orders, return_order_items, supplier_claim_orders, supplier_claim_order_items, shop_settings, stock_movements, brands, categories`  [EXTRACTED]
  TIMES-POS-Architecture/import_to_supabase.py → index.html

## Hyperedges (group relationships)
- **Stock adjustment flow: POSView / StockMovementForm call adjust_stock RPC which writes to stock_movements table** — index_pos_view, index_stock_movement_form, index_adjust_stock_rpc, index_supabase_tables [EXTRACTED 1.00]
- **Receipt printing chain: POSView / SalesView → ReceiptModal → Receipt (80mm thermal layout) → window.print()** — index_pos_view, index_sales_view, index_receipt_modal, index_receipt [EXTRACTED 1.00]
- **Legacy data migration pipeline: CBS CSV files → import_to_supabase.py normalization → Supabase tables consumed by index.html app** — import_to_supabase_cbs_csv_files, import_to_supabase_main, index_supabase_tables [EXTRACTED 0.95]

## Communities (16 total, 3 thin omitted)

### Community 0 - "Database Schema & Architecture"
Cohesion: 0.23
Nodes (13): Cascading Discount Logic — dual-step discount calculation, Channel Mapping — legacy single-char to enum, products — Product Catalog Table, receive_order_items — Goods Receipt Line Items Table, receive_orders — Goods Receipt Header Table, return_order_items — Customer Return Line Items Table, return_orders — Customer Return Header Table, Row Level Security (RLS) — Supabase per-table policies (+5 more)

### Community 1 - "Migration Script Docs"
Cohesion: 0.31
Nodes (10): batch_upsert(), main(), normalize_channel(), normalize_discount_type(), normalize_unit(), TIMES POS - Data Migration Script =================================== Import ข้อ, Insert data in batches., read_csv() (+2 more)

### Community 2 - "CSV Import Pipeline"
Cohesion: 0.2
Nodes (11): batch_upsert() — inserts rows in configurable batches to Supabase, CBS CSV files — legacy SQL Server 2014 export (8 files), legacy_id → new UUID mapping pattern (products, sale_orders, receive_orders, return_orders), main() — data migration entry point, normalize_channel() — maps single-char codes to channel slugs, normalize_discount_type() — maps Thai symbols to percent/baht, normalize_unit() — extracts unit string from raw CSV field, read_csv() — reads CSV with UTF-8-sig encoding (+3 more)

### Community 3 - "App Logo & Icons"
Cohesion: 0.27
Nodes (10): Orange-Red Gradient Background, Person Silhouette Icon, Point of Sale Application, PWA Manifest Icon, Retail / Commerce Domain, Shopping Bag Icon, TIMES POS Logo (Web 64px), User Silhouette Icon (+2 more)

### Community 4 - "PWA iOS Assets"
Cohesion: 0.36
Nodes (10): Apple Touch Icon, Glossy Black Surface, iOS / PWA Home Screen Asset, Web Logo 512px, Orange Color Scheme, Orange-Red Gradient Background, Person/User Silhouette, POS Brand Identity (+2 more)

### Community 5 - "Web App Icons"
Cohesion: 0.39
Nodes (7): Application Icon (512px), Orange-Pink Gradient Style, Orange Gradient Visual Style, TIMES POS Brand Identity, User / Person Avatar Icon, Web3 Design Variant, Web3 Theme

### Community 6 - "POS & Stock Operations"
Cohesion: 0.39
Nodes (8): adjust_stock RPC — Supabase stored procedure for atomic stock delta, applyDiscounts() — computes line total after two cascading discounts (percent or baht), CHANNELS / PAYMENTS constants — tiktok/shopee/lazada/facebook/store, cash/transfer/card/cod, POSView — point-of-sale screen: product search, cart, checkout, VAT, tax invoice, Receipt — 80mm thermal receipt/tax-invoice layout component, ReceiptModal — receipt preview + print modal, loads sale_orders + sale_order_items, StockMovementForm — unified form for receive/claim/return with adjust_stock RPC, vatBreakdown() — splits VAT-inclusive grand total into exVat + vat (7% default)

### Community 7 - "Design System Docs"
Cohesion: 0.29
Nodes (7): Anthropic Spike Mark — 4-spoke radial asterisk brand glyph, DESIGN-claude.md — Claude/Anthropic Design System Spec, Component Token System — button/card/badge/form tokens, Coral Primary (#cc785c) — Anthropic signature CTA color, Cream Canvas (#faf9f5) — warm tinted base surface, Surface Dark (#181715) — Dark navy product surface, Typography System — Copernicus serif + StyreneB sans + JetBrains Mono

### Community 8 - "App Shell & Navigation"
Cohesion: 0.33
Nodes (7): App — React root shell; manages auth session and view routing, DashboardView — sales summary stats and channel breakdown chart, LoginScreen — email/password login with remember-me, stored in localStorage, MobileTabBar — floating pill bottom nav with active indicator, MobileTopBar — sticky mobile header with drawer menu, Sidebar — desktop dark-glass navigation with settings and logout, ToastProvider / useToast — global notification system with 3.5s auto-dismiss

### Community 9 - "Stock Movement & Returns"
Cohesion: 0.4
Nodes (6): MovementDetailModal — detail/edit/void for movement orders with header-only edit policy, MovementHistoryModal — filterable list of receive/claim/return orders, MOVEMENT_META — configuration map driving MovementHistoryModal/DetailModal for receive/claim/return, ReturnView — customer return form with history, SalesView — sales history grouped by day, void support, reprint, void_* RPCs — void_sale_order / void_receive_order / void_return_order / void_supplier_claim (stock reversal)

### Community 10 - "Auth & Settings"
Cohesion: 0.33
Nodes (6): authStorage — custom storage adapter routing tokens based on remember-me flag, Modal — bottom-sheet on mobile, scale-fade dialog on desktop, SettingsModal — edit shop_settings (name, address, phone, tax ID, footer), ShopProvider / useShop — single-row shop_settings context for receipt data, sb — Supabase anon client with custom authStorage (localStorage/sessionStorage), useMountedToggle — keeps component mounted during exit animation

### Community 11 - "Product & Inventory"
Cohesion: 0.5
Nodes (4): AddProductModal — quick add-product modal launched from ReceiveView, ProductEditor — modal form for create/edit product with inline brand/category creation, ProductsView — product list with brand/category filters, ReceiveView — stock-in / supplier-claim tabs with history and add-product shortcut

### Community 12 - "Reporting & Data"
Cohesion: 0.5
Nodes (4): DatePicker — custom Thai calendar with single/range modes and preset buttons, ProfitLossView — per-line P&L with FIFO-like cost lookup from receive_order_items, StockHistoryPanel — collapsible stock_movements log inside ProductEditor, Supabase tables — products, sale_orders, sale_order_items, receive_orders, receive_order_items, return_orders, return_order_items, supplier_claim_orders, supplier_claim_order_items, shop_settings, stock_movements, brands, categories

## Knowledge Gaps
- **31 isolated node(s):** `TIMES POS - Data Migration Script =================================== Import ข้อ`, `Insert data in batches.`, `Cream Canvas (#faf9f5) — warm tinted base surface`, `Coral Primary (#cc785c) — Anthropic signature CTA color`, `Surface Dark (#181715) — Dark navy product surface` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App — React root shell; manages auth session and view routing` connect `App Shell & Navigation` to `POS & Stock Operations`, `Stock Movement & Returns`, `Auth & Settings`, `Product & Inventory`, `Reporting & Data`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `main() — data migration entry point` connect `CSV Import Pipeline` to `Reporting & Data`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `Supabase tables — products, sale_orders, sale_order_items, receive_orders, receive_order_items, return_orders, return_order_items, supplier_claim_orders, supplier_claim_order_items, shop_settings, stock_movements, brands, categories` connect `Reporting & Data` to `CSV Import Pipeline`, `POS & Stock Operations`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `TIMES POS Logo (Web 64px)` (e.g. with `Point of Sale Application` and `Retail / Commerce Domain`) actually correct?**
  _`TIMES POS Logo (Web 64px)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `TIMES POS Application` (e.g. with `Point of Sale / Retail Domain` and `Person/User Silhouette`) actually correct?**
  _`TIMES POS Application` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `TIMES POS - Data Migration Script =================================== Import ข้อ`, `Insert data in batches.`, `Cream Canvas (#faf9f5) — warm tinted base surface` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._