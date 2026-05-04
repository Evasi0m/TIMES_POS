# Graph Report - .  (2026-05-04)

## Corpus Check
- Corpus is ~32,085 words - fits in a single context window. You may not need a graph.

## Summary
- 88 nodes · 153 edges · 8 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.85)
- Token cost: 2,400 input · 900 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Supabase Schema & Business Rules|Supabase Schema & Business Rules]]
- [[_COMMUNITY_Brand Icon Variants|Brand Icon Variants]]
- [[_COMMUNITY_Design System & Theming|Design System & Theming]]
- [[_COMMUNITY_Data Migration Pipeline|Data Migration Pipeline]]
- [[_COMMUNITY_POS Core Application|POS Core Application]]
- [[_COMMUNITY_PWA App Icons|PWA App Icons]]
- [[_COMMUNITY_Navigation Components|Navigation Components]]
- [[_COMMUNITY_Mobile Top Bar|Mobile Top Bar]]

## God Nodes (most connected - your core abstractions)
1. `TIMES POS Logo (Web 64px)` - 13 edges
2. `TIMES-POS-Architecture.md — Architecture & DB Schema Reference` - 12 edges
3. `TIMES POS Application` - 10 edges
4. `Shopping Bag Icon` - 10 edges
5. `TIMES POS Brand Identity` - 10 edges
6. `index.html — TIMES POS Single-File Web App` - 9 edges
7. `POSView — POS / Sales Component` - 9 edges
8. `main()` - 8 edges
9. `Supabase JS Client (sb)` - 8 edges
10. `DESIGN-claude.md — Claude/Anthropic Design System Spec` - 7 edges

## Surprising Connections (you probably didn't know these)
- `index.html — TIMES POS Single-File Web App` --conceptually_related_to--> `Row Level Security (RLS) — Supabase per-table policies`  [INFERRED]
  index.html → TIMES-POS-Architecture/TIMES-POS-Architecture.md
- `Coral Primary (#cc785c) — Anthropic signature CTA color` --semantically_similar_to--> `Liquid Glass UI Design — backdrop-filter glassmorphism primitives`  [INFERRED] [semantically similar]
  DESIGN-claude.md → index.html
- `Taviraj Font — Thai serif body/display font (Google Fonts)` --semantically_similar_to--> `Typography System — Copernicus serif + StyreneB sans + JetBrains Mono`  [INFERRED] [semantically similar]
  index.html → DESIGN-claude.md
- `Stock Formula — received − sold + returned` --conceptually_related_to--> `ProductsView — Product Management Component`  [INFERRED]
  TIMES-POS-Architecture/TIMES-POS-Architecture.md → index.html
- `User / Person Avatar Icon` --represents_user_focus_of--> `TIMES POS Application`  [INFERRED]
  icons/logo_web3_512.png → apple-touch-icon.png

## Hyperedges (group relationships)
- **POS Sale Flow — POSView + sale_orders + sale_order_items + adjust_stock RPC** — index_posview, arch_sale_orders_table, arch_sale_order_items_table, arch_products_table [EXTRACTED 1.00]
- **Movement Tracking System — MOVEMENT_META + MovementHistoryModal + MovementDetailModal covering receive/claim/return order kinds** — index_movement_meta, index_movementhistorymodal, index_movementdetailmodal [EXTRACTED 1.00]
- **Design Token Bridge — DESIGN-claude.md tokens realized in Tailwind config inside index.html** — design_claude_md, index_tailwindcss, design_cream_canvas [INFERRED 0.95]

## Communities (8 total, 1 thin omitted)

### Community 0 - "Supabase Schema & Business Rules"
Cohesion: 0.19
Nodes (18): Cascading Discount Logic — dual-step discount calculation, Channel Mapping — legacy single-char to enum, products — Product Catalog Table, receive_order_items — Goods Receipt Line Items Table, receive_orders — Goods Receipt Header Table, return_order_items — Customer Return Line Items Table, return_orders — Customer Return Header Table, Row Level Security (RLS) — Supabase per-table policies (+10 more)

