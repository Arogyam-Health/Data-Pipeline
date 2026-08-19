# Metabase + Supabase Dashboard Setup Guide

## Step 1: Deploy Analytics Views

Go to **Supabase Dashboard → SQL Editor** and run the contents of:
```
supabase/migrations/008_analytics_dashboard_views.sql
```

This creates 10 views under the `analytics` schema.

---

## Step 2: Connect Metabase to Supabase

### Option A: Supabase-hosted Metabase (recommended)
1. Go to **Supabase Dashboard → Project Settings → Integrations**
2. Enable **Metabase** integration
3. It auto-creates a Metabase instance connected to your database

### Option B: Self-hosted / Metabase Cloud
1. Go to **Metabase → Admin → Databases → Add Database**
2. Select **PostgreSQL**
3. Fill in:

| Field | Value |
|-------|-------|
| Display name | `Shiprocket Pipeline` |
| Host | `<YOUR_SUPABASE_HOST>` |
| Port | `5432` |
| Database name | `postgres` |
| Username | `<YOUR_DB_USERNAME>` |
| Password | *(your database password — from Supabase Settings → Database)* |
| SSL | Require |

> **Find your password:** Supabase Dashboard → Settings → Database → Connection string → Password

4. Click **Test connection** → **Save**

---

## Step 3: Create Dashboards in Metabase

### Dashboard 1: Shiprocket Overview

| Card | Type | Question/SQL |
|------|------|-------------|
| **Total Orders** | Number | `analytics.shiprocket_kpis` → `total_orders` |
| **Delivered** | Number | `analytics.shiprocket_kpis` → `delivered_orders` |
| **In Transit** | Number | `analytics.shiprocket_kpis` → `in_transit_orders` |
| **Delivery Rate %** | Number | `analytics.shiprocket_kpis` → `delivery_rate_pct` |
| **Total Revenue** | Number | `analytics.shiprocket_kpis` → `total_revenue` |
| **Orders by Status** | Pie Chart | `analytics.shiprocket_status_summary` |
| **Orders Over Time** | Line Chart | `analytics.shiprocket_delivery_summary` |

### Dashboard 2: Courier Performance

| Card | Type | Question/SQL |
|------|------|-------------|
| **Orders by Courier** | Bar Chart | `analytics.shiprocket_courier_performance` |
| **Delivery Rate by Courier** | Bar Chart | `analytics.shiprocket_courier_performance` |
| **Revenue by Courier** | Bar Chart | `analytics.shiprocket_courier_performance` |

### Dashboard 3: Payment Analytics

| Card | Type | Question/SQL |
|------|------|-------------|
| **Payment Methods** | Pie Chart | `analytics.shiprocket_payment_breakdown` |
| **Revenue by Payment** | Bar Chart | `analytics.shiprocket_payment_breakdown` |

### Dashboard 4: System Health

| Card | Type | Question/SQL |
|------|------|-------------|
| **Events by Status** | Pie Chart | `analytics.webhook_processing_health` |
| **Pending Events** | Number | `analytics.shiprocket_kpis` → `pending_events` |
| **Failed Events** | Number | `analytics.shiprocket_kpis` → `failed_events` |
| **Webhook Volume (7d)** | Line Chart | `analytics.shiprocket_hourly_volume` |

### Dashboard 5: Recent Orders

| Card | Type | Question/SQL |
|------|------|-------------|
| **Latest 50 Orders** | Table | `analytics.shiprocket_recent_orders` |

---

## Step 4: Auto-refresh

In Metabase, each card has an **auto-refresh** option:
- Set to **1 minute** for live dashboards
- Set to **5 minutes** for overview dashboards

---

## Views Available

| View | Purpose |
|------|---------|
| `analytics.shiprocket_orders` | Clean order data (no raw payloads) |
| `analytics.shiprocket_status_summary` | Orders grouped by status |
| `analytics.shiprocket_delivery_summary` | Daily delivery metrics |
| `analytics.shiprocket_courier_performance` | Courier comparison |
| `analytics.shiprocket_payment_breakdown` | Payment method analysis |
| `analytics.webhook_processing_health` | Event processing status |
| `analytics.shiprocket_recent_orders` | Last 50 orders |
| `analytics.shiprocket_kpis` | Single-value KPI cards |
| `analytics.shiprocket_hourly_volume` | Hourly webhook volume |
| `analytics.pabbly_delivery_summary` | Pabbly delivery tracking |