### Community 1 - "Brand Icon Variants"
Cohesion: 0.21
Nodes (16): Application Icon (512px), Orange-Pink Gradient Style, Orange Gradient Visual Style, Orange-Red Gradient Background, Person Silhouette Icon, Point of Sale Application, PWA Manifest Icon, Retail / Commerce Domain (+8 more)

### Community 2 - "Design System & Theming"
Cohesion: 0.21
Nodes (14): Anthropic Spike Mark — 4-spoke radial asterisk brand glyph, DESIGN-claude.md — Claude/Anthropic Design System Spec, Component Token System — button/card/badge/form tokens, Coral Primary (#cc785c) — Anthropic signature CTA color, Cream Canvas (#faf9f5) — warm tinted base surface, Surface Dark (#181715) — Dark navy product surface, Typography System — Copernicus serif + StyreneB sans + JetBrains Mono, Babel Standalone (JSX transform) (+6 more)

### Community 3 - "Data Migration Pipeline"
Cohesion: 0.31
Nodes (10): batch_upsert(), main(), normalize_channel(), normalize_discount_type(), normalize_unit(), TIMES POS - Data Migration Script =================================== Import ข้อ, Insert data in batches., read_csv() (+2 more)

### Community 4 - "POS Core Application"
Cohesion: 0.27
Nodes (11): Supabase Project — TIMES POS (zrymhhkqdcttqsdczfcr), authStorage — localStorage/sessionStorage custom auth adapter, LoginScreen — Supabase Auth Login, Modal — Reusable Modal/Sheet Component, MOVEMENT_META — metadata map for receive/claim/return order kinds, MovementDetailModal — Order Detail/Edit/Void, MovementHistoryModal — Receive/Claim/Return History, ProductsView — Product Management Component (+3 more)

### Community 5 - "PWA App Icons"
Cohesion: 0.31
Nodes (11): Apple Touch Icon, Glossy Black Surface, iOS / PWA Home Screen Asset, Web Logo 512px, Orange Color Scheme, Orange-Red Gradient Background, Person/User Silhouette, POS Brand Identity (+3 more)

### Community 6 - "Navigation Components"
Cohesion: 0.5
Nodes (4): DatePicker — Thai Calendar Date/Range Picker, Icon — SVG Icon Component (Lucide-inspired), MobileTabBar — Mobile Bottom Tab Bar, Sidebar — Desktop Navigation Sidebar

## Knowledge Gaps
- **16 isolated node(s):** `TIMES POS - Data Migration Script =================================== Import ข้อ`, `Insert data in batches.`, `React 18 (CDN)`, `Babel Standalone (JSX transform)`, `ToastCtx / ToastProvider — Toast Notification System` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html — TIMES POS Single-File Web App` connect `Design System & Theming` to `Supabase Schema & Business Rules`, `POS Core Application`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `Supabase JS Client (sb)` connect `POS Core Application` to `Supabase Schema & Business Rules`, `Design System & Theming`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `POSView — POS / Sales Component` connect `Supabase Schema & Business Rules` to `POS Core Application`, `Navigation Components`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `TIMES POS Logo (Web 64px)` (e.g. with `Point of Sale Application` and `Retail / Commerce Domain`) actually correct?**
  _`TIMES POS Logo (Web 64px)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `TIMES POS Application` (e.g. with `Point of Sale / Retail Domain` and `Person/User Silhouette`) actually correct?**
  _`TIMES POS Application` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `Shopping Bag Icon` (e.g. with `Point of Sale / Retail Domain` and `POS Brand Identity`) actually correct?**
  _`Shopping Bag Icon` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `TIMES POS Brand Identity` (e.g. with `logo_web3_512.png` and `Orange Gradient Visual Style`) actually correct?**
  _`TIMES POS Brand Identity` has 9 INFERRED edges - model-reasoned connections that need verification._